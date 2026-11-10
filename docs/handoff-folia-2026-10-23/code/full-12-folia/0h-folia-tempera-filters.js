/* tempera 的滤镜层：反色（difference）、场景后处理链、转场模糊的挂/摘。
 * 源：src/components/visualizer/tempera/temperaDifferenceFilter.ts（175）+ temperaSceneFilters.ts（95）
 *      + src/components/visualizer/sonnet/sonnetLensFilter.ts（92）
 *      + src/components/visualizer/sonnet/sonnetPrintFilters.ts（128）
 *      + src/components/visualizer/sonnet/sonnetPostProcess.ts（100-141，只搬 createSonnetPostProcessFilters）
 *      + src/components/visualizer/pixiFilterVertex.ts（21，顶点着色器只此一份）
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 反色滤镜 `resolution` 必须是 `'inherit'`。写成固定 1，输入纹理与 uBackTexture 的像素尺寸不一致，
 *    vTextureCoord 在两张图上索到不同位置 —— 细网点上会出现成片的错误翻色。
 * 2. `blendRequired` 只有反色形态声明；纯 tint 形态不读背景，也不声明。
 * 3. `textInversion` 关掉时**不能**连滤镜一起去掉：gradient 模式的颜色就活在这条 tint 里。
 * 4. 场景后处理的每个 pass 都要写同一个 resolution（Pixi 取数组最小值）；`inherit` 才等于画布分辨率。
 * 5. 转场模糊**只在模糊时挂上**，不许挂着禁用：禁用条目仍会被 Pixi 当作跳过项交给反色滤镜当"上一层"，
 *    它的 bounds 还是 Infinity，backdrop 会从 0,0 开始复制 —— 每个字都会对着画面左上角翻色。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var mg = window.foliaTemperaMg;
  if (!mg) return;
  /* pixiFilterVertex.ts：Pixi 8 自定义滤镜共用的顶点着色器 */
  var vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

  var parseColorChannels = mg.parseColorChannels;

  /* ---- sonnet/sonnetLensFilter.ts ---- */
// src/components/visualizer/sonnet/sonnetLensFilter.ts
// Creates a single-pass radial lens filter with screen-space chromatic dispersion.

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform highp vec4 uOutputFrame;
uniform float uDistortion;
uniform float uDispersion;

vec2 screenToTextureUv(vec2 screenUv) {
    return screenUv * uOutputFrame.zw * uInputSize.zw;
}

vec4 sampleInside(vec2 uv) {
    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y
        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {
        return vec4(0.0);
    }
    return texture(uTexture, uv);
}

void main(void) {
    vec2 screenUv = vTextureCoord * uInputSize.xy / max(uOutputFrame.zw, vec2(1.0));
    vec2 centered = screenUv - 0.5;
    float aspect = uOutputFrame.z / max(uOutputFrame.w, 1.0);
    centered.x *= aspect;

    float radiusSquared = dot(centered, centered);
    // Keep the low end subtle but leave enough headroom for the broad barrel warp in the
    // reference look; the UI/store expose this as a 0..2 amount.
    float curvature = uDistortion * 0.32;
    float radialScale = 1.0 - curvature * radiusSquared
        + curvature * 0.16 * radiusSquared * radiusSquared;
    vec2 lensCentered = centered * radialScale;
    lensCentered.x /= aspect;
    vec2 lensUv = lensCentered + 0.5;

    float radius = sqrt(radiusSquared);
    vec2 radialDirection = radius > 0.0001 ? centered / radius : vec2(0.0);
    float edgeWeight = smoothstep(0.12, 0.9, radius);
    vec2 dispersion = radialDirection * uDispersion * 0.012 * edgeWeight;
    dispersion.x /= aspect;

    vec4 center = sampleInside(screenToTextureUv(lensUv));
    vec4 redSample = sampleInside(screenToTextureUv(lensUv + dispersion));
    vec4 blueSample = sampleInside(screenToTextureUv(lensUv - dispersion));
    float alpha = max(center.a, max(redSample.a, blueSample.a));
    float coreWeight = 0.84 - clamp(uDispersion, 0.0, 1.0) * 0.18;
    vec3 core = center.rgb * coreWeight;
    vec3 separated = vec3(redSample.r, center.g, blueSample.b);
    // Keep a neutral core for thin MG strokes, then add the displaced channels as colored
    // fringes. Without this fallback, a one-pixel line can sample transparent red/blue texels
    // and become an unintended green-only stroke.
    vec3 color = max(core, separated);

    // Pixi render textures are premultiplied; the max channel values remain premultiplied.
    finalColor = vec4(color, alpha);
}
`;


const createSonnetLensFilter = (
    pixi,
    amounts,
) => {
    const uniforms = new pixi.UniformGroup({
        uDistortion: { value: amounts.distortion, type: 'f32' },
        uDispersion: { value: amounts.dispersion, type: 'f32' },
    });
    return new pixi.Filter({
        glProgram: pixi.GlProgram.from({
            vertex,
            fragment,
            name: 'sonnet-lens-distortion',
        }),
        resources: { lensUniforms: uniforms },
        antialias: 'on',
    });
};

  /* ---- sonnet/sonnetPrintFilters.ts ---- */
// src/components/visualizer/sonnet/sonnetPrintFilters.ts
// Fixed-parameter print-style scene filters (RGB shift, halftone screen, ordered dither,
// vignette). Single full-screen pass each, no runtime uniforms — the post-process toggle
// in sonnet tuning enables or disables the whole group as-is.

// Subtle constant chromatic aberration: ~1.25px split along a fixed 25-degree axis.
const rgbShiftFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uAmount;

vec4 sampleInside(vec2 uv) {
    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y
        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {
        return vec4(0.0);
    }
    return texture(uTexture, uv);
}

void main(void) {
    vec2 offset = vec2(0.9063, 0.4226) * uAmount * 3.0 * uInputSize.zw;
    vec4 redSample = sampleInside(vTextureCoord + offset);
    vec4 center = sampleInside(vTextureCoord);
    vec4 blueSample = sampleInside(vTextureCoord - offset);
    float alpha = max(center.a, max(redSample.a, blueSample.a));
    float coreWeight = 0.84 - clamp(uAmount, 0.0, 1.0) * 0.18;
    vec3 core = center.rgb * coreWeight;
    vec3 separated = vec3(redSample.r, center.g, blueSample.b);
    // Preserve a neutral core for thin strokes so transparent red/blue offset samples cannot
    // collapse a white MG line into an unintended green-only result.
    finalColor = vec4(max(core, separated), alpha);
}
`;

