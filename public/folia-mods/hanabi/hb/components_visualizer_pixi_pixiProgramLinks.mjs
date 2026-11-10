/* 移植自 Folia components/visualizer/pixi/pixiProgramLinks.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const COMPLETION_STATUS_KHR = 0x91b1;
const LOOK_EVERY_MS = 10;
const HAND_OVER_MS = 4;
const DECLARED_ATTRIBUTE = /^[ \t]*(?:attribute|in)[ \t]+(?:(?:lowp|mediump|highp)[ \t]+)?\w+[ \t]+(\w+)[ \t]*;/gm;
const programsOf = (pixi, renderer, stage)=>{
    const found = new Map();
    const add = (shader)=>{
        const program = shader?.glProgram;
        if (program && !found.has(program._key)) found.set(program._key, program);
    };
    let drawsGraphics = false;
    const walk = (node)=>{
        for (const filter of node.filters ?? []){
            add(filter);
            for (const field of Object.values(filter)){
                for (const value of Array.isArray(field) ? field : [
                    field
                ]){
                    if (value instanceof pixi.Shader) add(value);
                }
            }
        }
        if (node instanceof pixi.Mesh) add(node.shader);
        if (node instanceof pixi.Graphics) {
            if (node.context.customShader) add(node.context.customShader);
            else drawsGraphics = true;
        }
        node.children.forEach(walk);
    };
    walk(stage);
    add(new pixi.DefaultBatcher({
        maxTextures: renderer.limits.maxBatchableTextures
    }).shader);
    if (drawsGraphics) add(renderer.renderPipes.graphics._adaptor.shader);
    if (renderer.backBuffer.useBackBuffer) add(renderer.backBuffer._bigTriangleShader);
    return [
        ...found.values()
    ];
};
const bindsAttributesInNameOrder = (program)=>!/^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m.test(program.vertex ?? '');
const byName = (a, b)=>a > b ? 1 : -1;
const attributesInNameOrder = (gl, webGLProgram)=>{
    const names = [];
    const count = gl.getProgramParameter(webGLProgram, gl.ACTIVE_ATTRIBUTES);
    for(let index = 0; index < count; index += 1){
        const name = gl.getActiveAttrib(webGLProgram, index)?.name;
        if (name && !name.startsWith('gl_')) names.push(name);
    }
    names.sort(byName);
    if (names.every((name, location)=>gl.getAttribLocation(webGLProgram, name) === location)) return true;
    names.forEach((name, location)=>gl.bindAttribLocation(webGLProgram, location, name));
    gl.linkProgram(webGLProgram);
    return false;
};
const handOver = (pixi, gl, { program, webGLProgram, vertex, fragment })=>{
    if (!gl.getProgramParameter(webGLProgram, gl.LINK_STATUS)) {
        pixi.logProgramError(gl, webGLProgram, vertex, fragment);
    }
    program._attributeData = pixi.extractAttributesFromGlProgram(webGLProgram, gl, false);
    program._uniformData = pixi.getUniformData(webGLProgram, gl);
    program._uniformBlockData = pixi.getUboData(webGLProgram, gl);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    const uniformData = {};
    for(const name in program._uniformData){
        const data = program._uniformData[name];
        uniformData[name] = {
            location: gl.getUniformLocation(webGLProgram, name),
            value: pixi.defaultValue(data.type, data.size)
        };
    }
    return new pixi.GlProgramData(webGLProgram, uniformData);
};
export const linkPixiPrograms = async (pixi, renderer, stage, label, signal)=>{
    if (pixi.VERSION !== '8.21.0' || renderer.type !== pixi.RendererType.WEBGL) return;
    const webgl = renderer;
    const gl = webgl.gl;
    if (!gl.getExtension('KHR_parallel_shader_compile')) {
        console.info(`[PixiPrograms] ${label}: no parallel shader linking here; programs link on first draw`);
        return;
    }
    const linked = webgl.shader._programDataHash;
    const started = performance.now();
    const pending = programsOf(pixi, webgl, stage).filter((program)=>!linked[program._key] && !program.transformFeedbackVaryings).map((program)=>{
        const vertex = pixi.compileShader(gl, gl.VERTEX_SHADER, program.vertex ?? '');
        const fragment = pixi.compileShader(gl, gl.FRAGMENT_SHADER, program.fragment ?? '');
        const webGLProgram = gl.createProgram();
        gl.attachShader(webGLProgram, vertex);
        gl.attachShader(webGLProgram, fragment);
        if (bindsAttributesInNameOrder(program)) {
            const declared = [
                ...(program.vertex ?? '').matchAll(DECLARED_ATTRIBUTE)
            ].map((match)=>match[1]).sort(byName);
            declared.forEach((name, location)=>gl.bindAttribLocation(webGLProgram, location, name));
        }
        gl.linkProgram(webGLProgram);
        return {
            program,
            webGLProgram,
            vertex,
            fragment,
            rebound: false
        };
    });
    const count = pending.length;
    while(pending.length > 0){
        await new Promise((resolve)=>{
            window.setTimeout(resolve, LOOK_EVERY_MS);
        });
        if (signal?.aborted || gl.isContextLost()) return;
        const look = performance.now();
        while(pending.length > 0 && performance.now() - look < HAND_OVER_MS){
            const next = pending[0];
            if (!gl.getProgramParameter(next.webGLProgram, COMPLETION_STATUS_KHR)) break;
            pending.shift();
            if (!next.rebound && bindsAttributesInNameOrder(next.program) && !attributesInNameOrder(gl, next.webGLProgram)) {
                pending.push({
                    ...next,
                    rebound: true
                });
                continue;
            }
            linked[next.program._key] = handOver(pixi, gl, next);
        }
    }
    if (count > 0) console.info(`[PixiPrograms] ${label}: ${count} programs linked side by side in ${Math.round(performance.now() - started)} ms`);
};
