/* 移植自 Folia「雾笺」 nebbiaGlUtils.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
export const compileShader = (gl, type, src)=>{
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
};
export const startProgram = (gl, vs, fs, attribs)=>{
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    for (const [name, index] of Object.entries(attribs))gl.bindAttribLocation(p, index, name);
    gl.linkProgram(p);
    return p;
};
export const checkLinked = (gl, p)=>{
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) return;
    const shaderLogs = (gl.getAttachedShaders(p) ?? []).map((s)=>gl.getShaderInfoLog(s)).filter(Boolean).join('\n');
    throw new Error(`Nebbia program: ${gl.getProgramInfoLog(p)}${shaderLogs ? `\n${shaderLogs}` : ''}`);
};
export const makeTex = (gl, unit)=>{
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return {
        t,
        unit
    };
};