// Single-sample halftone screen: dots are screened per RGB channel at classic CMYK
// angles, so dark areas stay dark and no paper color is introduced.
const halftoneFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;

float dotScreen(vec2 fragCoord, float angle, float value, float cellSize) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotated = mat2(c, s, -s, c) * fragCoord;
    float dist = length(fract(rotated / cellSize) - 0.5) * cellSize;
    float radius = sqrt(clamp(value, 0.0, 1.0)) * cellSize * 0.62;
    return 1.0 - smoothstep(radius - 1.2, radius + 1.2, dist);
}

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a > 0.0) {
        color.rgb /= color.a;
    }
    float cellSize = 5.0;
    vec3 screened = vec3(
        dotScreen(gl_FragCoord.xy, radians(15.0), color.r, cellSize),
        dotScreen(gl_FragCoord.xy, radians(75.0), color.g, cellSize),
        dotScreen(gl_FragCoord.xy, radians(0.0), color.b, cellSize)
    );
    color.rgb = mix(color.rgb, screened, uAmount);
    color.rgb *= color.a;
    finalColor = color;
}
`;

// Fixed vignette: darkens toward the screen edges. Computed in screen space (the input
// texture can extend past the viewport while the camera pans), and blended toward opaque
// black so it also reads over the scene's transparent background.
const vignetteFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uAmount;

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    // The filtered container uses a viewport-sized filterArea, so this recovers stable
    // 0..1 viewport coordinates instead of coordinates derived from lyric bounds.
    vec2 screenUv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    vec2 centered = screenUv - 0.5;
    centered.x *= uOutputFrame.z / uOutputFrame.w;
    float vignette = clamp(smoothstep(0.52, 1.08, length(centered)) * uAmount * 0.6, 0.0, 1.0);
    finalColor = mix(color, vec4(0.0, 0.0, 0.0, 1.0), vignette);
}
`;

const createPass = (pixi, name, fragment, amount) =>
    new pixi.Filter({
        glProgram: pixi.GlProgram.from({ vertex, fragment, name }),
        resources: {
            printUniforms: new pixi.UniformGroup({
                uAmount: { value: amount, type: 'f32' },
            }),
        },
        // The app canvas is MSAA (antialias: true), but filter passes render into an
        // offscreen texture that is not multisampled by default — thin strokes would
        // lose their AA and turn jagged. Keep MSAA on for these scene-wide passes.
        antialias: 'on',
    });


