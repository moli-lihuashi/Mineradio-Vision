// Use the public player volume API; the host owns persistence and mute state.
export function createVolumeController(folium, isActive = () => true) {
  return {
    async adjust(delta) {
      if (!Number.isFinite(delta) || delta === 0 || !isActive()) return null;
      const playback = folium.playback;
      if (typeof playback.getVolume !== 'function' || typeof playback.setVolume !== 'function' ||
          typeof playback.setMuted !== 'function') {
        throw new Error('host-volume-api-unavailable');
      }
      const audio = playback.getVolume();
      if (!Number.isFinite(audio?.volume)) throw new Error('host-volume-state-unavailable');
      const current = audio.muted ? 0 : audio.volume;
      const next = Math.round(Math.max(0, Math.min(1, current + Math.max(-.1, Math.min(.1, delta)))) * 100) / 100;
      playback.setVolume(next);
      if (audio.muted && next > 0) playback.setMuted(false);
      return next;
    }
  };
}
