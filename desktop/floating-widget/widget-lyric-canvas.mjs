// Transparent glyph surfaces use one alpha coverage value per pixel rather
// than LCD RGB subpixels. Keep their backing resolution at the display DPR.
function ellipsizeText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  // Older engines retain the DOM's native ellipsis rather than split a cluster.
  if (typeof Intl.Segmenter !== 'function') return null;
  const ellipsis = '…';
  if (context.measureText(ellipsis).width > maxWidth) return '';
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  let low = 0, high = segments.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = segments.slice(0, middle).join('') + ellipsis;
    if (context.measureText(candidate).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return segments.slice(0, low).join('') + ellipsis;
}

export function createLyricCanvas(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'lyric-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  canvas.hidden = true;
  canvas.style.display = 'none';
  const context = canvas.getContext('2d', { alpha: true });
  const base = document.createElement('canvas');
  const highlight = document.createElement('canvas');
  const baseContext = base.getContext('2d', { alpha: true });
  const highlightContext = highlight.getContext('2d', { alpha: true });
  let enabled = false, ready = false, records = [], ratio = 1;
  let width = 0, height = 0, padding = 3, styleKey = '', paintKey = '';

  function setVisible(value) {
    canvas.hidden = !value;
    canvas.style.display = value ? 'block' : 'none';
    host.classList.toggle('lyric-canvas-text', value);
  }

  function setEnabled(value) {
    enabled = Boolean(value && context && baseContext && highlightContext);
    if (!enabled) {
      ready = false;
      setVisible(false);
    }
  }

  function measure(nodes) {
    if (!enabled || !nodes.length) {
      ready = false;
      setVisible(false);
      return;
    }
    const rect = host.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      ready = false;
      setVisible(false);
      return;
    }
    ratio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // The image origin and its CSS size both land on physical pixel boundaries.
    const originX = Math.round((rect.left - padding) * ratio) / ratio - rect.left;
    const originY = Math.round((rect.top - padding) * ratio) / ratio - rect.top;
    width = Math.ceil((rect.width + padding * 2) * ratio);
    height = Math.ceil((rect.height + padding * 2) * ratio);
    // Very large malformed lyric lines retain the normal DOM renderer.
    if (width > 16384 || height > 16384 || width * height > 16777216) {
      ready = false;
      setVisible(false);
      return;
    }
    canvas.style.left = originX + 'px';
    canvas.style.top = originY + 'px';
    canvas.style.width = width / ratio + 'px';
    canvas.style.height = height / ratio + 'px';
    canvas.dataset.pixelRatio = String(ratio);
    for (const surface of [canvas, base, highlight]) {
      if (surface.width !== width) surface.width = width;
      if (surface.height !== height) surface.height = height;
    }
    records = nodes.map(node => {
      const cs = getComputedStyle(node);
      const nodeRect = node.getBoundingClientRect();
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      baseContext.font = font;
      if ('letterSpacing' in baseContext) baseContext.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      if ('fontKerning' in baseContext) baseContext.fontKerning = cs.fontKerning;
      let text = node.textContent || '', offsetX = 0;
      if (node.classList.contains('lyric-next-text')) {
        const leftPadding = parseFloat(cs.paddingLeft) || 0;
        const rightPadding = parseFloat(cs.paddingRight) || 0;
        const availableWidth = Math.max(0, nodeRect.width - leftPadding - rightPadding);
        if (cs.textOverflow === 'ellipsis') text = ellipsizeText(baseContext, text, availableWidth);
        if (text === null) return null;
        const textWidth = baseContext.measureText(text).width;
        const spare = Math.max(0, availableWidth - textWidth);
        const align = cs.textAlign === 'start' ? (cs.direction === 'rtl' ? 'right' : 'left')
          : cs.textAlign === 'end' ? (cs.direction === 'rtl' ? 'left' : 'right') : cs.textAlign;
        offsetX = leftPadding + (align === 'center' ? spare / 2 : align === 'right' ? spare : 0);
      }
      const metrics = baseContext.measureText(text);
      const fontSize = parseFloat(cs.fontSize) || 24;
      const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
      const x = Math.round((nodeRect.left - rect.left - originX + offsetX) * ratio) / ratio;
      const top = nodeRect.top - rect.top - originY;
      const y = Math.round((top + (nodeRect.height - ascent - descent) / 2 + ascent) * ratio) / ratio;
      return {
        text, font, x, y, width: node.classList.contains('lyric-next-text') ? metrics.width : nodeRect.width,
        letterSpacing: cs.letterSpacing, direction: cs.direction,
        kerning: cs.fontKerning
      };
    });
    if (records.some(record => record === null)) {
      records = [];
      ready = false;
      setVisible(false);
      return;
    }
    if (canvas.parentElement !== host) host.appendChild(canvas);
    ready = true;
    styleKey = '';
    paintKey = '';
    // Paint first; the existing accessible text stays visible until then.
  }

  function drawLayer(target, color, strokeColor, strokeWidth) {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.setTransform(ratio, 0, 0, ratio, 0, 0);
    target.textAlign = 'left';
    target.textBaseline = 'alphabetic';
    target.fillStyle = color;
    target.strokeStyle = strokeColor;
    target.lineWidth = strokeWidth;
    target.lineJoin = 'round';
    for (const record of records) {
      target.font = record.font;
      target.direction = record.direction;
      if ('letterSpacing' in target) target.letterSpacing = record.letterSpacing === 'normal' ? '0px' : record.letterSpacing;
      if ('fontKerning' in target) target.fontKerning = record.kerning;
      if (strokeWidth > 0) target.strokeText(record.text, record.x, record.y);
      target.fillText(record.text, record.x, record.y);
    }
  }

  function paint(progress, style = {}) {
    if (!enabled || !ready) return false;
    const strokeWidth = [0, 0.5, 1, 1.5, 2].includes(style.strokeWidth) ? style.strokeWidth : 0.5;
    const colors = [style.textColor || '#ffffff', style.highlightColor || '#ffa04d',
      style.textStrokeColor || '#101010', style.highlightStrokeColor || '#101010', strokeWidth];
    const nextStyleKey = JSON.stringify(colors);
    if (styleKey !== nextStyleKey) {
      drawLayer(baseContext, colors[0], colors[2], strokeWidth);
      drawLayer(highlightContext, colors[1], colors[3], strokeWidth);
      styleKey = nextStyleKey;
      paintKey = '';
    }
    const amounts = records.map((_, index) => Math.max(0, Math.min(100, Math.round((progress[index] || 0) * 10) / 10)));
    const nextPaintKey = amounts.join(',');
    if (paintKey !== nextPaintKey || canvas.hidden) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.drawImage(base, 0, 0);
      for (let index = 0; index < records.length; index++) {
        const amount = amounts[index];
        if (!(amount > 0)) continue;
        const record = records[index];
        const start = amount >= 100 && index === 0 ? record.x - padding : record.x;
        const end = amount >= 100 && index === records.length - 1
          ? record.x + record.width + padding : record.x + record.width * amount / 100;
        context.save();
        context.beginPath();
        context.rect(Math.round(start * ratio), 0, Math.max(0, Math.round(end * ratio) - Math.round(start * ratio)), height);
        context.clip();
        // Replace coverage; drawing over the base would darken/thicken AA edges.
        context.clearRect(0, 0, width, height);
        context.drawImage(highlight, 0, 0);
        context.restore();
      }
      paintKey = nextPaintKey;
    }
    setVisible(true);
    return true;
  }

  return {
    setEnabled, measure, paint,
    invalidate() { ready = false; setVisible(false); },
    dispose() {
      setVisible(false);
      canvas.remove();
      records = [];
      for (const surface of [canvas, base, highlight]) { surface.width = 0; surface.height = 0; }
    }
  };
}

