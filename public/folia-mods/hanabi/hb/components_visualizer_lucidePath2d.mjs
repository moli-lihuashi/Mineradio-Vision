/* 移植自 Folia components/visualizer/lucidePath2d.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const lucideIconPath2d = (node, into = new Path2D())=>{
    node.forEach((entry)=>{
        const [tag, attrs, children] = entry;
        const n = (key, fallback = 0)=>{
            const value = Number.parseFloat(String(attrs[key] ?? ''));
            return Number.isFinite(value) ? value : fallback;
        };
        if (tag === 'path' && typeof attrs.d === 'string') into.addPath(new Path2D(attrs.d));
        else if (tag === 'circle') {
            into.moveTo(n('cx') + n('r'), n('cy'));
            into.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2);
        } else if (tag === 'ellipse') {
            into.moveTo(n('cx') + n('rx'), n('cy'));
            into.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2);
        } else if (tag === 'rect') {
            into.roundRect(n('x'), n('y'), n('width'), n('height'), Math.min(n('rx', n('ry')), n('width') / 2, n('height') / 2));
        } else if (tag === 'line') {
            into.moveTo(n('x1'), n('y1'));
            into.lineTo(n('x2'), n('y2'));
        } else if (tag === 'polyline' || tag === 'polygon') {
            const numbers = String(attrs.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
            for(let i = 0; i + 1 < numbers.length; i += 2){
                if (i === 0) into.moveTo(numbers[i], numbers[i + 1]);
                else into.lineTo(numbers[i], numbers[i + 1]);
            }
            if (tag === 'polygon') into.closePath();
        }
        if (Array.isArray(children)) lucideIconPath2d(children, into);
    });
    return into;
};
