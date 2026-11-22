// The native window owns the five-second announcement and visibility timer.
// The renderer only restores its existing content and controls during that time.
export function createSongAnnouncement({ state, onChange }) {
  let disposed = false;
  return {
    setActive(value) {
      if (disposed || typeof value !== 'boolean' || state.isAnnouncing === value) return;
      state.isAnnouncing = value;
      onChange();
    },
    dispose() { disposed = true; state.isAnnouncing = false; }
  };
}