export function drawLyricStylePreview(canvas, style = {}) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return;
  const ratio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const weight = [400, 500, 600].includes(style.fontWeight) ? style.fontWeight : 400;
  const strokeWidth = [0, 0.5, 1, 1.5, 2].includes(style.strokeWidth) ? style.strokeWidth : 0.5;
  context.font = `${weight} 56px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  context.lineWidth = strokeWidth;
  const metrics = context.measureText('字');
  const ascent = metrics.actualBoundingBoxAscent || 48;
  const descent = metrics.actualBoundingBoxDescent || 8;
  const x = Math.round((rect.width - metrics.width) / 2 * ratio) / ratio;
  const y = Math.round((rect.height - ascent - descent) / 2 * ratio + ascent * ratio) / ratio;
  function draw(color, outline) {
    context.fillStyle = color;
    context.strokeStyle = outline;
    if (strokeWidth > 0) context.strokeText('字', x, y);
    context.fillText('字', x, y);
  }
  draw(style.textColor || '#ffffff', style.textStrokeColor || '#101010');
  context.save();
  context.beginPath();
  context.rect(0, 0, rect.width / 2, rect.height);
  context.clip();
  context.clearRect(0, 0, rect.width, rect.height);
  draw(style.highlightColor || '#ffa04d', style.highlightStrokeColor || '#101010');
  context.restore();
}
