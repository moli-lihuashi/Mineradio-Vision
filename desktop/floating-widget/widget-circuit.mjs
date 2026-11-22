import { createCircuitEditor } from './widget-circuit-edit.mjs';
import { circuitInformation } from './widget-circuit-style.mjs';

export function createCircuitCard({ card, state, onPositionChange, onStyleChange, onEditingChange, onGestureStart }) {
  const root = document.getElementById('circuit-card');
  const copy = document.getElementById('circuit-copy');
  const title = document.getElementById('circuit-title');
  const text = document.getElementById('circuit-title-text');
  const metadata = document.getElementById('circuit-metadata');
  const artist = document.getElementById('circuit-artist');
  const album = document.getElementById('circuit-album');
  const date = document.getElementById('circuit-date');
  const cover = document.getElementById('circuit-cover');
  const duration = document.createElement('div');
  duration.id = 'circuit-duration'; duration.className = 'circuit-duration'; metadata.appendChild(duration);
  const sizer = document.createElement('span');
  sizer.className = 'circuit-type-measure'; sizer.setAttribute('aria-hidden', 'true'); sizer.inert = true; copy.appendChild(sizer);
  const fields = { title, artist, album, date, duration };
  const mark = title.querySelector('svg');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let progress = state.circuitTitlePosition === 'bottom' ? 1 : 0;
  let geometry = null, frame = 0, animation = 0, active = false, gesture = null;
  let clearGesture = null, disposed = false;
  let coverUrl = '', metadataKey = '', measureKey = '', fontRevision = 0, pendingBefore = null;
  let queuedMetadata = null, metadataTimer = 0, metadataStarted = 0;
  const densities = { top: null, bottom: null }, densityKeys = { top: '', bottom: '' };
  let editor = null;
  const reflows = new Map(), ghosts = new Set();
  const clamp = value => Math.max(0, Math.min(1, value));
  const destination = () => state.circuitTitlePosition === 'bottom' ? 1 : 0;

  function commitMetadata(force = false) {
    clearTimeout(metadataTimer); metadataTimer = 0;
    if (!queuedMetadata || disposed) return;
    if (!force && active && (gesture || editor?.isDragging() || animation)) {
      metadataTimer = setTimeout(commitMetadata, 32); return;
    }
    const { key, name, performer, record, release, length } = queuedMetadata;
    queuedMetadata = null; metadataStarted = 0;
    if (metadataKey === key) return;
    if (active && geometry && !pendingBefore) pendingBefore = captureFields();
    if (text.textContent !== name) { cancelGesture(); editor?.cancel(); }
    metadataKey = key; densities.top = densities.bottom = null;
    for (const [element, value] of [[text, name], [artist, performer], [album, record === '未知专辑' ? '' : record],
      [duration, length], [date, release === '未知发行时间' ? '' : release]]) {
      if (element.textContent !== value) element.textContent = value;
    }
    date.hidden = !date.textContent || !circuitInformation(state.circuitStyle, state.circuitTitlePosition).showDate;
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date.textContent)) date.setAttribute('datetime', date.textContent);
    else date.removeAttribute('datetime');
    title.setAttribute('aria-label', name || '音乐名字');
    scheduleMeasure();
  }
  function flushMetadata() {
    if (!queuedMetadata) return;
    commitMetadata(true);
    cancelAnimationFrame(frame); frame = 0;
    measure();
  }

  function stopReflows() {
    for (const animation of reflows.values()) animation.cancel();
    reflows.clear();
    for (const ghost of ghosts) ghost.remove();
    ghosts.clear();
  }
  function captureFields() {
    const snapshots = new Map();
    for (const [name, element] of Object.entries(fields)) {
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
      const transform = new DOMMatrixReadOnly(css.transform === 'none' ? undefined : css.transform);
      const visualScale = Math.hypot(transform.a, transform.b);
      const visible = !element.hidden && rect.width > 0 && rect.height > 0 &&
        (!['artist', 'album', 'duration'].includes(name) || Number(metadata.style.opacity || 1) > .05);
      snapshots.set(name, { rect, visible, font: css.font, size: parseFloat(css.fontSize) * visualScale,
        lineHeight: css.lineHeight, visualScale, opacity: Number(css.opacity),
        letterSpacing: css.letterSpacing, color: css.color, text: element.textContent });
    }
    return snapshots;
  }
  function reflow(before) {
    if (!before || !state.circuitStyle.animate || reduced.matches || gesture || editor?.isDragging() || card.classList.contains('is-resizing')) return;
    const copyRect = copy.getBoundingClientRect();
    for (const [name, element] of Object.entries(fields)) {
      const old = before.get(name), rect = element.getBoundingClientRect();
      const visible = !element.hidden && rect.width > 0 && rect.height > 0 &&
        (!['artist', 'album', 'duration'].includes(name) || Number(metadata.style.opacity || 1) > .05);
      if (!visible && old?.visible && name !== 'title') {
        const ghost = document.createElement('span');
        ghost.className = 'circuit-exit-field'; ghost.textContent = old.text;
        ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
        Object.assign(ghost.style, { left: old.rect.left - copyRect.left + 'px', top: old.rect.top - copyRect.top + 'px',
          width: old.rect.width + 'px', height: old.rect.height + 'px', font: old.font, fontSize: old.size + 'px',
          lineHeight: old.lineHeight === 'normal' ? 'normal' : parseFloat(old.lineHeight) * old.visualScale + 'px',
          letterSpacing: old.letterSpacing, color: old.color });
        copy.appendChild(ghost); ghosts.add(ghost);
        const exit = ghost.animate([{ opacity: old.opacity }, { opacity: 0 }], { duration: 140 });
        exit.onfinish = () => { ghosts.delete(ghost); ghost.remove(); };
        continue;
      }
      // The design transition already moves shared fields; only fade outgoing information here.
      if (!visible || animation || typeof element.animate !== 'function') continue;
      const x = old?.visible ? old.rect.left - rect.left : 0, y = old?.visible ? old.rect.top - rect.top : 4;
      const scale = old?.visible ? old.size / parseFloat(getComputedStyle(element).fontSize) : 1;
      const opacity = old?.visible ? old.opacity : 0;
      if (old?.visible && Math.abs(x) < .5 && Math.abs(y) < .5 && Math.abs(scale - 1) < .01 && opacity >= .99) continue;
      const motion = element.animate([{ transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity },
        { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' });
      reflows.set(element, motion);
      motion.onfinish = () => { if (reflows.get(element) === motion) reflows.delete(element); };
    }
  }
  function positioned(name, layout, fallback, elementWidth, elementHeight) {
    const position = (editor?.positions() || state.circuitStyle.positions)?.[layout]?.[name];
    if (!position) return { ...fallback, align: 'left' };
    const align = position.align || 'left';
    const anchor = align === 'right' ? 1 : align === 'center' ? .5 : 0;
    return {
      x: Math.max(0, Math.min(geometry.width - elementWidth, position.x * geometry.width - elementWidth * anchor)),
      y: Math.max(0, Math.min(geometry.height - elementHeight, position.y * geometry.height)), align
    };
  }

  function paint(value) {
    progress = clamp(value);
    if (!geometry) return;
    const { width, x, startY, endY, smallFont, smallWidth, smallMarkSize, smallMarkGap, leading, largeFont, largeWidth, largeHeight, dateY, endDateY, dateHeight,
      metadataY, metadataHeight, gap, forceInfo } = geometry;
    const font = smallFont + (largeFont - smallFont) * progress;
    const titleWidth = smallWidth + (largeWidth - smallWidth) * progress;
    const titleHeight = smallFont * 1.25 + (largeHeight - smallFont * 1.25) * progress;
    const titleStart = positioned('title', 'top', { x, y: startY }, smallWidth, smallFont * 1.25);
    const titleEnd = positioned('title', 'bottom', { x, y: endY }, largeWidth, largeHeight);
    const titleX = titleStart.x + (titleEnd.x - titleStart.x) * progress;
    const titleY = titleStart.y + (titleEnd.y - titleStart.y) * progress;
    const dateWidth = date.getBoundingClientRect().width;
    const dateStart = positioned('date', 'top', { x, y: dateY }, dateWidth, dateHeight);
    const dateEnd = positioned('date', 'bottom', { x: Math.max(0, Math.min(width - dateWidth, titleEnd.x + largeWidth - dateWidth)), y: endDateY }, dateWidth, dateHeight);
    const releaseY = dateStart.y + (dateEnd.y - dateStart.y) * progress;
    const groupY = metadataY + ((forceInfo ? startY : metadataY) - metadataY) * progress;
    title.style.left = titleX + 'px';
    title.style.top = titleY + 'px';
    title.style.width = titleWidth + 'px';
    title.style.fontSize = font + 'px';
    title.style.lineHeight = String(1.25 + (leading - 1.25) * progress);
    title.style.height = titleHeight + 'px';
    const titleAlign = progress < .5 ? titleStart.align : titleEnd.align;
    title.dataset.align = titleAlign;
    title.style.textAlign = titleAlign;
    title.style.whiteSpace = progress < .08 ? 'nowrap' : 'normal';
    mark.style.width = smallMarkSize * (1 - progress) + 'px';
    mark.style.height = smallMarkSize * (1 - progress) + 'px';
    mark.style.opacity = 1 - progress;
    mark.style.marginRight = smallMarkGap * (1 - progress) + 'px';
    mark.style.shapeMargin = smallMarkGap * (1 - progress) + 'px';
    text.style.whiteSpace = progress < .08 ? 'nowrap' : 'normal';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.display = progress < .08 ? 'inline' : '-webkit-box';
    text.style.webkitBoxOrient = 'vertical';
    text.style.webkitLineClamp = '2';
    const between = progress > .001 && progress < .999;
    const groupSeparation = groupY < titleY ? titleY - groupY - metadataHeight : groupY - titleY - titleHeight;
    const metadataOpacity = state.circuitEditing ? 1 : forceInfo ? (between ? clamp(groupSeparation / gap) : 1)
      : Math.min(Math.max(0, 1 - progress * 3), clamp((groupY - titleY - titleHeight) / gap));
    metadata.style.top = groupY + 'px';
    metadata.style.opacity = metadataOpacity;
    metadata.inert = metadataOpacity < .05;
    metadata.setAttribute('aria-hidden', String(metadataOpacity < .05));
    date.style.left = (dateStart.x + (dateEnd.x - dateStart.x) * progress) + 'px';
    date.style.top = releaseY + 'px';
    date.dataset.align = (progress < .5 ? dateStart : dateEnd).align;
    date.style.textAlign = date.dataset.align;
    // The shared date passes between the two blocks; fade only while they intersect.
    date.style.opacity = !between || state.circuitEditing ? 1
      : clamp((releaseY < titleY ? titleY - releaseY - dateHeight : releaseY - titleY - titleHeight) / gap);
    for (const [name, element] of [['artist', artist], ['album', album], ['duration', duration]]) {
      const offset = element.offsetTop;
      const bounds = element.getBoundingClientRect();
      const from = positioned(name, 'top', { x, y: metadataY + offset }, bounds.width, bounds.height);
      const to = positioned(name, 'bottom', { x, y: (forceInfo ? startY : metadataY) + offset }, bounds.width, bounds.height);
      element.style.translate = `${from.x + (to.x - from.x) * progress - x}px ${from.y + (to.y - from.y) * progress - groupY - offset}px`;
      element.dataset.align = (progress < .5 ? from : to).align;
      element.style.textAlign = element.dataset.align;
    }
    root.dataset.titlePosition = progress >= .5 ? 'bottom' : 'top';
  }
  function measure() {
    frame = 0;
    if (!active || disposed) return;
    const width = copy.clientWidth, height = copy.clientHeight;
    if (!(width > 0 && height > 0)) return;
    if (queuedMetadata && geometry && (width !== geometry.width || height !== geometry.height || card.classList.contains('is-resizing'))) commitMetadata(true);
    const style = { ...state.circuitStyle, ...circuitInformation(state.circuitStyle, state.circuitTitlePosition) };
    const key = JSON.stringify([width, height, metadataKey, style, state.circuitTitlePosition, state.circuitEditing, fontRevision]);
    // Repeated window notifications must not restart an unchanged text transition.
    if (geometry && key === measureKey) { pendingBefore = null; return; }
    editor?.cancel();
    const before = geometry ? captureFields() : null;
    if (pendingBefore && before) {
      for (const [name, old] of pendingBefore) {
        const current = before.get(name);
        // Keep outgoing content, but resume visible fields at this frame's pixels.
        if (old.visible && !current.visible) before.set(name, old);
        else { current.visible = old.visible; current.text = old.text; }
      }
    }
    pendingBefore = null;
    stopReflows();
    const design = state.circuitTitlePosition === 'bottom' ? 'bottom' : 'top';
    const densityKey = JSON.stringify([style.density, style.showArtist, style.showAlbum, style.showDate, style.showDuration]);
    if (densityKeys[design] !== densityKey) { densities[design] = null; densityKeys[design] = densityKey; }
    const forceInfo = state.circuitEditing || style.density !== 'auto';
    const x = width * .085, usable = width - x * 2;
    let smallFont = style.smallFont || width * .052;
    const startY = width * .083, bottom = width * .065, gap = Math.max(6, width * .02);
    title.style.fontWeight = metadata.style.fontWeight = String(style.fontWeight);
    date.hidden = !style.showDate || !date.textContent;
    date.style.fontSize = smallFont + 'px';
    date.style.maxWidth = usable + 'px';
    let dateHeight = date.hidden ? 0 : date.getBoundingClientRect().height;
    let dateY = Math.max(startY + smallFont * 1.25 + gap, height - bottom - dateHeight);
    let availableMetadata = Math.max(0, dateY - (date.hidden ? 0 : gap) - (startY + smallFont * 1.25 + gap));
    let metadataFont = style.metadataFont || width * .083;
    metadata.style.fontSize = metadataFont + 'px';
    metadata.style.maxHeight = '';
    // Preserve readable type; drop lower-priority fields before reducing it.
    const previousDensity = densities[design];
    artist.hidden = !style.showArtist || !artist.textContent || (!forceInfo && width < (previousDensity !== null && previousDensity < 2 ? 264 : 256));
    album.hidden = !style.showAlbum || !album.textContent || (!forceInfo && width < (previousDensity === 0 ? 248 : 240));
    duration.hidden = !style.showDuration || !duration.textContent;
    album.style.webkitLineClamp = forceInfo ? '1' : '2';
    if (forceInfo) {
      const rows = [artist, album, duration].filter(element => !element.hidden).length;
      const minimumMetadata = rows ? 10 * (rows * 1.08 + (rows - 1) * .15) : 0;
      const labelBudget = height - bottom - startY - minimumMetadata - gap * (Number(rows > 0) + Number(!date.hidden));
      // Requested sizes are upper bounds when all selected fields must fit.
      smallFont = Math.max(10, Math.min(smallFont, labelBudget / (1.8 + (date.hidden ? 0 : 1.1))));
      date.style.fontSize = smallFont + 'px';
      dateHeight = date.hidden ? 0 : date.getBoundingClientRect().height;
      dateY = Math.max(startY + smallFont * 1.25 + gap, height - bottom - dateHeight);
      availableMetadata = Math.max(0, dateY - (date.hidden ? 0 : gap) - (startY + smallFont * 1.25 + gap));
    }
    let nextDensity = !artist.hidden ? 2 : !album.hidden ? 1 : 0;
    const fits = level => metadata.clientHeight + (previousDensity !== null && level > previousDensity ? 8 : 0) <= availableMetadata;
    if (!forceInfo) {
      if (!fits(nextDensity)) duration.hidden = true;
      if (!fits(nextDensity)) { artist.hidden = true; nextDensity = album.hidden ? 0 : 1; }
      if (!fits(nextDensity)) { album.hidden = true; nextDensity = 0; }
    } else {
      const budget = Math.min(availableMetadata, height - bottom - startY - dateHeight - gap * 2 - smallFont * 1.8);
      for (let i = 0; i < 20 && metadata.clientHeight > budget && metadataFont > 10; i++) {
        metadataFont = Math.max(10, metadataFont * .94); metadata.style.fontSize = metadataFont + 'px';
      }
    }
    densities[design] = nextDensity;
    const metadataY = Math.max(startY + smallFont * 1.25 + gap, dateY - (date.hidden ? 0 : gap) - metadata.clientHeight);
    metadata.style.top = metadataY + 'px';
    metadata.style.maxHeight = forceInfo ? '' : availableMetadata + 'px';
    root.dataset.information = forceInfo ? style.density : ['date', 'album-date', 'full'][nextDensity];
    const metadataHeight = metadata.clientHeight;
    const titleTop = startY + (forceInfo && metadataHeight ? metadataHeight + gap : 0) + (date.hidden ? 0 : dateHeight + gap);
    const maxHeight = Math.max(smallFont * 1.5, height - bottom - titleTop);
    const leading = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text.textContent) ? 1.08 : 1;
    sizer.textContent = text.textContent;
    Object.assign(sizer.style, { fontWeight: String(style.fontWeight), lineHeight: String(leading), fontSize: smallFont + 'px', width: 'max-content', whiteSpace: 'nowrap' });
    // Use the fitted font for both the visible mark and the measured drag bounds.
    const smallMarkSize = smallFont * 1.25, smallMarkGap = smallFont * .28;
    const smallWidth = Math.min(usable, smallMarkSize + smallMarkGap + sizer.clientWidth + 1);
    sizer.style.width = usable + 'px'; sizer.style.whiteSpace = 'normal';
    const minimumFont = forceInfo ? Math.max(10, Math.min(width * .10, smallFont * 1.3)) : width * .10;
    let font = Math.min(style.largeFont || width * .30, maxHeight / leading);
    sizer.style.fontSize = font + 'px';
    // Fit two line boxes; glyph overhang must not force a CJK title into tiny type.
    for (let i = 0; (!style.largeFont || forceInfo) && i < 30 && font > minimumFont && (sizer.clientHeight > maxHeight + .5 || sizer.clientHeight > font * leading * 2 + .5); i++) {
      font = Math.max(minimumFont, font * .94); sizer.style.fontSize = font + 'px';
    }
    const largeHeight = Math.min(maxHeight, height - bottom, font * leading * 2, Math.max(font * leading, sizer.clientHeight));
    sizer.style.width = 'max-content'; sizer.style.whiteSpace = 'nowrap';
    const largeWidth = Math.min(usable, Math.ceil(sizer.clientWidth) + 1);
    const endY = Math.max(0, height - bottom - largeHeight);
    geometry = { width, height, x, startY, endY, smallFont, smallWidth, smallMarkSize, smallMarkGap, leading, largeFont: font, largeWidth, largeHeight,
      dateY, endDateY: Math.max(startY, endY - gap - dateHeight),
      dateHeight, metadataY, metadataHeight, gap, forceInfo };
    measureKey = key;
    paint(progress);
    reflow(before);
  }
  function scheduleMeasure() { if (!disposed && !frame) frame = requestAnimationFrame(measure); }
  function animateTo(value) {
    stopReflows();
    cancelAnimationFrame(animation); animation = 0;
    if (!active || reduced.matches || !state.circuitStyle.animate || Math.abs(progress - value) < .001) { paint(value); return; }
    const from = progress, start = performance.now();
    const tick = now => {
      const time = Math.min(1, (now - start) / 360);
      paint(from + (value - from) * (1 - Math.pow(1 - time, 3)));
      animation = time < 1 && !disposed ? requestAnimationFrame(tick) : 0;
    };
    animation = requestAnimationFrame(tick);
  }
  function finish(commit) {
    if (!gesture) return;
    const old = gesture; gesture = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancelGesture);
    window.removeEventListener('blur', cancelGesture);
    title.removeEventListener('lostpointercapture', cancelGesture);
    if (title.hasPointerCapture(old.id)) title.releasePointerCapture(old.id);
    clearGesture?.(); clearGesture = null;
    root.classList.remove('is-title-dragging');
    const value = commit && old.moved ? (progress >= .5 ? 'bottom' : 'top') : old.position;
    if (value !== state.circuitTitlePosition) onPositionChange(value);
    animateTo(value === 'bottom' ? 1 : 0);
  }
  function cancelGesture() { finish(false); }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) { finish(false); return; }
    if (!gesture.moved && Math.abs(event.clientY - gesture.y) < 5) return;
    gesture.moved = true;
    root.classList.add('is-title-dragging');
    const travel = Math.max(24, geometry.endY - geometry.startY);
    paint(gesture.progress + (event.clientY - gesture.y) / travel);
  }
  function up(event) { if (gesture && event.pointerId === gesture.id) finish(true); }
  title.addEventListener('pointerdown', event => {
    if (state.circuitEditing) return;
    if (!active || !geometry || event.button !== 0 || !event.isPrimary) return;
    flushMetadata();
    event.preventDefault(); event.stopPropagation();
    title.focus({ preventScroll: true });
    cancelGesture();
    clearGesture = onGestureStart(cancelGesture);
    cancelAnimationFrame(animation); animation = 0;
    gesture = { id: event.pointerId, y: event.clientY, progress, position: state.circuitTitlePosition, moved: false };
    try { title.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('blur', cancelGesture);
    title.addEventListener('lostpointercapture', cancelGesture);
  });
  title.addEventListener('keydown', event => {
    if (state.circuitEditing) return;
    if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); cancelGesture(); return; }
    const value = ['ArrowDown', 'End'].includes(event.key) ? 'bottom' : ['ArrowUp', 'Home'].includes(event.key) ? 'top'
      : ['Enter', ' '].includes(event.key) ? (state.circuitTitlePosition === 'top' ? 'bottom' : 'top') : null;
    if (!value) return;
    flushMetadata();
    event.preventDefault(); event.stopPropagation();
    const clearKeyboardGesture = onGestureStart(cancelGesture);
    clearKeyboardGesture?.();
    cancelGesture(); onPositionChange(value); animateTo(value === 'bottom' ? 1 : 0);
  });
  editor = createCircuitEditor({ root, copy, fields, state, onStyleChange, onEditingChange, onGestureStart,
    beforeDrag() {
      flushMetadata();
      cancelGesture(); cancelAnimationFrame(animation); animation = 0;
      stopReflows(); paint(destination());
    },
    repaint() { paint(progress); }
  });
  const observer = new ResizeObserver(scheduleMeasure);
  observer.observe(copy);
  cover.onload = () => { if (!disposed && coverUrl) cover.hidden = false; };
  cover.onerror = () => { cover.hidden = true; };
  const onFonts = () => { fontRevision++; scheduleMeasure(); };
  const onReducedMotion = () => {
    if (!reduced.matches) return;
    cancelAnimationFrame(animation); animation = 0;
    stopReflows(); flushMetadata();
    if (!gesture) paint(destination());
  };
  document.fonts?.addEventListener('loadingdone', onFonts);
  reduced.addEventListener('change', onReducedMotion);
  return {
    update(data) {
      const clean = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
      const name = clean(data.title), performer = clean(data.artist), record = clean(data.album);
      const dateValue = clean(data.publishTime);
      const release = dateValue && dateValue !== '未知发行时间' ? dateValue : clean(data.year);
      const seconds = Number.isFinite(data.duration) && data.duration > 0 ? Math.round(data.duration) : 0;
      const length = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
      const key = JSON.stringify([name, performer, record, release, length]);
      if (metadataKey === key) {
        clearTimeout(metadataTimer); metadataTimer = 0; queuedMetadata = null; metadataStarted = 0;
      } else if (queuedMetadata?.key !== key) {
        const now = performance.now();
        if (!queuedMetadata) metadataStarted = now;
        queuedMetadata = { key, name, performer, record, release, length };
        clearTimeout(metadataTimer);
        if (!active || !geometry || !state.circuitStyle.animate || reduced.matches || state.circuitEditing) commitMetadata(true);
        // Coalesce delayed album/date/duration into one layout without delaying progress or input.
        else metadataTimer = setTimeout(commitMetadata, Math.max(0, Math.min(96, 240 - (now - metadataStarted))));
      }
      const url = clean(data.coverUrl);
      if (url !== coverUrl) {
        coverUrl = url;
        cover.hidden = true;
        if (url) cover.src = url;
        else cover.removeAttribute('src');
      }
    },
    sync() {
      const enabled = state.layout === 'circuit';
      if (active !== enabled) { measureKey = ''; pendingBefore = null; }
      editor.cancel();
      if (!enabled) { cancelGesture(); editor.cancel(); stopReflows(); }
      active = enabled; root.hidden = !enabled; root.inert = !enabled;
      commitMetadata(true);
      card.classList.toggle('is-circuit-editing', enabled && state.circuitEditing);
      title.setAttribute('aria-description', state.circuitEditing ? '拖动调整位置；方向键微调，Alt 加左右方向键贴边，Enter 完成' : '上下拖动改变排版；上下方向键也可切换');
      const body = card.querySelector('.card-body');
      body.inert = enabled;
      if (enabled && body.contains(document.activeElement)) document.activeElement.blur();
      editor.sync();
      scheduleMeasure();
      if (Math.abs(progress - destination()) > .001) animateTo(destination());
    },
    dispose() {
      disposed = true; cancelGesture();
      clearTimeout(metadataTimer); queuedMetadata = null;
      card.classList.remove('is-circuit-editing');
      editor.dispose(); stopReflows();
      cancelAnimationFrame(frame); cancelAnimationFrame(animation);
      observer.disconnect();
      cover.onload = cover.onerror = null;
      document.fonts?.removeEventListener('loadingdone', onFonts);
      reduced.removeEventListener('change', onReducedMotion);
      sizer.remove();
    }
  };
}
