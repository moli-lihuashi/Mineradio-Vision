// A select-only combobox: keep the native value and change event contract,
// with an anchored list that can escape a scrolling or clipped settings group.
export function createMotionSelect(native, { descriptions = {}, icons = {} } = {}) {
  const root = document.createElement('div');
  root.className = 'motion-select';
  native.before(root);
  root.appendChild(native);
  native.hidden = true;
  const label = document.querySelector(`label[for="${native.id}"]`);
  if (label && !label.id) label.id = native.id + '-label';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = native.id + '-trigger';
  trigger.className = 'motion-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', native.id + '-list');
  trigger.innerHTML = '<span class="select-value"></span><svg class="select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  const value = trigger.querySelector('.select-value');
  value.id = native.id + '-value';
  trigger.setAttribute('aria-labelledby', [label?.id, value.id].filter(Boolean).join(' '));
  if (native.getAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', native.getAttribute('aria-describedby'));
  root.appendChild(trigger);
  if (label) label.htmlFor = trigger.id;

  const panel = document.createElement('div');
  panel.id = native.id + '-list';
  panel.className = 'motion-select-panel';
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-labelledby', label?.id || trigger.id);
  panel.hidden = true;
  panel.inert = true;
  (native.closest('#sheet') || document.body).appendChild(panel);
  const options = [...native.options].map((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = native.id + '-option-' + index;
    button.className = 'motion-select-option';
    button.setAttribute('role', 'option');
    button.tabIndex = -1;
    button.disabled = option.disabled;
    const icon = document.createElement('span');
    icon.className = 'select-option-icon';
    icon.setAttribute('aria-hidden', 'true');
    // Icon paths are local constants supplied by the caller.
    icon.innerHTML = `<svg viewBox="0 0 24 24">${icons[option.value] || '<path d="M6 12h12"/>'}</svg>`;
    const copy = document.createElement('span');
    copy.className = 'select-option-copy';
    const title = document.createElement('span');
    title.textContent = option.text;
    const description = document.createElement('span');
    description.className = 'select-option-description';
    description.textContent = descriptions[option.value] || '';
    copy.append(title, description);
    const check = document.createElement('span');
    check.className = 'select-option-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    button.append(icon, copy, check);
    panel.appendChild(button);
    button.addEventListener('pointermove', () => highlight(index));
    button.addEventListener('click', () => choose(index));
    return { native: option, button };
  });

  let opened = false;
  let active = -1;
  let closing = null;
  let typeahead = '';
  let typeaheadAt = 0;
  const animations = new Set();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => options.map((option, index) => option.native.disabled ? -1 : index).filter(index => index >= 0);
  const stopAnimations = () => { for (const animation of animations) animation.cancel(); animations.clear(); closing = null; };
  const animate = (element, frames, timing) => {
    if (reduce.matches) return null;
    const animation = element.animate(frames, timing);
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation)).catch(() => {});
    return animation;
  };

  function highlight(index) {
    if (!options[index] || options[index].native.disabled) return;
    active = index;
    for (const [i, option] of options.entries()) option.button.classList.toggle('is-active', i === active);
    if (opened) {
      trigger.setAttribute('aria-activedescendant', options[index].button.id);
      options[index].button.scrollIntoView({ block: 'nearest' });
    }
  }
  function sync() {
    value.textContent = native.selectedOptions[0]?.text || '';
    trigger.disabled = native.disabled;
    for (const option of options) {
      option.button.setAttribute('aria-selected', String(option.native.value === native.value));
      option.button.disabled = option.native.disabled;
    }
    if (native.disabled) close(false);
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 304), innerWidth - 24);
    panel.style.width = width + 'px';
    panel.style.maxHeight = 'none';
    const natural = panel.scrollHeight;
    const below = innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const top = below < natural && above > below;
    const available = Math.max(56, top ? above : below);
    panel.style.maxHeight = available + 'px';
    const height = Math.min(natural, available);
    const left = Math.max(12, Math.min(rect.right - width, innerWidth - width - 12));
    panel.style.left = left + 'px';
    const y = Math.max(12, Math.min(top ? rect.top - height - 8 : rect.bottom + 8, innerHeight - height - 12));
    // An upward list grows from the trigger rather than from its final top edge.
    panel.style.top = top ? 'auto' : y + 'px';
    panel.style.bottom = top ? innerHeight - y - height + 'px' : 'auto';
    panel.dataset.placement = top ? 'top' : 'bottom';
    root.dataset.placement = panel.dataset.placement;
    return { height, direction: top ? 1 : -1 };
  }
  function open() {
    if (opened || native.disabled) return;
    stopAnimations();
    opened = true;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    panel.inert = false;
    panel.style.pointerEvents = 'auto';
    const { height, direction } = position();
    highlight(options.findIndex(option => option.native.value === native.value));
    animate(panel, [
      { height: '0px', opacity: 0, transform: `translateY(${direction * 6}px)` },
      { height: height + 'px', opacity: 1, transform: 'translateY(0)' }
    ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' });
    for (const [index, option] of options.entries()) {
      animate(option.button, [{ opacity: 0, transform: `translateY(${direction * 4}px)` }, { opacity: 1, transform: 'translateY(0)' }], {
        duration: 160, delay: 25 + index * 25, easing: 'ease-out', fill: 'backwards'
      });
    }
  }
  function close(restoreFocus = false, immediate = false) {
    if (!opened && panel.hidden) return;
    stopAnimations();
    opened = false;
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    panel.inert = true;
    panel.style.pointerEvents = 'none';
    closing = immediate ? null : animate(panel, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(${panel.dataset.placement === 'top' ? 3 : -3}px)` }], { duration: 120, easing: 'ease-out' });
    if (closing) {
      const animation = closing;
      animation.finished.then(() => { if (!opened && closing === animation) { panel.hidden = true; closing = null; } }).catch(() => {});
    } else panel.hidden = true;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function choose(index) {
    const option = options[index];
    if (!option || option.native.disabled) return;
    const changed = native.value !== option.native.value;
    native.value = option.native.value;
    sync();
    close(true);
    if (changed) native.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function onKey(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') { close(false); return; }
    if (event.key === 'Escape') {
      if (!opened) return;
      event.preventDefault(); event.stopPropagation(); close(true); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (opened) choose(active); else open();
      return;
    }
    const indexes = enabled();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!opened) { open(); return; }
      const current = indexes.indexOf(active);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? indexes.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : indexes.length - 1)) % indexes.length;
      highlight(indexes[index]);
    } else if (event.key.length === 1) {
      event.preventDefault();
      const now = performance.now();
      typeahead = now - typeaheadAt < 650 ? typeahead + event.key : event.key;
      typeaheadAt = now;
      const index = options.findIndex(option => !option.native.disabled && option.native.text.toLocaleLowerCase().startsWith(typeahead.toLocaleLowerCase()));
      if (index < 0) return;
      if (opened) highlight(index); else choose(index);
    }
  }
  const inside = target => root.contains(target) || panel.contains(target);
  const onOutside = event => { if (opened && !inside(event.target)) close(false); };
  const onScroll = event => { if (opened && !panel.contains(event.target)) close(false, true); };
  const onResize = () => { if (opened) position(); };
  trigger.addEventListener('click', () => opened ? close(false) : open());
  trigger.addEventListener('keydown', onKey);
  panel.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('focusin', onOutside);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  sync();
  return {
    sync, close,
    dispose() {
      close(false, true);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      trigger.removeEventListener('keydown', onKey);
      panel.remove();
    }
  };
}
