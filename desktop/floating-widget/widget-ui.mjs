export function createMorphSlot(container, initialText, faceClass, motion) {
  if (!container) return { update() {}, getText: () => initialText };
  container.innerHTML = '';
  const faceA = document.createElement('span');
  faceA.className = `${faceClass} morph-face`;
  faceA.textContent = initialText;
  const faceB = document.createElement('span');
  faceB.className = `${faceClass} morph-face`;
  faceB.textContent = '';
  container.appendChild(faceA);
  container.appendChild(faceB);
  faceA.style.opacity = '1';
  faceB.style.opacity = '0';
  faceB.setAttribute('aria-hidden', 'true');

  let active = faceA;
  let idle = faceB;
  let text = initialText;

  return {
    update(next) {
      const value = (next || '').trim() || ' ';
      if (value === text) return;
      text = value;
      idle.textContent = value;
      motion.swap(active, idle);
      const tmp = active;
      active = idle;
      idle = tmp;
    },
    getText: () => text
  };
}

export function createIconSlot(iconA, iconB, motion) {
  iconA.style.opacity = '1';
  iconB.style.opacity = '0';
  iconB.setAttribute('aria-hidden', 'true');
  let isA = true;
  return {
    showA() {
      if (isA) return;
      isA = true;
      motion.swap(iconB, iconA);
    },
    showB() {
      if (!isA) return;
      isA = false;
      motion.swap(iconA, iconB);
    }
  };
}

export function createCoverTint() {
  let latestTintUrl = "";
  const tintCache = new Map();

  function applyTint(hex) {
    document.documentElement.style.setProperty('--cover-tint', hex);
  }

  function extractTint(url) {
    latestTintUrl = url;
    if (!url) {
      applyTint('#3b82f6');
      return;
    }
    if (tintCache.has(url)) {
      applyTint(tintCache.get(url));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (url !== latestTintUrl) return;
      try {
        const size = 12;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 125) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (!count) return;
        const hex = normalizeTint(r / count, g / count, b / count);
        tintCache.set(url, hex);
        while (tintCache.size > 128) tintCache.delete(tintCache.keys().next().value);
        applyTint(hex);
      } catch (e) {
        // 跨域画布被拒时静默保留上一个色值
      }
    };
    img.onerror = () => {};
    img.src = url;
  }

  // 压暗与限制饱和，保证白色文字在任何封面上都可读
  function normalizeTint(r, g, b) {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const targetL = Math.min(0.42, Math.max(0.2, l));
    const k = l > 0 ? targetL / l : 1;
    const to = (v) => Math.round(Math.max(0, Math.min(255, v * k)));
    const hx = (v) => to(v).toString(16).padStart(2, '0');
    return `#${hx(r)}${hx(g)}${hx(b)}`;
  }

  return extractTint;
}
