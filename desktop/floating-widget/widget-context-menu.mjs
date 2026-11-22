// The menu owns interaction and motion; the widget owns window bounds and actions.
const EDGE = 8;
const PRESS_DELAY = 520;
const PRESS_TOLERANCE = 10;
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

export function createContextMenu({ menu, trigger, canOpen = () => true, onBeforeOpen, onOpen, onClose, onSelect }) {
  const items = [...menu.querySelectorAll('[data-menu-item]')];
  const active = menu.querySelector('.menu-active');
  let opened = false;
  let origin = null;
  let priorFocus = null;
  let currentItem = null;
  let openFrame = 0;
  let prepareFrame = 0;
  let lastOpen = 0;
  let lastPoint = null;
  let pressTimer = 0;
  let pressOrigin = null;
  let typeahead = '';
  let typeaheadTimer = 0;

  const enabledItems = () => items.filter(item => !item.disabled && item.getAttribute('aria-disabled') !== 'true');

  function select(item, focus = false) {
    if (!item || item.disabled || item.getAttribute('aria-disabled') === 'true') return;
    currentItem = item;
    for (const candidate of items) candidate.classList.toggle('is-active', candidate === item);
    const rect = item.getBoundingClientRect();
    const base = menu.getBoundingClientRect();
    active.style.width = rect.width + 'px';
    active.style.height = rect.height + 'px';
    active.style.transform = `translate3d(${Math.round(rect.left - base.left + menu.scrollLeft)}px, ${Math.round(rect.top - base.top + menu.scrollTop)}px, 0)`;
    active.style.opacity = '1';
    if (focus) item.focus({ preventScroll: true });
  }

  function position() {
    if (!opened || !origin) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const pointX = origin.x - window.screenX;
    const pointY = origin.y - window.screenY;
    const left = clamp(pointX, EDGE, Math.max(EDGE, window.innerWidth - width - EDGE));
    const top = clamp(pointY, EDGE, Math.max(EDGE, window.innerHeight - height - EDGE));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    const x = clamp(pointX - left, 0, width);
    const y = clamp(pointY - top, 0, height);
    menu.style.setProperty('--menu-start-clip', `inset(${clamp(y - EDGE, 0, height)}px ${clamp(width - x - EDGE, 0, width)}px ${clamp(height - y - EDGE, 0, height)}px ${clamp(x - EDGE, 0, width)}px round 10px)`);
    if (currentItem) select(currentItem);
  }

  function close(reason = 'dismiss', selectedId = '') {
    if (!opened) return;
    opened = false;
    cancelAnimationFrame(prepareFrame);
    cancelAnimationFrame(openFrame);
    menu.style.display = 'none';
    menu.classList.remove('is-open');
    menu.inert = true;
    menu.setAttribute('aria-hidden', 'true');
    active.style.opacity = '0';
    for (const item of items) item.classList.remove('is-active');
    currentItem = null;
    typeahead = '';
    clearTimeout(typeaheadTimer);
    onClose({ reason, selectedId });
    if (reason === 'keyboard' && priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
  }

  function open(x, y, modality = 'pointer') {
    if (!canOpen() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const screenOrigin = { x: window.screenX + x, y: window.screenY + y };
    const now = Date.now();
    if (opened && lastPoint && now - lastOpen < 100 && Math.hypot(lastPoint.x - x, lastPoint.y - y) < 16) return;
    lastOpen = now;
    lastPoint = { x, y };
    cancelAnimationFrame(prepareFrame);
    cancelAnimationFrame(openFrame);
    if (!opened) {
      priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
      onBeforeOpen();
      opened = true;
      menu.style.display = 'flex';
      menu.inert = false;
      menu.setAttribute('aria-hidden', 'false');
      onOpen();
    }
    origin = screenOrigin;
    menu.dataset.modality = modality;
    menu.scrollTop = 0;
    menu.classList.remove('is-open');
    position();
    menu.style.clipPath = modality === 'keyboard' ? 'inset(0 round 12px)' : menu.style.getPropertyValue('--menu-start-clip');
    menu.style.opacity = '0';
    const first = enabledItems()[0];
    if (first) {
      active.style.transition = 'none';
      select(first, true);
    }
    prepareFrame = requestAnimationFrame(() => {
      if (!opened) return;
      active.style.transition = '';
      openFrame = requestAnimationFrame(() => {
        if (!opened) return;
        menu.classList.add('is-open');
        menu.style.clipPath = 'inset(0 round 12px)';
        menu.style.opacity = '1';
      });
    });
  }

  function onKeyDown(event) {
    if (!opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close('keyboard');
      return;
    }
    if (event.key === 'Tab') { close('tab'); return; }
    const available = enabledItems();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      if (!available.length) return;
      const index = available.indexOf(document.activeElement);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : index < 0 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
      select(available[target], true);
      available[target].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.stopPropagation();
      typeahead += event.key.toLocaleLowerCase();
      clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => { typeahead = ''; }, 500);
      const match = available.find(item => (item.dataset.label || item.textContent || '').trim().toLocaleLowerCase().startsWith(typeahead));
      if (match) { select(match, true); match.scrollIntoView({ block: 'nearest' }); }
    }
  }

  function onPointerDown(event) {
    if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || event.target.closest('button, input, select, textarea, .sheet, .menu, .grip')) return;
    pressOrigin = { x: event.clientX, y: event.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      const point = pressOrigin;
      pressOrigin = null;
      if (point) open(point.x, point.y, 'touch');
    }, PRESS_DELAY);
  }
  function cancelPress() { clearTimeout(pressTimer); pressTimer = 0; pressOrigin = null; }
  function onPointerMove(event) {
    if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > PRESS_TOLERANCE) cancelPress();
  }
  function onOutsideClick(event) {
    if (opened && !menu.contains(event.target)) close();
  }
  function onClick(event) {
    const item = event.target.closest('[data-menu-item]');
    if (!opened || !item || item.disabled || item.getAttribute('aria-disabled') === 'true') return;
    event.stopPropagation();
    const id = item.id;
    close('select', id);
    onSelect(id);
  }
  function onMove(event) {
    const item = event.target.closest('[data-menu-item]');
    if (item && event.pointerType !== 'touch') select(item, true);
  }
  function onWindowKeyDown(event) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      if (!canOpen()) return;
      event.preventDefault();
      if (!opened) open(window.innerWidth / 2, window.innerHeight / 2, 'keyboard');
    }
  }

  menu.addEventListener('keydown', onKeyDown);
  menu.addEventListener('click', onClick);
  menu.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', cancelPress);
  window.addEventListener('pointercancel', cancelPress);
  window.addEventListener('click', onOutsideClick);
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('resize', position);
  window.addEventListener('blur', cancelPress);
  return {
    open, close, position,
    isOpen: () => opened,
    dispose() {
      close();
      menu.removeEventListener('keydown', onKeyDown);
      menu.removeEventListener('click', onClick);
      menu.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', cancelPress);
      window.removeEventListener('pointercancel', cancelPress);
      window.removeEventListener('click', onOutsideClick);
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('resize', position);
      window.removeEventListener('blur', cancelPress);
      cancelPress();
      clearTimeout(typeaheadTimer);
    }
  };
}
