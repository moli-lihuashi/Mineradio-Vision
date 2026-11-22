/**
 * widget-tooltip.mjs
 * 
 * 基于 Transitions.dev 共享磁吸浮动气泡 (Shared Traveling Tooltip) 物理动效规范：
 * - 单组共用单例气泡，在各触发项之间横向平滑过渡 (160ms cubic-bezier(0.22, 1, 0.36, 1))
 * - 进入带 80ms 延迟防误触，离开快速 50ms 隐退，重定向 (Retargeting) 零延迟直接滑动
 * - 进度条时间探针 (Scrubber Hover Probe) 精准显示时间戳与相对剩余时间
 * - 歌曲元数据与音轨信息悬停高密度展开卡 (Metadata Rich Popover)
 */

export function createTooltipController({ card, track, sheet, state, formatTime }) {
  const $ = (id) => document.getElementById(id);

  // ==========================================================================
  // 1. 组级共享气泡 (Transitions.dev Shared Traveling Tooltips)
  // ==========================================================================
  function initGroup(group) {
    if (!group) return;
    let tt = group.querySelector(':scope > .t-tt');
    if (!tt) {
      tt = document.createElement('span');
      tt.className = 't-tt';
      tt.setAttribute('role', 'tooltip');
      tt.setAttribute('aria-hidden', 'true');
      tt.setAttribute('data-show', 'false');
      const textSpan = document.createElement('span');
      textSpan.className = 't-tt-text';
      tt.appendChild(textSpan);
      group.appendChild(tt);
    }
    const ttText = tt.querySelector('.t-tt-text');

    const triggers = group.querySelectorAll('[data-tooltip]');
    triggers.forEach((trigger) => {
      trigger.classList.add('t-tt-trigger');
      
      trigger.addEventListener('mouseenter', () => {
        const text = trigger.getAttribute('data-tooltip');
        if (!text) return;
        ttText.textContent = text;

        // 测量气泡尺寸并居中对齐触发按钮
        tt.style.width = 'auto';
        const measuredWidth = Math.ceil(tt.offsetWidth || (ttText.scrollWidth + 20));
        tt.style.width = `${measuredWidth}px`;

        const groupRect = group.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        let targetX = (triggerRect.left - groupRect.left) + (triggerRect.width / 2) - (measuredWidth / 2);

        // 限制在容器安全边距内，避免溢出
        const maxX = Math.max(0, groupRect.width - measuredWidth - 2);
        targetX = Math.max(2, Math.min(maxX, targetX));

        tt.style.setProperty('--tt-x', `${Math.round(targetX)}px`);
        tt.setAttribute('data-show', 'true');
        tt.setAttribute('aria-hidden', 'false');
      });
    });

    group.addEventListener('mouseleave', () => {
      tt.setAttribute('data-show', 'false');
      tt.setAttribute('aria-hidden', 'true');
    });
  }

  // ==========================================================================
  // 2. 进度条时间探针 (Scrubber Hover Time Probe)
  // ==========================================================================
  const probe = $('track-probe');
  const probeText = $('track-probe-text');
  let onWindowMouseUp = null;

  if (track && probe && probeText) {
    let isHoveringTrack = false;

    const updateProbe = (clientX) => {
      if (!state || state.currentDuration <= 0) {
        probe.setAttribute('data-show', 'false');
        return;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = x / rect.width;
      const targetTime = ratio * state.currentDuration;
      const remainingTime = Math.max(0, state.currentDuration - targetTime);

      probeText.textContent = `${formatTime(targetTime)}  ·  -${formatTime(remainingTime)}`;

      const probeWidth = probe.offsetWidth || 84;
      let targetX = x - (probeWidth / 2);
      targetX = Math.max(0, Math.min(rect.width - probeWidth, targetX));

      probe.style.setProperty('--probe-x', `${Math.round(targetX)}px`);
      probe.setAttribute('data-show', 'true');
      probe.setAttribute('aria-hidden', 'false');
    };

    track.addEventListener('mouseenter', (e) => {
      if (state && state.currentDuration > 0) {
        isHoveringTrack = true;
        updateProbe(e.clientX);
      }
    });

    track.addEventListener('mousemove', (e) => {
      if (isHoveringTrack || state.isScrubbing) {
        updateProbe(e.clientX);
      }
    });

    track.addEventListener('mouseleave', () => {
      if (!state.isScrubbing) {
        isHoveringTrack = false;
        probe.setAttribute('data-show', 'false');
        probe.setAttribute('aria-hidden', 'true');
      }
    });

    onWindowMouseUp = () => {
      if (!track.matches(':hover')) {
        isHoveringTrack = false;
        probe.setAttribute('data-show', 'false');
        probe.setAttribute('aria-hidden', 'true');
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);
  }

  // ==========================================================================
  // 3. 悬浮高密度元数据卡 (Metadata Rich Popover)
  // ==========================================================================
  const metaTt = $('meta-tooltip');
  const metaHeader = $('meta-tooltip-header');
  const metaSub = $('meta-tooltip-sub');

  function attachMetaTooltip(el, getHeader, getSub) {
    if (!el || !metaTt) return;

    el.addEventListener('mouseenter', () => {
      // 若当前在设置界面，不遮挡操作
      if (sheet && sheet.classList.contains('active')) return;

      const headerText = typeof getHeader === 'function' ? getHeader() : getHeader;
      const subText = typeof getSub === 'function' ? getSub() : getSub;
      if (!headerText && !subText) return;

      metaHeader.textContent = headerText || '';
      metaSub.textContent = subText || '';
      metaSub.style.display = subText ? 'block' : 'none';

      metaTt.style.display = 'flex';
      const cardRect = card.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const ttWidth = metaTt.offsetWidth || 180;
      const ttHeight = metaTt.offsetHeight || 44;

      let x = (elRect.left - cardRect.left);
      let y = (elRect.top - cardRect.top) - ttHeight - 8;

      // 若靠近卡片顶部则自动翻转到下方
      if (y < 8) {
        y = (elRect.bottom - cardRect.top) + 8;
      }
      x = Math.max(8, Math.min(cardRect.width - ttWidth - 8, x));

      metaTt.style.left = `${Math.round(x)}px`;
      metaTt.style.top = `${Math.round(y)}px`;
      metaTt.setAttribute('data-show', 'true');
      metaTt.setAttribute('aria-hidden', 'false');
    });

    el.addEventListener('mouseleave', () => {
      if (metaTt) {
        metaTt.setAttribute('data-show', 'false');
        metaTt.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // 初始化所有已声明的 .t-tt-group
  function initAllGroups() {
    document.querySelectorAll('.t-tt-group').forEach(initGroup);
  }

  initAllGroups();

  return {
    initGroup,
    initAllGroups,
    attachMetaTooltip,
    hideAll() {
      if (probe) {
        probe.setAttribute('data-show', 'false');
        probe.setAttribute('aria-hidden', 'true');
      }
      if (metaTt) {
        metaTt.setAttribute('data-show', 'false');
        metaTt.setAttribute('aria-hidden', 'true');
      }
    },
    dispose() {
      if (probe) {
        probe.setAttribute('data-show', 'false');
        probe.setAttribute('aria-hidden', 'true');
      }
      if (metaTt) {
        metaTt.setAttribute('data-show', 'false');
        metaTt.setAttribute('aria-hidden', 'true');
      }
      if (onWindowMouseUp) {
        window.removeEventListener('mouseup', onWindowMouseUp);
        onWindowMouseUp = null;
      }
    }
  };
}
