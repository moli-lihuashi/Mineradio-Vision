/**
 * widget-edge-dock.mjs
 * 
 * 屏幕边缘「隐形磁吸抽屉」与探头唤醒控制器 (Apple HIG Edge Peeking Drawer)
 * - 当开启此功能且小窗拖拽贴近屏幕左/右边缘时，自动折叠为边框微光探头 (Edge Peek Tab)
 * - 鼠标靠近探头或小窗时以 320ms cubic-bezier(0.16, 1, 0.3, 1) 优雅滑出
 * - 离开后带 450ms 缓冲防抖，优雅滑回边缘折叠
 * - 离开边缘拖入桌面中央时，自动解除抽屉模式，无缝变回正常浮动窗口
 */

export function createEdgeDockController({ card, edgePeekTab, state, sheet, menu }) {
  let currentBounds = null;
  let currentWorkArea = null;
  let leaveTimer = null;
  let pointerOutsideWindow = false;
  let disposed = false;

  function clearLeaveTimer() {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
  }

  function isInteractionProtected() {
    return state.isAnnouncing || state.circuitEditing || state.isScrubbing ||
      card.classList.contains('has-overlay') || card.classList.contains('is-resizing') || card.classList.contains('is-dragging') ||
      (sheet && sheet.classList.contains('active')) || (menu && menu.style.display === 'flex');
  }

  function isPointerPresent() {
    // A window exit/blur wins over stale :hover values on a transparent window.
    return !pointerOutsideWindow && (card.matches(':hover') ||
      (edgePeekTab && edgePeekTab.matches(':hover')) || document.body.matches(':hover'));
  }

  function syncTabAppearance() {
    if (disposed || !edgePeekTab || !state.edgeDock) return;
    // The tab is a sibling, so it does not inherit the card's theme tokens.
    const style = getComputedStyle(card);
    for (const name of ['--surface-hi', '--line', '--text-2', '--text-3', '--accent']) {
      edgePeekTab.style.setProperty(name, style.getPropertyValue(name));
    }
  }

  function checkEdge() {
    if (disposed) return;
    if (!state.edgeDock) {
      disengage();
      return;
    }
    syncTabAppearance();

    const bounds = currentBounds || {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };

    const workArea = currentWorkArea || {
      x: window.screen.availLeft || 0,
      y: window.screen.availTop || 0,
      width: window.screen.availWidth || 1920,
      height: window.screen.availHeight || 1080
    };

    const SNAP_MARGIN = 24; // 贴边判定距离 (px)
    const isAtLeft = bounds.x <= (workArea.x + SNAP_MARGIN);
    const isAtRight = (bounds.x + bounds.width) >= (workArea.x + workArea.width - SNAP_MARGIN);

    if (isAtLeft) {
      card.classList.add('is-edge-docked', 'dock-left');
      card.classList.remove('dock-right');
    } else if (isAtRight) {
      card.classList.add('is-edge-docked', 'dock-right');
      card.classList.remove('dock-left');
    } else {
      disengage();
      return;
    }
    if (isInteractionProtected() || isPointerPresent()) peek();
    else if (card.classList.contains('is-peeking')) unpeek();
  }

  function disengage() {
    clearLeaveTimer();
    card.classList.remove('is-edge-docked', 'dock-left', 'dock-right', 'is-peeking');
  }

  function peek() {
    if (disposed || !card.classList.contains('is-edge-docked')) return;
    clearLeaveTimer();
    card.classList.add('is-peeking');
    // Protection can end without a pointer event (menu/editor/announcement).
    if (!isPointerPresent()) unpeek();
  }

  function unpeek() {
    if (disposed || !card.classList.contains('is-edge-docked') || !card.classList.contains('is-peeking')) return;
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (disposed || !card.classList.contains('is-edge-docked')) return;
      if (isInteractionProtected() || isPointerPresent()) {
        unpeek();
        return;
      }
      card.classList.remove('is-peeking');
    }, 450);
  }

  function onPointerEnter() {
    pointerOutsideWindow = false;
    peek();
  }

  function onWindowEnter() { pointerOutsideWindow = false; }
  function onWindowLeave() {
    pointerOutsideWindow = true;
    unpeek();
  }

  function onTabClick(event) {
    event.stopPropagation();
    if (!card.classList.contains('is-peeking') || isInteractionProtected()) peek();
    else {
      clearLeaveTimer();
      card.classList.remove('is-peeking');
    }
  }

  card.addEventListener('mouseenter', onPointerEnter);
  card.addEventListener('mouseleave', unpeek);
  edgePeekTab?.addEventListener('mouseenter', onPointerEnter);
  edgePeekTab?.addEventListener('mouseleave', unpeek);
  edgePeekTab?.addEventListener('click', onTabClick);
  document.body.addEventListener('mouseenter', onWindowEnter);
  document.body.addEventListener('mouseleave', onWindowLeave);
  window.addEventListener('blur', onWindowLeave);
  const tabAppearanceObserver = edgePeekTab ? new MutationObserver(syncTabAppearance) : null;
  tabAppearanceObserver?.observe(card, { attributes: true, attributeFilter: ['class', 'style'] });

  return {
    updateBounds(bounds, workArea) {
      if (bounds) currentBounds = { ...bounds };
      if (workArea) currentWorkArea = { ...workArea };
      checkEdge();
    },
    refresh() {
      checkEdge();
    },
    peek,
    unpeek,
    disengage,
    dispose() {
      disposed = true;
      clearLeaveTimer();
      card.removeEventListener('mouseenter', onPointerEnter);
      card.removeEventListener('mouseleave', unpeek);
      edgePeekTab?.removeEventListener('mouseenter', onPointerEnter);
      edgePeekTab?.removeEventListener('mouseleave', unpeek);
      edgePeekTab?.removeEventListener('click', onTabClick);
      document.body.removeEventListener('mouseenter', onWindowEnter);
      document.body.removeEventListener('mouseleave', onWindowLeave);
      window.removeEventListener('blur', onWindowLeave);
      tabAppearanceObserver?.disconnect();
    }
  };
}
