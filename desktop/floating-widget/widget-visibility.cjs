'use strict';

// Playback owns automatic hiding; explicit user visibility always takes priority.
module.exports = function createWidgetVisibility({ show, hide, present, presentAnnouncement = () => {}, delay = 950, fade = 180, announcementDuration = 5000 }) {
  let enabled = false;
  let wanted = true;
  let playback = null;
  let automatic = false;
  let manualReveal = false;
  let disposed = false;
  let timer = null;
  let phase = 'visible';
  let announcementEnabled = false;
  let announcementActive = false;
  let announcementTimer = null;
  let songKey = '';
  let announcedKey = '';
  const holds = new Set();
  const cancel = () => { clearTimeout(timer); timer = null; };
  const notify = value => { if (phase !== value) { phase = value; present(value); } };
  const announce = value => {
    if (announcementActive === value) return;
    announcementActive = value;
    presentAnnouncement(value);
  };
  function stopAnnouncement() {
    clearTimeout(announcementTimer);
    announcementTimer = null;
    announce(false);
  }
  function startAnnouncement() {
    if (disposed || !announcementEnabled || !songKey || playback !== 'playing') return;
    announcedKey = songKey;
    if (!wanted || manualReveal) return;
    clearTimeout(announcementTimer);
    announce(true);
    announcementTimer = setTimeout(() => {
      announcementTimer = null;
      announce(false);
      reconcile();
    }, announcementDuration);
  }
  const restore = () => {
    const needsShow = automatic || phase !== 'visible';
    cancel();
    automatic = false;
    notify('visible');
    if (wanted && needsShow) show();
  };
  const shouldHide = () => wanted && !manualReveal && !holds.size &&
    ((enabled && (playback === 'paused' || playback === 'stopped')) ||
      (announcementEnabled && !announcementActive));
  function reconcile() {
    if (disposed || !wanted) return;
    if (!shouldHide()) { restore(); return; }
    if (automatic || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!shouldHide() || disposed) return;
      notify('hiding');
      timer = setTimeout(() => {
        timer = null;
        if (!shouldHide() || disposed) return;
        automatic = true;
        notify('hidden');
        hide();
      }, fade);
    }, announcementEnabled && !announcementActive ? 0 : delay);
  }
  return {
    setEnabled(value) {
      const next = value === true;
      if (next !== enabled) { enabled = next; manualReveal = false; }
      reconcile();
    },
    setAnnouncementEnabled(value) {
      const next = value === true;
      if (next !== announcementEnabled) {
        announcementEnabled = next;
        manualReveal = false;
        stopAnnouncement();
        if (next) startAnnouncement();
      }
      reconcile();
    },
    updatePlayback(value, key) {
      // Loading/buffering and missing snapshots must not hide a playing widget.
      const changedSong = typeof key === 'string' && key !== songKey;
      if (changedSong) {
        songKey = key;
        manualReveal = false;
        if (!songKey) stopAnnouncement();
      }
      if (['playing', 'paused', 'stopped'].includes(value) && value !== playback) {
        playback = value;
        manualReveal = false;
      }
      if (announcementEnabled && songKey && value === 'playing' && songKey !== announcedKey) startAnnouncement();
      reconcile();
    },
    hold(key, active) { active ? holds.add(key) : holds.delete(key); reconcile(); },
    releaseHolds(keys) { for (const key of keys) holds.delete(key); reconcile(); },
    manual(value) {
      wanted = value === true;
      manualReveal = wanted;
      cancel();
      stopAnnouncement();
      automatic = false;
      notify(wanted ? 'visible' : 'hidden');
      if (wanted) show(); else hide();
    },
    reconcile,
    isWanted: () => wanted,
    canShow: () => wanted && !automatic,
    isAnnouncing: () => announcementActive,
    dispose() { disposed = true; cancel(); stopAnnouncement(); holds.clear(); }
  };
};