const createSonnetPrintFilters = (pixi, amounts) => {
    const filters = [];
    if (amounts.rgbShift > 0) filters.push(createPass(pixi, 'sonnet-print-rgb-shift', rgbShiftFragment, amounts.rgbShift));
    if (amounts.halftone > 0) filters.push(createPass(pixi, 'sonnet-print-halftone', halftoneFragment, amounts.halftone));
    if (amounts.vignette > 0) filters.push(createPass(pixi, 'sonnet-print-vignette', vignetteFragment, amounts.vignette));
    return filters;
};

  /* ---- sonnet/sonnetPostProcess.ts:100-141 ---- */
const createSonnetPostProcessFilters = (
    pixi,
    amounts,
    seed,
) => {
    const filters = [];

    // Lens curvature runs before grading and print passes so halftone/vignette follow the warped frame.
    if (amounts.lensDistortion > 0 || amounts.lensDispersion > 0) {
        filters.push(createSonnetLensFilter(pixi, {
            distortion: amounts.lensDistortion,
            dispersion: amounts.lensDispersion,
        }));
    }

    // Noise Filter for print/film grain texture
    if (amounts.noise > 0) {
        const noise = new pixi.NoiseFilter({
            noise: amounts.noise,
            seed: (seed % 10_000) / 10_000,
            antialias: 'on', // Filter textures skip the canvas MSAA; thin strokes need it back
        });
        filters.push(noise);
    }

    // ColorMatrix contrast stays opt-in (profile.contrast === 0 by default) because
    // it aliases thin background strokes — the user enables it via tuning.
    if (amounts.contrast > 0) {
        const colorMatrix = new pixi.ColorMatrixFilter();
        colorMatrix.contrast(amounts.contrast, false);
        colorMatrix.antialias = 'on';
        filters.push(colorMatrix);
    }

    // Fixed print-style passes (RGB shift, halftone, dither, vignette) go last so the
    // halftone screen and vignette frame the already-graded scene.
    const printFilters = createSonnetPrintFilters(pixi, amounts.printEffects);
    if (printFilters.length > 0) {
        filters.push(...printFilters);
    }
    return filters;
};

  /* ---- tempera/temperaDifferenceFilter.ts ---- */
// src/components/visualizer/tempera/temperaDifferenceFilter.ts
// Single-pass threshold inversion for the lyric layer: it samples the already-rendered
// artwork underneath and paints each text pixel in whichever of ink/paper contrasts more,
// giving the print-registration look without hand-picking a fill color per shot kind.
//
// It is also the only thing that colors the lyric in gradient mode - the ramp rides along as a
// tint. So the filter has a second, tint-only form for when the user switches the inversion
// off: same ramp, no backdrop read. Dropping the filter entirely there would silently take
// gradient mode's colour with it and leave flat ink text.

// Shared by both forms: everything except the backdrop read and the colour decision.
const fragmentHead = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec3 uInkColor;
uniform vec3 uPaperColor;
uniform float uInkLuminance;
uniform float uPaperLuminance;
uniform float uBias;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uTintC;
uniform vec3 uTintD;
uniform float uTintAmount;

// Four-stop ramp sampled across the filter's own bounds, so the colour sweeps the whole line
// rather than repeating inside every glyph.
vec3 sampleTint(float position) {
    float scaled = clamp(position, 0.0, 1.0) * 3.0;
    if (scaled < 1.0) return mix(uTintA, uTintB, scaled);
    if (scaled < 2.0) return mix(uTintB, uTintC, scaled - 1.0);
    return mix(uTintC, uTintD, scaled - 2.0);
}

float tintPosition(vec2 uv) {
    return clamp(uv.x * uInputSize.x / max(uOutputFrame.z, 1.0), 0.0, 1.0);
}
`;

const inversionFragment = `${fragmentHead}
uniform sampler2D uBackTexture;

float backLuminance(vec2 uv) {
    vec4 back = texture(uBackTexture, uv);
    // Pixi render targets are premultiplied; undo it before reading brightness.
    vec3 straight = back.rgb / max(back.a, 1e-4);
    float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    // Where nothing has been drawn, the shell background shows through, which is paper.
    return mix(uPaperLuminance, lum, clamp(back.a * 3.0, 0.0, 1.0));
}

