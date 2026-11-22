const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const MOVING = '.cover, .main, .poster-bottom';
// Revealing progress must not translate the playback buttons away from a click.
const FADING = '.row-bottom, .song-title-wrap, .karaoke, .progress, .karaoke-next, .poster-lyric-box, .poster-line-2, .poster-time, .poster-fab, .album-heading, .song-artist-wrap';

// Layout changes take effect immediately. Animations never gate input or settings.
export function createMotionController(card) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const runs = new Map();
  const layoutRuns = new Set();
  let pending = null;
  let disposed = false;
  const calm = () => disposed || document.hidden || reduced.matches;

  function run(element, frames, duration, layout = false, cleanup = () => {}) {
    runs.get(element)?.cancel();
    if (calm() || typeof element.animate !== 'function') { cleanup(); return; }
    const animation = element.animate(frames, { duration, easing: EASING });
    runs.set(element, animation);
    if (layout) layoutRuns.add(animation);
    const finish = () => {
      if (runs.get(element) === animation) runs.delete(element);
      layoutRuns.delete(animation);
      cleanup();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }
  function stopLayout() {
    for (const animation of [...layoutRuns]) animation.cancel();
    layoutRuns.clear();
  }
  function stop() {
    pending = null;
    for (const animation of [...runs.values()]) animation.cancel();
    runs.clear();
    layoutRuns.clear();
  }
  function prepare() {
    if (pending || calm()) return;
    const records = [...card.querySelectorAll(MOVING + ', ' + FADING)].map(element => {
      const rect = element.getBoundingClientRect();
      const display = getComputedStyle(element).display;
      const visible = display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      let clone = null;
      if (visible && element.matches(FADING)) {
        clone = element.cloneNode(true);
        const originals = [element, ...element.querySelectorAll('*')];
        const copies = [clone, ...clone.querySelectorAll('*')];
        originals.forEach((original, index) => {
          const copy = copies[index];
          copy.removeAttribute('id');
          copy.style.setProperty('display', getComputedStyle(original).display, 'important');
          copy.style.setProperty('-webkit-app-region', 'initial', 'important');
          // Canvas pixels are not included in cloneNode. Keep the painted glyphs
          // in the exit layer instead of fading an empty, transparent text clone.
          if (original.tagName === 'CANVAS' && original.width > 0 && original.height > 0) {
            try {
              copy.width = original.width;
              copy.height = original.height;
              const context = copy.getContext('2d');
              if (!context) throw new Error('Canvas context unavailable');
              context.drawImage(original, 0, 0);
            } catch {
              copy.parentElement?.classList.remove('lyric-canvas-text');
              copy.style.setProperty('display', 'none', 'important');
            }
          }
        });
      }
      return { element, rect, display, visible, clone };
    });
    const style = getComputedStyle(card);
    pending = {
      records, classes: card.className, rect: card.getBoundingClientRect(),
      tokens: ['--type-title', '--type-small', '--type-body', '--lyric-font-size', '--cover-tint', '--poster-title-size', '--poster-fab-size'].map(name => [name, style.getPropertyValue(name)])
    };
    // Capture the current pixels before interrupting a previous transition.
    stopLayout();
  }
  function commit() {
    const before = pending;
    pending = null;
    if (!before || calm() || card.classList.contains('has-overlay')) return;
    const after = new Map(before.records.map(({ element }) => [element, element.getBoundingClientRect()]));
    const hidden = before.records.filter(record => record.visible && record.clone && !(after.get(record.element).width > 0 && after.get(record.element).height > 0));
    // Native resizing changes the clip every frame; keep exits inside the live card.
    const changingFrame = card.classList.contains('is-resizing') || card.classList.contains('is-window-animating');
    const ghosts = changingFrame ? [] : hidden.filter(record => !hidden.some(parent => parent !== record && parent.element.contains(record.element)));
    if (ghosts.length) {
      const currentRect = card.getBoundingClientRect();
      const layer = document.createElement('div');
      layer.className = before.classes + ' motion-layer';
      layer.inert = true;
      layer.setAttribute('aria-hidden', 'true');
      layer.style.setProperty('-webkit-app-region', 'initial', 'important');
      Object.assign(layer.style, {
        left: currentRect.left + 'px', top: currentRect.top + 'px',
        width: currentRect.width + 'px', height: currentRect.height + 'px',
        borderRadius: getComputedStyle(card).borderRadius, overflow: 'hidden', opacity: '0'
      });
      for (const [name, value] of before.tokens) layer.style.setProperty(name, value);
      for (const record of ghosts) {
        Object.assign(record.clone.style, {
          position: 'absolute', margin: '0',
          left: (record.rect.left - currentRect.left) + 'px', top: (record.rect.top - currentRect.top) + 'px',
          width: record.rect.width + 'px', height: record.rect.height + 'px'
        });
        layer.appendChild(record.clone);
      }
      document.body.appendChild(layer);
      run(layer, [{ opacity: 1 }, { opacity: 0 }], 140, true, () => layer.remove());
    }
    for (const record of before.records) {
      const next = after.get(record.element);
      if (!(next.width > 0 && next.height > 0)) continue;
      if (!record.visible) {
        run(record.element, [{ opacity: 0 }, { opacity: 1 }], 180, true);
      } else if (record.element.matches(MOVING)) {
        const x = record.rect.left - next.left;
        const y = record.rect.top - next.top;
        const artwork = record.element.matches('.cover');
        const scale = artwork ? record.rect.width / next.width : 1;
        if (Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(scale - 1) < 0.01) continue;
        // One scale factor preserves the image ratio. CSS eases the clipped
        // frame's dimensions; object-fit keeps the artwork itself undistorted.
        run(record.element, [
          { transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: '0 0' },
          { transform: 'none', transformOrigin: '0 0' }
        ], 240, true);
      }
    }
  }
  function swap(outgoing, incoming) {
    const outOpacity = getComputedStyle(outgoing).opacity;
    const inOpacity = getComputedStyle(incoming).opacity;
    runs.get(outgoing)?.cancel();
    runs.get(incoming)?.cancel();
    outgoing.style.opacity = '0';
    incoming.style.opacity = '1';
    outgoing.setAttribute('aria-hidden', 'true');
    incoming.setAttribute('aria-hidden', 'false');
    run(outgoing, [{ opacity: outOpacity }, { opacity: 0 }], 120);
    run(incoming, [{ opacity: inOpacity }, { opacity: 1 }], 180);
  }
  const onVisibility = () => { if (document.hidden) stop(); };
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', stop);
  return {
    prepare, commit, swap, stopLayout,
    resetLayout() { pending = null; stopLayout(); },
    reveal(element) { run(element, [{ opacity: 0 }, { opacity: 1 }], 180); },
    dispose() {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', stop);
    }
  };
}
