import { formatTime } from './widget-state.mjs';
import { createLyricCanvas } from './widget-lyric-canvas.mjs';
import { getLineTranslation } from './lyric-translation.mjs';
export function createLyricsRenderer({ elements, state, titleSlot, artistSlot, onMeasure, onContentChange }) {
  const { card, karaokeViewport, karaokeLine, karaokeNext, karaokeTranslation, timeCurrent, timeDuration, trackFill, posterLine1, posterLine2, posterTime, posterTranslation } = elements;
  let lyricsData = null, fallbackLyric = '', lineKey = '';
  let currentWords = null, wordNodes = [], singleNode = null;
  let display = { currentLine: null, nextLine: null };
  let cachedThemeColors = null, frameRequest = 0, posterTextKey = '', lastFrameTime = -Infinity;
  let viewportWidth = 0, maxScroll = 0, wordCenters = [], scrollX = 0;
  let syncPosition = 0, syncPerfTime = performance.now(), renderedTime = 0;
  let lyricPosition = null, lyricPerfTime = syncPerfTime, lyricRate = 0;
  let songKey = null, previousPlaying = false, disposed = false, measureRequest = 0;
  let visibilityDirty = true;
  let surfaces = { karaoke: false, poster: false, progress: false, posterTime: false };
  let nextTextValue = '', nextTextNode = null, wordProgress = [], singleProgress = 0;
  const currentCanvas = createLyricCanvas(karaokeLine);
  const nextCanvas = createLyricCanvas(karaokeNext);
  const translationCanvas = createLyricCanvas(karaokeTranslation);
  const translationText = document.createElement('span');
  translationText.className = 'lyric-next-text lyric-translation-text';
  karaokeTranslation.appendChild(translationText);
  let translationValue = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pixelRatio = window.devicePixelRatio || 1, resolutionQuery = null;
  function themeColors() {
    if (cachedThemeColors) return cachedThemeColors;
    const cs = getComputedStyle(card);
    const desktopLyrics = state.layout === 'lyrics';
    const active = (cs.getPropertyValue(desktopLyrics ? '--lyric-active' : '--text') || '#ffffff').trim();
    const base = (cs.getPropertyValue(desktopLyrics ? '--lyric-base' : '--text-3') || 'rgba(255,255,255,0.45)').trim();
    cachedThemeColors = { active, base };
    return cachedThemeColors;
  }

  function gradient(active, base, pct) {
    const amount = Math.round(pct * 10) / 10;
    return `linear-gradient(to right, ${active} ${amount}%, ${base} ${amount}%)`;
  }

  function paintProgress(node, active, base, pct) {
    if (state.layout === 'lyrics') {
      node.style.webkitTextStrokeColor = pct >= 100
        ? state.lyricStyle?.highlightStrokeColor || '#101010'
        : state.lyricStyle?.textStrokeColor || '#101010';
    } else {
      node.style.removeProperty('-webkit-text-stroke-color');
    }
    const value = gradient(active, base, pct);
    if (node.dataset.gradient === value) return;
    node.dataset.gradient = value;
    node.style.backgroundImage = value;
  }

  function canvasEnabled() {
    return state.layout === 'lyrics' && state.lyricStyle?.rendering === 'grayscale';
  }

  function paintCanvas() {
    currentCanvas.paint(wordNodes.length ? wordProgress : [singleProgress], state.lyricStyle);
    nextCanvas.paint([0], state.lyricStyle);
    translationCanvas.paint([0], state.lyricStyle);
  }

  function applyScrollPosition() {
    const ratio = window.devicePixelRatio || 1;
    const snapped = Math.round(scrollX * ratio) / ratio;
    karaokeLine.style.transform = maxScroll > 0 && snapped > 0 ? `translateX(${-snapped}px)` : 'none';
  }

  function renderNextLine(text) {
    const value = String(text || '');
    if (nextTextValue === value && (value === '' || nextTextNode?.parentElement === karaokeNext)) return;
    nextTextValue = value;
    nextCanvas.invalidate();
    karaokeNext.replaceChildren();
    nextTextNode = null;
    if (value) {
      nextTextNode = document.createElement('span');
      nextTextNode.className = 'lyric-next-text';
      nextTextNode.textContent = value;
      karaokeNext.appendChild(nextTextNode);
      if (state.layout === 'lyrics' && !reduced.matches) {
        karaokeNext.animate?.([
          { opacity: 0, transform: 'translateY(3px)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 180, easing: 'ease-out' });
      }
    }
    scheduleMeasure();
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function renderTranslation(line) {
    const value = state.showLyricTranslation ? getLineTranslation(line) : '';
    if (value !== translationValue) {
      translationValue = value;
      translationCanvas.invalidate();
      setText(translationText, value);
      setText(posterTranslation, value);
      karaokeTranslation.title = value;
      posterTranslation.title = value;
      karaokeTranslation.hidden = !value;
      posterTranslation.hidden = !value;
      scheduleMeasure();
    }
    const hasTranslation = Boolean(value);
    if (state.hasTranslation !== hasTranslation) {
      state.hasTranslation = hasTranslation;
      card.classList.toggle('has-translation', hasTranslation);
      onContentChange();
    }
  }

  function updateTranslationAvailability() {
    const available = Boolean(lyricsData?.lines.some(line => getLineTranslation(line)));
    if (available !== state.hasSongTranslation) {
      state.hasSongTranslation = available;
      onContentChange();
    }
  }

  function getTime() {
    if (!state.isPlaying) return state.currentPosition;
    const elapsed = (performance.now() - syncPerfTime) / 1000;
    const bound = state.currentDuration > 0 ? state.currentDuration : Infinity;
    const raw = Math.min(bound, syncPosition + elapsed);
    if (raw >= renderedTime || Math.abs(raw - renderedTime) > 0.4) {
      renderedTime = raw;
    }
    return renderedTime;
  }

  function getLyricTime(audioTime = getTime()) {
    const elapsed = lyricPosition === null ? 0 : Math.max(0, performance.now() - lyricPerfTime) / 1000;
    // The host's lyric clock includes its own offset and lyrics-only stages.
    // Audio duration must not truncate it; the mod's offset remains independent.
    return (lyricPosition === null ? audioTime : lyricPosition + elapsed * lyricRate) + state.lyricOffsetMs / 1000;
  }

  function visible(node) {
    if (!node || node.hidden) return false;
    const rect = node.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function refreshSurfaces() {
    visibilityDirty = false;
    const concealed = document.hidden || document.body.classList.contains('widget-auto-hiding') ||
      (card.classList.contains('is-edge-docked') && !card.classList.contains('is-peeking'));
    const karaoke = !concealed && state.layout !== 'circuit' && state.layout !== 'poster' && visible(karaokeViewport);
    const poster = !concealed && state.layout === 'poster' && visible(posterLine1);
    surfaces = {
      karaoke, poster,
      progress: !concealed && state.layout !== 'circuit' && visible(trackFill.parentElement),
      posterTime: !concealed && state.layout === 'poster' && visible(posterTime)
    };
  }

  function needsContinuousFrames() {
    const advancingLyrics = lyricPosition === null ? state.isPlaying : lyricRate > 0;
    const timedLyrics = Boolean(lyricsData?.lines.length);
    return (advancingLyrics && timedLyrics && (surfaces.karaoke || surfaces.poster)) ||
      (state.isPlaying && state.currentDuration > 0 && (surfaces.progress || surfaces.posterTime));
  }

  function activeLineIndex(lines, time) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || time < line.startTime) continue;
      const end = (line.renderHints && line.renderHints.renderEndTime) || line.endTime || (line.startTime + 6);
      if (time <= end) return i;
    }
    return -1;
  }

  function resolveDisplay(lyrics, time) {
    if (!lyrics || !Array.isArray(lyrics.lines) || !lyrics.lines.length) {
      return { currentLine: null, nextLine: null };
    }
    const lines = lyrics.lines;
    const idx = activeLineIndex(lines, time);
    if (idx !== -1) {
      return { currentLine: lines[idx] || null, nextLine: lines[idx + 1] || null };
    }
    const upcoming = lines.findIndex((l) => l.startTime > time);
    const prev = upcoming === -1 ? lines.length - 1 : upcoming - 1;
    return {
      currentLine: prev >= 0 ? lines[prev] : null,
      nextLine: upcoming === -1 ? null : lines[upcoming]
    };
  }

  function keyOf(line) {
    return line ? `${line.startTime}_${line.endTime}_${line.fullText}` : 'empty';
  }

  let measureQueued = false;
  function scheduleMeasure() {
    if (disposed || measureQueued) return;
    measureQueued = true;
    measureRequest = requestAnimationFrame(() => {
      measureRequest = 0;
      measureQueued = false;
      if (disposed) return;
      measureLayout();
      requestFrame();
    });
  }

  // 工具条覆盖宽度 = 工具条自身宽度 - 标题行右侧内边距
  function measureLayout() {
    onMeasure();
    visibilityDirty = true;
    if (!karaokeViewport || !karaokeLine) return;
    viewportWidth = karaokeViewport.clientWidth;
    maxScroll = Math.max(0, karaokeLine.offsetWidth - viewportWidth);
    wordCenters = wordNodes.map((n) => n.offsetLeft + n.offsetWidth / 2);
    scrollX = Math.min(scrollX, maxScroll);
    applyScrollPosition();
    currentCanvas.setEnabled(canvasEnabled());
    nextCanvas.setEnabled(canvasEnabled());
    translationCanvas.setEnabled(canvasEnabled());
    currentCanvas.measure([...karaokeLine.querySelectorAll('.karaoke-word, .karaoke-single, .karaoke-placeholder')]);
    nextCanvas.measure(nextTextNode ? [nextTextNode] : []);
    translationCanvas.measure(translationValue ? [translationText] : []);
    paintCanvas();
  }

  function renderLine(line) {
    currentCanvas.invalidate();
    karaokeLine.style.transform = 'none';
    karaokeLine.innerHTML = '';
    wordNodes = [];
    currentWords = null;
    singleNode = null;
    wordCenters = [];
    maxScroll = 0;
    scrollX = 0;
    wordProgress = [];
    singleProgress = 0;

    if (!line) {
      const span = document.createElement('span');
      span.className = 'karaoke-placeholder';
      const title = titleSlot.getText();
      span.textContent = lyricsData?.lines.length ? '···' : fallbackLyric || (title && title !== '未在播放' ? '···' : 'Folia Music');
      karaokeLine.appendChild(span);
      scheduleMeasure();
      return;
    }

    const { active, base } = themeColors();

    if (state.wordKaraoke && Array.isArray(line.words) && line.words.length) {
      currentWords = line.words;
      line.words.forEach((w) => {
        const span = document.createElement('span');
        span.className = 'karaoke-word';
        span.textContent = w.text;
        paintProgress(span, active, base, 0);
        karaokeLine.appendChild(span);
        wordNodes.push(span);
        wordProgress.push(0);
      });
    } else {
      const span = document.createElement('span');
      span.className = 'karaoke-single';
      span.textContent = line.fullText || '';
      paintProgress(span, active, base, 0);
      karaokeLine.appendChild(span);
      singleNode = span;
    }

    scheduleMeasure();
    // 重建的子节点自行入场，避免为重启动画强制整窗重排。
  }

  function requestFrame() {
    if (!disposed && !document.hidden && !frameRequest) frameRequest = requestAnimationFrame(frame);
  }

  function frame(timestamp) {
    frameRequest = 0;
    if (disposed || document.hidden) return;
    if (visibilityDirty) refreshSurfaces();
    // 歌词以 30fps 刷新；高刷新率屏幕不再对每个词重复提交绘制。
    if (needsContinuousFrames() && timestamp - lastFrameTime < 1000 / 30) {
      requestFrame();
      return;
    }
    lastFrameTime = timestamp;
    const audioTime = getTime();
    const time = getLyricTime(audioTime);
    const { active, base } = themeColors();

    if ((surfaces.karaoke || surfaces.poster) && lyricsData && Array.isArray(lyricsData.lines) && lyricsData.lines.length) {
      const disp = resolveDisplay(lyricsData, time);
      const key = keyOf(disp.currentLine);
      display = disp;
      if (key !== lineKey) {
        lineKey = key;
        renderLine(disp.currentLine);
        renderNextLine(disp.nextLine ? disp.nextLine.fullText : '');
      }
      renderTranslation(disp.currentLine);

      if (state.wordKaraoke && currentWords && currentWords.length) {
        let activeIdx = -1;
        for (let i = 0; i < currentWords.length; i++) {
          const w = currentWords[i];
          const node = wordNodes[i];
          if (!node) continue;
          let pct;
          if (w.endTime > w.startTime) {
            pct = Math.max(0, Math.min(100, ((time - w.startTime) / (w.endTime - w.startTime)) * 100));
          } else {
            pct = time >= w.startTime ? 100 : 0;
          }
          paintProgress(node, active, base, pct);
          wordProgress[i] = pct;
          const singing = time >= w.startTime && time <= w.endTime;
          if (singing) activeIdx = i;
          node.classList.toggle('is-singing', singing);
        }

        // 用缓存几何做平滑跟随，避免每帧读取 scrollWidth 触发重排
        if (activeIdx !== -1 && maxScroll > 0) {
          const center = wordCenters[activeIdx];
          if (typeof center === 'number') {
            const target = Math.max(0, Math.min(maxScroll, center - viewportWidth / 2));
            const threshold = 0.5 / (window.devicePixelRatio || 1);
            scrollX = reduced.matches || Math.abs(target - scrollX) < threshold
              ? target : scrollX + (target - scrollX) * 0.14;
            applyScrollPosition();
          }
        }
      } else if (singleNode && display.currentLine) {
        const line = display.currentLine;
        let pct;
        if (line.endTime > line.startTime) {
          pct = Math.max(0, Math.min(100, ((time - line.startTime) / (line.endTime - line.startTime)) * 100));
        } else {
          pct = time >= line.startTime ? 100 : 0;
        }
        paintProgress(singleNode, active, base, pct);
        singleProgress = pct;
      }
    } else if ((surfaces.karaoke || surfaces.poster) && lineKey !== 'fallback') {
      lineKey = 'fallback';
      display = { currentLine: null, nextLine: null };
      renderLine(null);
      renderNextLine('');
      renderTranslation(null);
    }

    if (surfaces.karaoke) paintCanvas();

    if (surfaces.progress && state.isPlaying && state.currentDuration > 0 && !state.isScrubbing) {
      setText(timeCurrent, formatTime(audioTime));
      setText(timeDuration, state.layout === 'capsule'
        ? '-' + formatTime(Math.max(0, state.currentDuration - audioTime))
        : formatTime(state.currentDuration));
      trackFill.style.width = Math.min(100, Math.max(0, (audioTime / state.currentDuration) * 100)) + '%';
    }

    if (surfaces.poster || surfaces.posterTime) updatePosterLyrics(audioTime);

    if (needsContinuousFrames()) requestFrame();
  }
  requestFrame();

  function handleVisibility() {
    visibilityDirty = true;
    if (document.hidden && frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    } else {
      requestFrame();
    }
  }
  document.addEventListener('visibilitychange', handleVisibility);
  // Adaptive density, immersion and edge docking can hide every animated
  // surface without changing playback. Resume from the current clock on reveal.
  const VisibilityObserver = window.MutationObserver;
  const visibilityObserver = VisibilityObserver ? new VisibilityObserver(() => {
    visibilityDirty = true;
    requestFrame();
  }) : null;
  visibilityObserver?.observe(card, { attributes: true, attributeFilter: ['class', 'hidden'] });
  visibilityObserver?.observe(document.body, { attributes: true, attributeFilter: ['class', 'hidden'] });
  function handleResolutionChange() {
    pixelRatio = window.devicePixelRatio || 1;
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    resolutionQuery = matchMedia(`(resolution: ${pixelRatio}dppx)`);
    resolutionQuery.addEventListener('change', handleResolutionChange);
    scheduleMeasure();
  }
  handleResolutionChange();
  const onFontLoad = () => scheduleMeasure();
  document.fonts?.addEventListener('loadingdone', onFontLoad);

  function formatTimeShort(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function splitLyricForPoster(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return ['', ''];
    const half = Math.floor(trimmed.length / 2);
    let bestBreak = -1;
    let minDiff = Infinity;
    for (let i = 1; i < trimmed.length - 1; i++) {
      const ch = trimmed[i];
      if (ch === ' ' || ch === '，' || ch === ',' || ch === '、') {
        const diff = Math.abs(i - half);
        if (diff < minDiff) {
          minDiff = diff;
          bestBreak = i;
        }
      }
    }
    if (bestBreak > 0) {
      return [trimmed.slice(0, bestBreak).trim(), trimmed.slice(bestBreak + 1).trim()];
    }
    if (trimmed.length > 12) {
      return [trimmed.slice(0, half).trim(), trimmed.slice(half).trim()];
    }
    return [trimmed, ''];
  }

  function updatePosterLyrics(time) {
    if (state.layout !== 'poster') return;
    const el1 = posterLine1;
    const el2 = posterLine2;
    const elTime = posterTime;
    if (!el1 || !el2 || !elTime) return;

    setText(elTime, formatTimeShort(time));
    const translated = Boolean(translationValue && card.classList.contains('has-translation-room'));
    const textKey = JSON.stringify([display.currentLine?.fullText, display.nextLine?.fullText, translated, translationValue, fallbackLyric, titleSlot.getText(), artistSlot.getText()]);
    if (textKey === posterTextKey) return;
    posterTextKey = textKey;

    if (display.currentLine && display.currentLine.fullText) {
      const full = display.currentLine.fullText.trim();
      el1.title = full;
      if (!translated && full.length > 8 && (full.includes(' ') || full.length > 14)) {
        const pair = splitLyricForPoster(full);
        el1.textContent = pair[0];
        el2.textContent = pair[1] || (display.nextLine && display.nextLine.fullText ? display.nextLine.fullText.trim() : '···');
      } else {
        el1.textContent = full;
        el2.textContent = display.nextLine && display.nextLine.fullText ? display.nextLine.fullText.trim() : '···';
      }
    } else if (fallbackLyric) {
      const pair = splitLyricForPoster(fallbackLyric);
      el1.textContent = pair[0];
      el2.textContent = pair[1] || '···';
    } else {
      const title = titleSlot.getText();
      if (title && title !== '未在播放') {
        el1.textContent = title;
        el2.textContent = artistSlot.getText() || '···';
      } else {
        el1.textContent = 'Folia Music';
        el2.textContent = '···';
      }
    }
  }

  function update(data) {
    const changedSong = Object.prototype.hasOwnProperty.call(data, 'songKey') && songKey !== data.songKey;
    if (changedSong) {
      songKey = data.songKey;
      lyricPosition = null;
      lyricRate = 0;
      fallbackLyric = '';
      renderTranslation(null);
    }
    if (changedSong || Object.prototype.hasOwnProperty.call(data, 'lyrics')) {
      lyricsData = data.lyrics && Array.isArray(data.lyrics.lines) ? data.lyrics : null;
      lineKey = '';
      display = { currentLine: null, nextLine: null };
      updateTranslationAvailability();
    }
    if (Object.prototype.hasOwnProperty.call(data, 'currentLyric')) {
      const next = String(data.currentLyric || '');
      if (!lyricsData && next !== fallbackLyric) lineKey = '';
      fallbackLyric = next;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'lyricPosition')) {
      lyricPosition = Number.isFinite(data.lyricPosition) ? data.lyricPosition : null;
      lyricRate = data.lyricRate === 1 ? 1 : 0;
      lyricPerfTime = performance.now();
    }
    if (!state.isScrubbing) {
      const position = state.currentPosition;
      const diff = position - getTime();
      if (!changedSong && previousPlaying === state.isPlaying && state.isPlaying && Math.abs(diff) < 0.35 && syncPosition > 0) {
        syncPosition += diff * 0.25;
      } else {
        syncPosition = position;
        syncPerfTime = performance.now();
        renderedTime = position;
      }
    }
    previousPlaying = state.isPlaying;
    requestFrame();
  }
  function seek(position) {
    const delta = position - (state.isPlaying ? getTime() : syncPosition);
    if (lyricPosition !== null) {
      lyricPosition = getLyricTime() - state.lyricOffsetMs / 1000 + delta;
      lyricPerfTime = performance.now();
    }
    state.currentPosition = position;
    syncPosition = position;
    syncPerfTime = performance.now();
    renderedTime = position;
    requestFrame();
  }
  function invalidate(reason) {
    if (reason === 'theme' || reason === 'layout' || reason === 'lyricStyle') cachedThemeColors = null;
    if (reason === 'theme') {
      scheduleMeasure();
      requestFrame();
      return;
    }
    lineKey = '';
    posterTextKey = '';
    currentCanvas.invalidate();
    nextCanvas.invalidate();
    translationCanvas.invalidate();
    scheduleMeasure();
    requestFrame();
  }
  return {
    update, seek, invalidate, requestFrame, scheduleMeasure,
    dispose() {
      disposed = true;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      if (measureRequest) cancelAnimationFrame(measureRequest);
      document.removeEventListener('visibilitychange', handleVisibility);
      visibilityObserver?.disconnect();
      document.fonts?.removeEventListener('loadingdone', onFontLoad);
      resolutionQuery?.removeEventListener('change', handleResolutionChange);
      currentCanvas.dispose();
      nextCanvas.dispose();
      translationCanvas.dispose();
    }
  };
}