void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    // A 5-tap average keeps fine hatch from flickering the inversion decision per pixel.
    vec2 texel = uInputSize.zw * 1.5;
    float lum = backLuminance(vTextureCoord) * 0.4
        + (backLuminance(vTextureCoord + texel)
            + backLuminance(vTextureCoord - texel)
            + backLuminance(vTextureCoord + vec2(texel.x, -texel.y))
            + backLuminance(vTextureCoord + vec2(-texel.x, texel.y))) * 0.15;

    float distanceToPaper = abs(lum - uPaperLuminance);
    float distanceToInk = abs(lum - uInkLuminance);
    // Pick the color that sits further from the backdrop so contrast never collapses,
    // whether the theme puts light ink on dark paper or the reverse.
    vec3 tone = mix(uInkColor, uPaperColor, step(distanceToInk + uBias, distanceToPaper));

    // Colour modes tint that choice instead of replacing it: the hue comes from the ramp, the
    // luminance stays the one the inversion just picked. Colouring the text any other way
    // throws away the only thing guaranteeing it reads against the artwork.
    if (uTintAmount > 0.0) {
        vec3 tint = sampleTint(tintPosition(vTextureCoord));
        float tintLuminance = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        float toneLuminance = dot(tone, vec3(0.2126, 0.7152, 0.0722));
        vec3 matched = clamp(tint * (toneLuminance / tintLuminance), 0.0, 1.0);
        tone = mix(tone, matched, uTintAmount);
    }
    finalColor = vec4(tone * front.a, front.a);
}
`;

// The inversion switched off. No backdrop is copied, so the ramp *is* the colour: the stops
// are already built to clear the paper's luminance by ~88, which is what kept them readable
// when the inversion was only lending them its luminance.
const tintOnlyFragment = `${fragmentHead}
void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    vec3 tone = uTintAmount > 0.0 ? sampleTint(tintPosition(vTextureCoord)) : uInkColor;
    finalColor = vec4(tone * front.a, front.a);
}
`;

const REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 };

const toNormalizedRgb = (color, fallback) => {
    const channels = parseColorChannels(color);
    if (!channels) return fallback;
    return [channels.r / 255, channels.g / 255, channels.b / 255];
};

const luminanceOf = (rgb) => (
    rgb[0] * REC709.r + rgb[1] * REC709.g + rgb[2] * REC709.b
);


const createTemperaDifferenceFilter = (
    pixi,
    options,
) => {
    const ink = toNormalizedRgb(options.ink, [1, 1, 1]);
    const paper = toNormalizedRgb(options.paper, [0, 0, 0]);
    const tint = options.tint && options.tint.length >= 2 ? options.tint : null;
    const stops = Array.from({ length: 4 }, (_, index) => (
        tint ? toNormalizedRgb(tint[Math.min(index, tint.length - 1)], ink) : ink
    ));
    const uniforms = new pixi.UniformGroup({
        uInkColor: { value: new Float32Array(ink), type: 'vec3<f32>' },
        uTintA: { value: new Float32Array(stops[0]), type: 'vec3<f32>' },
        uTintB: { value: new Float32Array(stops[1]), type: 'vec3<f32>' },
        uTintC: { value: new Float32Array(stops[2]), type: 'vec3<f32>' },
        uTintD: { value: new Float32Array(stops[3]), type: 'vec3<f32>' },
        uTintAmount: { value: tint ? 1 : 0, type: 'f32' },
        uPaperColor: { value: new Float32Array(paper), type: 'vec3<f32>' },
        uInkLuminance: { value: luminanceOf(ink), type: 'f32' },
        uPaperLuminance: { value: luminanceOf(paper), type: 'f32' },
        uBias: { value: (options.threshold ?? 0.5) - 0.5, type: 'f32' },
    });
    const inversion = options.inversion ?? true;
    return new pixi.Filter({
        glProgram: pixi.GlProgram.from({
            vertex,
            fragment: inversion ? inversionFragment : tintOnlyFragment,
            name: inversion ? 'tempera-difference-inversion' : 'tempera-text-tint',
        }),
        // blendRequired makes Pixi snapshot the pixels already drawn beneath this filter's
        // bounds into uBackTexture; the empty texture below is the required placeholder. The
        // tint-only form reads no backdrop, so it declares neither.
        blendRequired: inversion,
        resources: inversion
            ? { differenceUniforms: uniforms, uBackTexture: pixi.Texture.EMPTY }
            : { differenceUniforms: uniforms },
        padding: 0,
        // MUST be 'inherit'. Pixi's Filter default is a hard 1, which allocates the input
        // texture at a different pixel size than the back texture (that one always follows the
        // render target's resolution). vTextureCoord then indexes the two textures
        // differently and the backdrop is read from the wrong place - the inversion picks the
        // wrong colour in patches, worst over fine hatch. The tint-only form has no back
        // texture to disagree with, but a hard 1 would still rasterize the type below the
        // canvas resolution and upscale it.
        resolution: 'inherit',
    });
};

  /* ---- tempera/temperaSceneFilters.ts ---- */
// src/components/visualizer/tempera/temperaSceneFilters.ts
// Attaches the transition blur to a paragraph scene only while it is actually blurring.
//
// This is not a micro-optimisation, it is what keeps the lyric inversion correct. The
// difference filter on the text layer declares `blendRequired`, so Pixi copies the pixels
// already drawn beneath it into `uBackTexture` - and it takes the copy origin relative to the
// *enclosing* filter on the stack. A container filter that is attached but disabled is still
// pushed, as a skipped entry, and Pixi 8's `_getPreviousFilterData` hands that skipped entry
// back regardless (its loop stops at stack index 0 without rejecting it). The skipped entry
// never ran `_calculateFilterArea`, so its bounds are still `Infinity`; the copy origin
// underflows to 0,0 and every glyph is inverted against the top-left corner of the frame
// instead of the artwork underneath it.
//
// The scene-level post-process chain hid this: with post-process on, the enclosing entry is a
// real one with real bounds. With it off - the default - the only thing left on the scene
// container was the parked transition blur, which is exactly such a skipped entry. So the blur
// goes on for the length of the transition and comes off again; it is never parked disabled.



/**
 * The resolution every filter on the scene container runs at.
 *
 * Pixi's `Filter` default is a hard `resolution: 1`, and none of the shared sonnet passes
 * it, so switching post-processing on used to rasterize the whole composition at one
 * device pixel per CSS pixel and stretch it back up to the canvas (`textureResolution`, 1.5 by
 * default). Fine hatch, the screentone lattice and the type all softened - the sharpest thing
 * in the mode paid for the grain. 'inherit' keeps the pass at the canvas resolution instead,
 * and the compression switch keeps the old downscale available for weak GPUs.
 *
 * This is safe for the lyric inversion, which is otherwise very sensitive to resolution: Pixi
 * takes the *minimum* resolution across the filters in one array, so a container's whole pass
 * lands on a single value; the difference filter one level down asks for `'inherit'`, which
 * resolves to the resolution of the surface it is rendering into - that same pass - and its
 * `uBackTexture` is copied from that same surface at that same resolution. Input and backdrop
 * therefore keep identical pooled (pow2) sizes and one `vTextureCoord` indexes both. The rule
 * to preserve: never give the text layer's own filter a fixed resolution, and never mix fixed
 * resolutions inside one array expecting them to survive - the minimum wins.
 *
 * `renderResolution` is what the canvas is actually running at - `textureResolution` after
 * `snapResolutionToTexturePool` - and not the setting. The two differ whenever the snap took a
 * step down, and a pass pinned to the setting would then be asking for a surface *larger* than
 * the one it is drawn onto, which is the waste the snap exists to remove.
 */
const resolveTemperaPassResolution = (
    tuning,
    renderResolution,
)  => (
    tuning.postProcessTextureCompression ? compressedPassResolution(renderResolution) : 'inherit'
);

/** Compression never *raises* the pass above the canvas it will be stretched onto. */
const compressedPassResolution = (renderResolution) => Math.min(1, renderResolution);

/**
 * The transition blur has always run at half the pass around it - it is blurring anyway, and it
 * only exists during a transition. Deriving it from the pass keeps that ratio when the pass is
 * no longer pinned to 1: a hard 0.5 would drop a 1.5x scene by three quarters the moment the
 * blur attaches, while its strength is still imperceptible.
 */
const resolveTemperaTransitionBlurResolution = (
    tuning,
    renderResolution,
) => (
    (tuning.postProcessTextureCompression ? compressedPassResolution(renderResolution) : renderResolution) * 0.5
);


/** Below this the blur is a no-op pass, so the filter comes off the scene entirely. */
const BLUR_ACTIVE_STRENGTH = 0.01;

const setTemperaTransitionBlur = (scene, strength) => {
    const filter = scene.transitionBlurFilter;
    if (!filter) return;
    const active = strength > BLUR_ACTIVE_STRENGTH;
    if (active) filter.strength = strength;
    if (active === scene.transitionBlurAttached) return;
    scene.transitionBlurAttached = active;
    // An empty array makes Pixi drop the filter effect from the container, which is the whole
    // point: no effect means no stack entry for the inversion filter to measure against.
    scene.container.filters = active ? [...scene.baseFilters, filter] : scene.baseFilters;
};


  window.foliaTemperaFilters = {
    createTemperaDifferenceFilter: createTemperaDifferenceFilter,
    createSonnetPostProcessFilters: createSonnetPostProcessFilters,
    resolveTemperaPassResolution: resolveTemperaPassResolution,
    resolveTemperaTransitionBlurResolution: resolveTemperaTransitionBlurResolution,
    setTemperaTransitionBlur: setTemperaTransitionBlur
  };
}());
