// Editing keeps pointer previews separate from saved layout positions.
export function createCircuitEditor({ root, copy, fields, state, onStyleChange, onEditingChange,
  onGestureStart, beforeDrag = () => {}, repaint = () => {} }) {
  const entries = Object.entries(fields).filter(([, element]) => element);
  const document = root.ownerDocument;
  const window = document.defaultView;
  const defaults = { top: {}, bottom: {} };
  const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));
  const slot = () => state.circuitTitlePosition === 'bottom' ? 'bottom' : 'top';
  const originals = new Map(entries.map(([, element]) => [element, {
    tabIndex: element.getAttribute('tabindex'), role: element.getAttribute('role'),
    shortcuts: element.getAttribute('aria-keyshortcuts'), noDrag: element.classList.contains('no-drag')
  }]));
  const listeners = [];
  let gesture = null, draft = null, clearGesture = null, paintFrame = 0;
  let disposed = false, wasEditing = false;

  const toolbar = document.createElement('div');
  toolbar.className = 'circuit-editor-toolbar no-drag';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '排版编辑');
  toolbar.hidden = true;
  toolbar.inert = true;
  const hint = document.createElement('span');
  hint.className = 'circuit-editor-hint';
  hint.textContent = '拖动文字调整位置';
  const done = document.createElement('button');
  done.className = 'circuit-editor-done no-drag';
  done.type = 'button';
  done.textContent = '完成';
  toolbar.append(hint, done);
  root.appendChild(toolbar);

  function bind(element, name, listener, options) {
    element.addEventListener(name, listener, options);
    listeners.push(() => element.removeEventListener(name, listener, options));
  }
  function clonePositions() {
    const source = state.circuitStyle?.positions || defaults;
    const result = { top: {}, bottom: {} };
    for (const design of ['top', 'bottom']) {
      for (const [name] of entries) {
        const position = source[design]?.[name];
        if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
          result[design][name] = {
            x: clamp(position.x, 1), y: clamp(position.y, 1),
            align: ['left', 'center', 'right'].includes(position.align) ? position.align : 'left'
          };
        }
      }
    }
    return result;
  }
  function schedulePaint() {
    if (!disposed && !paintFrame) paintFrame = window.requestAnimationFrame(() => {
      paintFrame = 0;
      if (!disposed) repaint();
    });
  }
  function geometry(element) {
    const area = copy.getBoundingClientRect(), bounds = element.getBoundingClientRect();
    if (!(area.width > 0 && area.height > 0 && bounds.width > 0 && bounds.height > 0)) return null;
    return { x: bounds.left - area.left, y: bounds.top - area.top,
      width: area.width, height: area.height, fieldWidth: bounds.width, fieldHeight: bounds.height };
  }
  function position(bounds, x, y, { pointer = false, edge = null } = {}) {
    const maximum = Math.max(0, bounds.width - bounds.fieldWidth);
    let left = clamp(x, maximum), align = 'left';
    const threshold = pointer ? 8 : .001;
    if (edge === 'left' || (edge !== 'right' && left <= threshold && left <= maximum - left)) {
      left = 0;
    } else if (edge === 'right' || maximum - left <= threshold) {
      left = maximum; align = 'right';
    } else if (left + bounds.fieldWidth / 2 > bounds.width / 2) {
      align = 'right';
    }
    // The stored x is the chosen edge, while drag and key deltas always use the actual visual left.
    const anchor = align === 'right' ? left + bounds.fieldWidth : left;
    return { x: clamp(anchor / bounds.width, 1),
      y: clamp(y, Math.max(0, bounds.height - bounds.fieldHeight)) / bounds.height, align };
  }
  function finish(commit) {
    if (!gesture) return;
    const previous = gesture, positions = draft;
    gesture = null; draft = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancelGesture);
    window.removeEventListener('blur', cancelGesture);
    previous.element.removeEventListener('lostpointercapture', cancelGesture);
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id);
    clearGesture?.(); clearGesture = null;
    if (paintFrame) window.cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    previous.element.classList.remove('is-field-dragging');
    root.classList.remove('is-edit-dragging');
    if (commit && previous.moved && positions) onStyleChange({ positions });
    repaint();
  }
  function cancelGesture() { finish(false); }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!state.circuitEditing || gesture.slot !== slot()) { cancelGesture(); return; }
    if (event.pointerType === 'mouse' && event.buttons === 0) { cancelGesture(); return; }
    const x = event.clientX - gesture.clientX, y = event.clientY - gesture.clientY;
    if (!gesture.moved && Math.hypot(x, y) < 2) return;
    event.preventDefault();
    gesture.moved = true;
    gesture.element.classList.add('is-field-dragging');
    root.classList.add('is-edit-dragging');
    draft[gesture.slot][gesture.name] = position(gesture.bounds, gesture.bounds.x + x, gesture.bounds.y + y, { pointer: true });
    schedulePaint();
  }
  function up(event) { if (gesture && event.pointerId === gesture.id) finish(true); }
  function start(name, element, event) {
    if (disposed || !state.circuitEditing || event.button !== 0 || !event.isPrimary || element.hidden) return;
    event.preventDefault(); event.stopPropagation();
    cancelGesture(); beforeDrag();
    const cleanup = onGestureStart?.(cancelGesture);
    const bounds = geometry(element);
    if (!bounds) { cleanup?.(); return; }
    element.focus({ preventScroll: true });
    clearGesture = cleanup;
    draft = clonePositions();
    gesture = { name, element, id: event.pointerId, slot: slot(), bounds,
      clientX: event.clientX, clientY: event.clientY, moved: false };
    try { element.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('blur', cancelGesture);
    element.addEventListener('lostpointercapture', cancelGesture);
  }
  function complete() {
    finish(true);
    onEditingChange(false);
  }
  function keyDown(name, element, event) {
    if (!state.circuitEditing || disposed) return;
    event.stopPropagation();
    // Tab keeps the ordinary field-to-field focus order.
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') {
      if (gesture) cancelGesture();
      else onEditingChange(false);
      return;
    }
    if (event.key === 'Enter') { complete(); return; }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    cancelGesture(); beforeDrag();
    const cleanup = onGestureStart?.(cancelGesture);
    const bounds = geometry(element);
    cleanup?.();
    if (!bounds) return;
    const next = clonePositions(), step = event.shiftKey ? 8 : 1;
    const edge = event.altKey && event.key === 'ArrowLeft' ? 'left'
      : event.altKey && event.key === 'ArrowRight' ? 'right' : null;
    next[slot()][name] = position(bounds, bounds.x + direction[0] * step, bounds.y + direction[1] * step, { edge });
    onStyleChange({ positions: next });
  }
  for (const [name, element] of entries) {
    bind(element, 'pointerdown', event => start(name, element, event));
    bind(element, 'keydown', event => keyDown(name, element, event));
  }
  bind(window, 'keydown', event => {
    if (!gesture || !state.circuitEditing || !['Escape', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    event.key === 'Escape' ? cancelGesture() : complete();
  }, true);
  bind(done, 'click', event => { event.stopPropagation(); complete(); });
  bind(done, 'keydown', event => {
    if (!state.circuitEditing) return;
    event.stopPropagation();
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Enter' || event.key === ' ') complete();
    else if (event.key === 'Escape') { cancelGesture(); onEditingChange(false); }
  });

  function restore(element, previous) {
    for (const [name, value] of [['tabindex', previous.tabIndex], ['role', previous.role], ['aria-keyshortcuts', previous.shortcuts]]) {
      value === null ? element.removeAttribute(name) : element.setAttribute(name, value);
    }
    if (!previous.noDrag) element.classList.remove('no-drag');
  }
  function sync() {
    if (disposed) return;
    const editing = state.circuitEditing === true;
    if (gesture && (!editing || gesture.slot !== slot())) cancelGesture();
    root.classList.toggle('is-editing', editing);
    toolbar.hidden = !editing; toolbar.inert = !editing;
    for (const [, element] of entries) {
      if (editing) {
        element.tabIndex = 0;
        if (element.tagName !== 'BUTTON') element.setAttribute('role', 'button');
        element.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Alt+ArrowLeft Alt+ArrowRight Enter Escape');
        element.classList.add('no-drag');
      } else restore(element, originals.get(element));
    }
    if (wasEditing && !editing && (document.activeElement === done || entries.some(([, element]) => element !== fields.title && element === document.activeElement))) {
      fields.title?.focus({ preventScroll: true });
    }
    wasEditing = editing;
  }
  sync();
  return {
    positions: () => draft || state.circuitStyle?.positions || defaults,
    isDragging: () => Boolean(gesture || draft),
    cancel: cancelGesture,
    sync,
    dispose() {
      if (disposed) return;
      cancelGesture(); disposed = true;
      if (paintFrame) window.cancelAnimationFrame(paintFrame);
      for (const remove of listeners) remove();
      for (const [, element] of entries) restore(element, originals.get(element));
      root.classList.remove('is-editing', 'is-edit-dragging');
      toolbar.remove();
    }
  };
}
