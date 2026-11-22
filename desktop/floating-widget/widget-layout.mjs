// Geometry changes spend space on artwork and real content, never on empty rows.
const GRID = 8;
const snapDown = value => Math.max(0, Math.floor(value / GRID) * GRID);

function densityFor(layout, width, height, stacked, lyricFontSize) {
  if (layout === 'lyrics') {
    if (height < Math.max(128, Math.ceil(lyricFontSize * 2.76 + 52))) return 'compact';
    return width >= 640 && height >= 192 ? 'spacious' : 'balanced';
  }
  if (stacked) return width >= 320 && height >= 480 ? 'spacious' : 'balanced';
  if (layout === 'poster') {
    if (width < 272 || height < 280) return 'compact';
    return width >= 320 && height >= 432 ? 'spacious' : 'balanced';
  }
  if (layout === 'capsule') {
    if (width < 352 || height < 152) return 'compact';
    return width >= 464 && height >= 192 ? 'spacious' : 'balanced';
  }
  if (width < 400 || height < 240) return 'compact';
  return width >= 560 && height >= 352 ? 'spacious' : 'balanced';
}

export function createAdaptiveLayout({ card, state, motion, onMeasure, getEngaged }) {
  card.classList.add('is-initializing');
  const main = card.querySelector('.main');
  const footer = card.querySelector('.poster-bottom');
  const rowTop = card.querySelector('.row-top');
  const rowBottom = card.querySelector('.row-bottom');
  const releaseHeading = card.querySelector('.release-heading');
  let frame = 0;
  let disposed = false;
  let lastShape = '';
  let lastDetails = '';
  let lastSize = '';
  let currentDensity = '';
  let densityLayout = '';

  const token = (name, value) => {
    if (card.style.getPropertyValue(name) !== value) card.style.setProperty(name, value);
  };

  function measure() {
    frame = 0;
    if (disposed) return;
    const width = card.clientWidth;
    const height = card.clientHeight;
    const engaged = getEngaged();
    const quiet = state.isImmersive && !engaged;
    if (state.layout === 'circuit') {
      card.classList.toggle('is-engaged', engaged);
      card.classList.toggle('is-quiet', quiet);
      card.style.setProperty('--card-padding', '0px');
      for (const element of card.querySelectorAll('.row-bottom, .lyric-toolbar')) element.inert = true;
      card.classList.remove('is-wide', 'is-stacked', 'is-mini-poster', 'is-initializing');
      motion.resetLayout();
      lastShape = 'circuit'; lastSize = width + ':' + height;
      return;
    }
    const poster = state.layout === 'poster';
    const capsule = state.layout === 'capsule';
    const standard = state.layout === 'standard';
    const pureLyrics = state.layout === 'lyrics';
    const wasWide = card.classList.contains('is-wide');
    const wide = poster && width >= (wasWide ? 352 : 368) && width / height >= (wasWide ? 1.20 : 1.28);
    const wasStacked = card.classList.contains('is-stacked');
    const stacked = (standard || capsule) && height >= (wasStacked ? 312 : 336)
      && width / height <= (wasStacked ? 1.14 : 1.06);
    const miniPoster = poster && !wide && height < 260;
    const shortCapsule = capsule && !stacked && height < 136;
    const inlineControls = standard && !stacked && (height < 236 || width < 448);
    const pad = pureLyrics ? 8 : width < 360 || height < 248 ? 12
      : width < 560 || stacked ? 16 : 24;
    token('--card-padding', pad + 'px');
    token('--poster-pad', pad + 'px');

    const rect = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const contentWidth = Math.max(0, rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - pad * 2);
    const contentHeight = Math.max(0, rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth) - pad * 2);
    const fontSize = parseFloat(state.profiles[state.layout].font) || 16;
    const nextDensity = densityFor(state.layout, width, height, stacked, fontSize);
    const ranks = { compact: 0, balanced: 1, spacious: 2 };
    const density = densityLayout === state.layout && currentDensity && ranks[nextDensity] > ranks[currentDensity]
      ? densityFor(state.layout, width - GRID, height - GRID, stacked, fontSize) : nextDensity;
    const shape = [state.layout, density, wide, stacked, quiet, shortCapsule, inlineControls, miniPoster].join(':');
    const size = width + ':' + height;
    const shapeChanged = lastShape && shape !== lastShape;
    const resized = lastSize && size !== lastSize;
    if (shapeChanged || (resized && !card.classList.contains('is-resizing'))) motion.prepare();
    else if (resized && card.classList.contains('is-resizing')) motion.stopLayout();
    for (const [name, value] of Object.entries({
      'is-wide': wide, 'is-stacked': stacked, 'is-compact': width < 400, 'is-engaged': engaged,
      'is-quiet': quiet, 'is-short': shortCapsule, 'is-inline-controls': inlineControls, 'is-mini-poster': miniPoster
    })) card.classList.toggle(name, Boolean(value));
    for (const value of ['compact', 'balanced', 'spacious']) card.classList.toggle('density-' + value, value === density);

    const tokens = getComputedStyle(card);
    const translatedSong = state.showLyricTranslation && state.hasSongTranslation;
    card.classList.toggle('has-song-translation', Boolean(translatedSong));
    const lyricBodyHeight = pureLyrics ? Math.max(0, height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - (state.showLyricToolbar ? (density === 'compact' ? 30 : 36) : 0)
      - (state.showLyricToolbar ? (density === 'compact' ? 4 : 8) : 0)) : 0;
    const preferredFont = pureLyrics && density === 'compact' ? Math.min(fontSize, 24) : fontSize;
    const fittedFont = pureLyrics && translatedSong
      ? Math.max(12, Math.min(preferredFont, Math.floor((lyricBodyHeight - 4) / (1.38 + .64 * 1.4) * 2) / 2))
      : preferredFont;
    const translationSize = pureLyrics ? Math.max(10, Math.min(20, fittedFont * .64))
      : Math.max(11, Math.min(16, fontSize * .78));
    token('--fitted-lyric-size', fittedFont + 'px');
    token('--translation-font-size', translationSize + 'px');
    const smallSize = parseFloat(tokens.getPropertyValue('--type-small')) || 12;
    const titleSize = poster ? (contentWidth >= 230 && height >= 280 ? 24 : 20)
      : parseFloat(tokens.getPropertyValue('--type-title')) || 24;
    const dateSize = poster ? (titleSize === 24 ? 16 : 12) : smallSize;
    const gap = GRID;
    token('--poster-title-size', titleSize + 'px');
    token('--poster-song-size', dateSize + 'px');
    token('--poster-date-size', dateSize + 'px');
    token('--poster-lyric-size', fontSize + 'px');
    token('--poster-gap', gap + 'px');

    let primaryHeight = state.showBadges
      ? titleSize * 1.3 + dateSize * 1.35 + gap : titleSize * 1.35;
    const controlHeight = shortCapsule ? 0
      : capsule ? 36 : standard ? rowBottom.getBoundingClientRect().height : 0;
    const availableMainHeight = Math.max(0, contentHeight - controlHeight - (controlHeight ? gap : 0));
    let coverWidth = 0;
    let coverHeight = 0;
    let textWidth = contentWidth;
    let detailBudget = 0;
    if (poster) {
      coverWidth = wide ? Math.min(contentHeight, contentWidth * 0.5, contentWidth - 144 - gap) : contentWidth;
      textWidth = wide ? contentWidth - coverWidth - gap : contentWidth;
      detailBudget = miniPoster ? 0 : wide ? contentHeight - primaryHeight - gap
        : contentHeight - contentWidth - primaryHeight - gap * 2;
    } else if (!pureLyrics) {
      if (stacked) {
        coverWidth = contentWidth;
        const minimumArtHeight = Math.min(contentWidth, Math.max(112, contentWidth * 0.64));
        detailBudget = availableMainHeight - minimumArtHeight - primaryHeight - gap;
      } else {
        const artHeight = contentHeight;
        coverWidth = snapDown(Math.min(artHeight, contentWidth * 0.46, contentWidth - 128 - gap));
        coverHeight = artHeight;
        textWidth = contentWidth - coverWidth - gap;
        detailBudget = availableMainHeight - primaryHeight;
      }
    }

    const headingBudget = miniPoster ? contentHeight : stacked ? availableMainHeight : poster ? contentHeight : availableMainHeight;
    const hasAlbum = headingBudget >= 32 && textWidth >= 96;
    const artistCost = dateSize * 1.35 + 4;
    const hasArtist = headingBudget >= primaryHeight + artistCost && textWidth >= 128;
    if (hasArtist && state.showBadges) {
      primaryHeight += artistCost;
      detailBudget -= artistCost;
    }
    const canSpend = (cost, className) => detailBudget >= cost + (card.classList.contains(className) ? 0 : GRID);
    const trackCost = dateSize * 1.35 + gap;
    const hasTrack = !pureLyrics && !miniPoster && state.showBadges && density === 'spacious' && canSpend(trackCost, 'has-track-room');
    if (hasTrack) detailBudget -= trackCost;
    const lyricCost = fontSize * 1.5 + gap;
    const hasLyric = pureLyrics || (state.hasLyrics && !miniPoster && canSpend(lyricCost, 'has-lyric-room'));
    if (hasLyric && !pureLyrics) detailBudget -= lyricCost;
    const wantsTranslation = state.showLyricTranslation && state.hasTranslation;
    const translationCost = translationSize * 1.4 + gap;
    const hasTranslation = Boolean(wantsTranslation && hasLyric && (pureLyrics
      ? lyricBodyHeight >= fittedFont * 1.38 + translationSize * 1.4 + 4 - 1
      : canSpend(translationCost, 'has-translation-room')));
    if (hasTranslation && !pureLyrics) detailBudget -= translationCost;
    const nextCost = (poster ? fontSize * 1.4 : smallSize * 1.4) + gap;
    const hasNext = pureLyrics ? (!translatedSong || lyricBodyHeight >= fittedFont * 1.38 + translationSize * 2.8 + 8)
      : (hasLyric && (!wantsTranslation || hasTranslation) && canSpend(nextCost, 'has-next-room'));
    if (hasNext && !pureLyrics) detailBudget -= nextCost;
    const timeCost = smallSize * 1.5 + gap;
    const hasTime = poster && hasLyric && (!wantsTranslation || hasTranslation) && canSpend(timeCost, 'has-time-room');
    const detailHeight = (hasTrack ? trackCost : 0) + (hasLyric && !pureLyrics ? lyricCost : 0)
      + (hasTranslation && !pureLyrics ? translationCost : 0) + (hasNext && !pureLyrics ? nextCost : 0) + (hasTime ? timeCost : 0);

    if (poster) {
      // Only real lyric rows receive a footer; every other pixel goes to the art.
      const footerHeight = (hasLyric ? lyricCost : 0) + (hasTranslation ? translationCost : 0) + (hasNext ? nextCost : 0) + (hasTime ? timeCost : 0);
      coverHeight = miniPoster || wide ? contentHeight
        : Math.max(64, contentHeight - primaryHeight - (hasTrack ? trackCost : 0) - gap - footerHeight);
      token('--poster-cover-r', (coverWidth >= 200 ? 16 : 12) + 'px');
    } else if (stacked) {
      coverHeight = Math.max(64, availableMainHeight - primaryHeight - detailHeight - gap);
    }
    const details = [hasAlbum, hasArtist, hasTrack, hasLyric, hasTranslation, hasNext, hasTime].join(':');
    if (lastDetails && details !== lastDetails && !shapeChanged && !resized) motion.prepare();
    for (const [name, value] of Object.entries({
      'has-artist-room': hasArtist, 'has-album-room': hasAlbum, 'has-track-room': hasTrack,
      'has-lyric-room': hasLyric, 'has-translation-room': hasTranslation, 'has-next-room': hasNext, 'has-time-room': hasTime
    })) card.classList.toggle(name, Boolean(value));
    for (const element of card.querySelectorAll('.row-bottom, .lyric-toolbar')) element.inert = quiet || element.hidden;
    token('--cover-size', Math.max(0, coverWidth) + 'px');
    token('--cover-height', Math.max(0, coverHeight) + 'px');
    if (!lastSize) {
      card.querySelector('.cover').getBoundingClientRect();
      card.classList.remove('is-initializing');
    }
    lastShape = shape;
    lastDetails = details;
    lastSize = size;
    currentDensity = density;
    densityLayout = state.layout;
    motion.commit();
    onMeasure();
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(measure);
  }
  const geometryObserver = new window.ResizeObserver(schedule);
  for (const element of [card, main, footer, rowTop, rowBottom, releaseHeading]) geometryObserver.observe(element);
  document.fonts?.ready.then(schedule);
  schedule();
  return {
    schedule,
    refresh() { if (frame) cancelAnimationFrame(frame); measure(); },
    dispose() {
      disposed = true;
      geometryObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    }
  };
}
