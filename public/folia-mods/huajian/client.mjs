// 花笺 1.0.2 — built from src/ by dev/build.mjs; edit src/, not this file.
// Source modules are kept in separate scopes below, in dependency order.
import * as PIXI from './vendor/pixi.min.mjs';

// ---- src/store.mjs
const __store = (() => {
// The AI director's memory in the mod's data file (1 MB cap): one direction per
// song (about 1 KB), most recently used first, plus per-endpoint request
// quirks and usage totals. A song heard before costs nothing.

const SONG_PREFIX = 'dir:';
const AUDIO_PREFIX = 'aud:';
const AUDIO_INDEX = 'audIndex';
const INDEX_KEY = 'index';
const MAX_SONGS = 500;

const createStore = (storage, log) => {
  let index = null; // song keys, most recent first

  const loadIndex = async () => {
    if (index) return index;
    const stored = await storage.get(INDEX_KEY).catch(() => null);
    index = Array.isArray(stored) ? stored : [];
    return index;
  };

  /* A write past the cap fails: drop the oldest third once and retry. */
  const safeSet = async (key, value) => {
    try {
      await storage.set(key, value);
    } catch (error) {
      log.warn('写入数据文件失败，清理最旧的三分之一后重试', { message: String(error?.message ?? error) });
      const keys = await loadIndex();
      const dropped = keys.splice(Math.floor((keys.length * 2) / 3));
      await Promise.all(dropped.map((songKey) => storage.delete(`${SONG_PREFIX}${songKey}`).catch(() => {})));
      await storage.set(INDEX_KEY, keys);
      await storage.set(key, value);
    }
  };

  const touch = async (songKey) => {
    const keys = await loadIndex();
    const at = keys.indexOf(songKey);
    if (at !== -1) keys.splice(at, 1);
    keys.unshift(songKey);
    const evicted = keys.splice(MAX_SONGS);
    await Promise.all(evicted.map((key) => storage.delete(`${SONG_PREFIX}${key}`).catch(() => {})));
    await safeSet(INDEX_KEY, keys);
  };

  return {
    /** `{ fp, d, at }`: the lyric fingerprint it was made for, the direction, when. */
    getDirection: async (songKey) => (songKey ? (await storage.get(`${SONG_PREFIX}${songKey}`).catch(() => null)) ?? null : null),
    putDirection: async (songKey, fingerprint, direction) => {
      await safeSet(`${SONG_PREFIX}${songKey}`, { fp: fingerprint, d: direction, at: Date.now() });
      await touch(songKey);
    },
    forget: async (songKey) => {
      await storage.delete(`${SONG_PREFIX}${songKey}`).catch(() => {});
      const keys = await loadIndex();
      const at = keys.indexOf(songKey);
      if (at !== -1) {
        keys.splice(at, 1);
        await safeSet(INDEX_KEY, keys);
      }
    },
    /** Tempo and key heard for a song (`{ f: features, s: rhythm snapshot }`), kept for the last MAX_SONGS songs. */
    getAudio: async (songKey) => (songKey ? (await storage.get(`${AUDIO_PREFIX}${songKey}`).catch(() => null)) ?? null : null),
    putAudio: async (songKey, record) => {
      await safeSet(`${AUDIO_PREFIX}${songKey}`, record);
      const keys = (await storage.get(AUDIO_INDEX).catch(() => null)) ?? [];
      const at = keys.indexOf(songKey);
      if (at !== -1) keys.splice(at, 1);
      keys.unshift(songKey);
      const evicted = keys.splice(MAX_SONGS);
      await Promise.all(evicted.map((key) => storage.delete(`${AUDIO_PREFIX}${key}`).catch(() => {})));
      await safeSet(AUDIO_INDEX, keys);
    },
    count: async () => (await loadIndex()).length,
    get: (key) => storage.get(key).catch(() => undefined),
    set: (key, value) => safeSet(key, value),
  };
};
return { createStore };
})();

// ---- src/motion.mjs
const __motion = (() => {
// Easing and small numeric helpers. Motion in 花笺 is a function of song time:
// these turn "seconds since something began" into eased progress.

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
/** Progress of `t` through `[start, start + duration]`, 0..1. */
const progress = (t, start, duration) => clamp((t - start) / Math.max(1e-6, duration));

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t * t * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const easeOutBack = (t, overshoot = 1.5) => 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
/** 0 → 1 → 0 over t in 0..1, a soft hump. */
const bump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));

/** Moves `current` toward `target` with time constant `tau` seconds, independent of frame rate. */
const damp = (current, target, tau, dt) => (tau <= 0 ? target : target + (current - target) * Math.exp(-Math.max(0, dt) / tau));

/** Positive modulo, for wrapping particle fields. */
const wrap = (value, size) => ((value % size) + size) % size;
return { clamp, lerp, smoothstep, progress, easeOutCubic, easeInCubic, easeInOutCubic, easeOutExpo, easeOutQuint, easeOutBack, bump, damp, wrap };
})();

// ---- src/lyrics.mjs
const __lyrics = (() => {
// Lyric analysis shared by the planner and the stage: which lines are credits,
// which belong to the chorus, when each character lights up, and how the song
// falls into paragraphs (the unit a scene is chosen for).
//
// Paragraphs follow the rules Folia's own paragraph analysis uses: split where
// the gap between lines is well above the song's usual gap (median × 2.5,
// clamped to 1.25–3.5 s) or where the source's song part changes; a paragraph
// longer than 6 lines or 18 s is split again at its largest gap.

const { clamp } = __motion;

const CREDIT_PATTERN = /^\s*(作词|作曲|编曲|词|曲|制作人|监制|出品|发行|混音|母带|录音|和声|和音|配唱|吉他|贝斯|鼓|键盘|弦乐|钢琴|企划|统筹|OP|SP|ISRC|Lyrics?|Lyricist|Composer|Compose[rd]?|Arrange[rd]?|Arrangement|Producer|Produced|Mix(?:ed|ing)?|Master(?:ed|ing)?)\s*(by)?\s*[:：]/i;
const NOTICE_PATTERN = /(未经|著作权|版权所有|享有本翻译作品|TME|QQ音乐|网易云音乐|酷狗)/;
const WIDE = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/u;
const SPACE = /\s/u;
const LIFT_PUNCT = /[!?！？…]/g;

const MAX_LINES = 6;
const MAX_SPAN_SEC = 18;

/** Per-song key: `source:id`, or `title|artist` when there is no id (Folium's advice). */
const songKeyOf = (song) => {
  if (!song) return null;
  if (song.id) return `${song.source ?? 'unknown'}:${song.id}`;
  if (song.title) return `t:${song.title}|${song.artist ?? ''}`;
  return null;
};

const normalizeText = (text) => String(text ?? '').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
const isCredit = (text) => CREDIT_PATTERN.test(text) || NOTICE_PATTERN.test(text);

/** Share of wide (CJK) characters among the visible ones. */
const wideShare = (text) => {
  const chars = Array.from(String(text)).filter((char) => !SPACE.test(char));
  if (chars.length === 0) return 0;
  return chars.filter((char) => WIDE.test(char)).length / chars.length;
};

/* Words in a line, counting a CJK character as half a word (about how fast they are sung). */
const wordCount = (text) => {
  const latin = String(text).match(/[A-Za-z0-9À-ɏ']+/g)?.length ?? 0;
  const wide = Array.from(String(text)).filter((char) => WIDE.test(char)).length;
  return latin + wide / 2;
};

/**
 * When each character lights up: one entry per character of `Array.from(line.fullText)`,
 * `{ start, end }` in lyric seconds, or null for spaces. Word timings are used when they
 * match the visible characters; otherwise the line's time is spread evenly.
 */
const charTimings = (line) => {
  const chars = Array.from(String(line?.fullText ?? ''));
  const visible = chars.filter((char) => !SPACE.test(char)).length;
  const fromWords = [];
  for (const word of line?.words ?? []) {
    const wordChars = Array.from(String(word.text ?? '')).filter((char) => !SPACE.test(char));
    const duration = Math.max(0.001, word.endTime - word.startTime);
    wordChars.forEach((_, index) => {
      fromWords.push({
        start: word.startTime + (duration * index) / wordChars.length,
        end: word.startTime + (duration * (index + 1)) / wordChars.length,
      });
    });
  }
  const useWords = fromWords.length === visible && visible > 0;
  const start = Number(line?.startTime) || 0;
  const span = Math.max(0.2, ((Number(line?.endTime) || start + 1) - start) * 0.85);
  let cursor = 0;
  return chars.map((char) => {
    if (SPACE.test(char)) return null;
    const index = cursor;
    cursor += 1;
    if (useWords) return fromWords[index];
    return { start: start + (span * index) / visible, end: start + (span * (index + 1)) / visible };
  });
};

/* Lengths of runs of equal chorus marks, so a lone repeated line does not split a paragraph. */
const runLengths = (flags) => {
  const lengths = new Array(flags.length).fill(1);
  let begin = 0;
  for (let i = 1; i <= flags.length; i += 1) {
    if (i === flags.length || flags[i] !== flags[begin]) {
      for (let k = begin; k < i; k += 1) lengths[k] = i - begin;
      begin = i;
    }
  }
  return lengths;
};

const splitLong = (group, items) => {
  const span = items[group[group.length - 1]].end - items[group[0]].start;
  if (group.length < 2 || (group.length <= MAX_LINES && span <= MAX_SPAN_SEC)) return [group];
  let best = 1;
  let bestScore = -Infinity;
  for (let k = 1; k < group.length; k += 1) {
    const gap = items[group[k]].start - items[group[k - 1]].end;
    const balance = 1 - Math.abs(k - group.length / 2) / group.length;
    const score = gap + balance * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return [...splitLong(group.slice(0, best), items), ...splitLong(group.slice(best), items)];
};

const kindOf = (paragraph, items, isFirst, isLast) => {
  const lines = paragraph.lines.map((index) => items[index]);
  const chorusShare = lines.filter((item) => item.chorus).length / lines.length;
  const span = paragraph.end - paragraph.start;
  const text = lines.map((item) => item.text).join(' ');
  const words = wordCount(text);
  const singing = lines.reduce((sum, item) => sum + Math.max(0.2, item.end - item.start), 0);
  if (chorusShare >= 0.5) return 'chorus';
  if (span <= 3.5 || words <= 3) return 'breath';
  if (isLast) return 'outro';
  if (isFirst) return 'intro';
  if ((text.match(LIFT_PUNCT)?.length ?? 0) >= 2 || words / singing > 2.5) return 'lift';
  return 'verse';
};

/**
 * `{ items, paragraphs, sung }`: items are the non-empty lines with their timing and
 * marks; paragraphs index into items. Credits at the top of the lyric form their own
 * `credits` paragraph.
 */
const analyzeLyrics = (lines) => {
  const items = [];
  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const text = String(line?.fullText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const start = Number(line.startTime) || 0;
    const end = Math.max(start + 0.2, Number(line.endTime) || start + 0.2);
    const renderEnd = Math.max(end, Number(line.renderHints?.renderEndTime) || end);
    items.push({ index, line, text, start, end, renderEnd, credit: isCredit(text), wide: wideShare(text), chorus: false });
  });

  // Credits count only before the first sung line; later look-alikes are lyrics.
  let sungYet = false;
  for (const item of items) {
    if (!item.credit) sungYet = true;
    else if (sungYet) item.credit = false;
  }

  // Chorus: the source's mark, or a recurring line inside a run of recurring lines
  // (sources tag only part of the chorus; a lone repeated "oh" is not one).
  const counts = new Map();
  for (const item of items) {
    const key = normalizeText(item.text);
    if (!item.credit && key.length >= 2) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = items.map((item) => !item.credit && (counts.get(normalizeText(item.text)) ?? 0) >= 2);
  items.forEach((item, i) => {
    item.chorus = Boolean(item.line.isChorus) || (repeated[i] && (repeated[i - 1] || repeated[i + 1]));
  });

  const paragraphs = [];
  const creditIndexes = items.map((_, i) => i).filter((i) => items[i].credit);
  if (creditIndexes.length > 0) paragraphs.push({ lines: creditIndexes, kind: 'credits' });

  const sung = items.map((_, i) => i).filter((i) => !items[i].credit);
  if (sung.length > 0) {
    const gaps = [];
    for (let k = 0; k < sung.length - 1; k += 1) gaps.push(Math.max(0, items[sung[k + 1]].start - items[sung[k]].end));
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 1;
    const threshold = clamp(median * 2.5, 1.25, 3.5);
    const runs = runLengths(sung.map((i) => items[i].chorus));

    const groups = [];
    let group = [sung[0]];
    for (let k = 1; k < sung.length; k += 1) {
      const a = items[sung[k - 1]];
      const b = items[sung[k]];
      const partChange = Boolean(a.line.songPart && b.line.songPart && a.line.songPart !== b.line.songPart);
      const blockChange = Number.isFinite(a.line.blockIndex) && Number.isFinite(b.line.blockIndex) && a.line.blockIndex !== b.line.blockIndex;
      const chorusChange = a.chorus !== b.chorus && runs[k] >= 2 && runs[k - 1] >= 2;
      if (gaps[k - 1] > threshold || partChange || blockChange || chorusChange) {
        groups.push(group);
        group = [];
      }
      group.push(sung[k]);
    }
    groups.push(group);
    for (const g of groups) for (const part of splitLong(g, items)) paragraphs.push({ lines: part, kind: null });
  }

  const sungParagraphs = paragraphs.filter((p) => p.kind !== 'credits');
  let ordinal = 0;
  paragraphs.forEach((paragraph, index) => {
    const lineItems = paragraph.lines.map((i) => items[i]);
    paragraph.index = index;
    paragraph.start = Math.min(...lineItems.map((item) => item.start));
    paragraph.end = Math.max(...lineItems.map((item) => item.renderEnd));
    paragraph.text = lineItems.map((item) => item.text).join('\n');
    paragraph.wide = lineItems.reduce((sum, item) => sum + item.wide, 0) / lineItems.length;
    paragraph.chorus = lineItems.filter((item) => item.chorus).length * 2 >= lineItems.length;
    if (paragraph.kind !== 'credits') {
      paragraph.ordinal = ordinal;
      ordinal += 1;
      const position = sungParagraphs.indexOf(paragraph);
      paragraph.kind = kindOf(paragraph, items, position === 0, position === sungParagraphs.length - 1 && sungParagraphs.length > 2);
    } else {
      paragraph.ordinal = -1;
    }
  });

  // Same text as an earlier paragraph (a chorus coming back): remember which.
  const firstByText = new Map();
  for (const paragraph of paragraphs) {
    const key = normalizeText(paragraph.text);
    if (firstByText.has(key)) paragraph.repeatOf = firstByText.get(key);
    else firstByText.set(key, paragraph.index);
  }

  return { items, paragraphs, sung: items.filter((item) => !item.credit) };
};

/** A fingerprint of the sung text: cached directions are only reused for the same lyric. */
const lyricFingerprint = (analysis) => {
  let h = 2166136261 >>> 0;
  for (const item of analysis.sung) {
    for (const char of normalizeText(item.text)) {
      h ^= char.codePointAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `${analysis.paragraphs.length}:${h.toString(36)}`;
};
return { WIDE, songKeyOf, normalizeText, isCredit, wideShare, charTimings, analyzeLyrics, lyricFingerprint };
})();

// ---- src/mood.mjs
const __mood = (() => {
// The local reading of a song, used until (or instead of) the AI director: how
// dark or bright, how still or intense, how cold or warm, and which imagery
// the words keep returning to. Inputs are the lyric, the title and Folia's own
// AI theme (its name and description, e.g. “雨夜思念”), which is free to read.

const { clamp } = __motion;

const SAD = ['泪', '哭', '痛', '伤', '孤单', '孤独', '寂寞', '离开', '分手', '再见', '告别', '遗憾', '回忆', '想念', '思念', '错过', '失去',
  '后悔', '心碎', '难过', '悲', '等待', '放手', '不再', '曾经', '叹', '苦', '碎', '散', '忘', '梦醒', '一个人', '空', '冷', '黑夜', '凋',
  'lonely', 'cry', 'tears', 'goodbye', 'miss', 'alone', 'broken', 'sorry', 'lost', 'pain', 'hurt', 'gone', 'cold', 'regret', 'fade', 'empty', 'sad'];
const BRIGHT = ['笑', '快乐', '开心', '阳光', '自由', '飞', '跳', '奔跑', '梦想', '青春', '燃', '嗨', '耶', '幸福', '甜', '希望', '未来', '一起',
  '派对', '舞', '庆祝', 'happy', 'smile', 'sunshine', 'dance', 'party', 'free', 'fly', 'shine', 'yeah', 'fun', 'alive', 'tonight', 'together', 'jump'];
const CALM = ['轻', '慢', '静', '温柔', '晚风', '安静', '呼吸', '睡', '摇篮', 'soft', 'slow', 'quiet', 'gentle', 'breeze', 'calm', 'sleep'];
const INTENSE = ['燃', '冲', '炸', '狂', '吼', '战', 'burn', 'loud', 'wild', 'shout', 'fight', 'rock'];
const WARM = ['阳光', '火', '夏', '暖', '金', '黄昏', '夕阳', '灯', 'sun', 'summer', 'warm', 'gold', 'fire'];
const COLD = ['冷', '雪', '冬', '蓝', '雨', '夜', '冰', '霜', '海', 'cold', 'snow', 'winter', 'blue', 'rain', 'ice', 'night'];

/** Imagery → the ambient element that draws it. */
const IMAGERY = {
  rain: ['雨', 'rain'],
  snow: ['雪', 'snow', '冬天', 'winter'],
  petals: ['花', '樱', 'flower', 'bloom', 'petal', 'blossom', '春天'],
  stars: ['星', '银河', '宇宙', '月', 'star', 'galaxy', 'moon', 'universe'],
  fireflies: ['萤', '夏夜', 'firefly', 'fireflies', '灯火'],
  embers: ['火', '烟', '灰烬', '余烬', '落叶', '秋', 'fire', 'ember', 'ash', 'autumn'],
};

const LATIN = /^[a-z' ]+$/;
const patternCache = new Map();
const patternOf = (word) => {
  if (!patternCache.has(word)) {
    // Latin words match at a word start, so "sad" counts "sadness" and "cry" counts "crying".
    patternCache.set(word, LATIN.test(word) ? new RegExp(`\\b${word}`, 'g') : new RegExp(word, 'g'));
  }
  return patternCache.get(word);
};
const count = (text, words) => words.reduce((sum, word) => sum + (text.match(patternOf(word))?.length ?? 0), 0);

/**
 * `{ valence, energy, warmth, weather, imagery }`, each 0..1 but weather (an
 * ambient element name). `theme` is the Folia theme (may be null).
 */
const localMood = ({ analysis, song, theme, audio = null }) => {
  const lyric = analysis.sung.map((item) => item.text).join('\n').toLowerCase();
  const themeText = `${theme?.name ?? ''} ${theme?.description ?? ''}`.toLowerCase();
  const title = String(song?.title ?? '').toLowerCase();
  // The title and the theme description say more per word than any one line: counted three times.
  const text = `${lyric}\n${themeText}\n${themeText}\n${themeText}\n${title}\n${title}\n${title}`;

  const sad = count(text, SAD);
  const bright = count(text, BRIGHT);
  // Shrunk toward neutral when the words say little: one sad word must not make a love song tragic.
  const valence = clamp(0.5 + 0.5 * ((bright - sad) / (bright + sad + 3)), 0.05, 0.95);

  // Energy from how densely the words are sung, exclamations and word choice.
  const singing = analysis.sung.reduce((sum, item) => sum + Math.max(0.2, item.end - item.start), 0);
  // Sung syllables, not characters: a CJK character is one, a Latin word about 1.3 (counting letters
  // made every English song read as energetic).
  const chars = analysis.sung.reduce((sum, item) => {
    const latinWords = item.text.match(/[A-Za-zÀ-ɏ']+/g)?.length ?? 0;
    const others = Array.from(item.text.replace(/[A-Za-zÀ-ɏ'\s]+/g, '')).length;
    return sum + others + latinWords * 1.3;
  }, 0);
  const density = singing > 0 ? chars / singing : 3;
  const exclaim = (lyric.match(/[!！]/g)?.length ?? 0) / Math.max(1, analysis.sung.length);
  let energy = 0.18 + clamp((density - 2) / 5) * 0.5 + clamp(exclaim) * 0.15;
  energy += 0.08 * Math.tanh((count(text, INTENSE) - count(text, CALM)) / 3);
  energy += (valence - 0.5) * 0.25;
  const intensity = theme?.animationIntensity;
  if (intensity === 'chaotic') energy += 0.1;
  if (intensity === 'calm') energy -= 0.1;
  // Calibrated on the M1 evaluation: lyrics alone read ~0.3 lower than the AI (which also knows
  // the songs) across all 28 songs, and quiet songs bottomed out at 0.05. A plain affine lift.
  energy = clamp(0.3 + 0.75 * clamp(energy, 0.05, 0.95), 0.05, 0.95);

  // What the song sounded like, when it has been heard: tempo and loudness lift or calm the energy,
  // a clear major or minor key nudges the brightness. shortcut: uncalibrated weights, refit them
  // against the AI's readings (dir:* entries) once enough songs have audio features.
  if (audio?.bpm && audio.confidence >= 0.4) {
    const tempo = clamp((audio.bpm - 70) / 90);
    const loud = audio.loudness === null ? 0.5 : clamp((audio.loudness - 0.35) / 0.4);
    energy = clamp(0.5 * energy + 0.5 * (0.15 + 0.45 * tempo + 0.4 * loud), 0.05, 0.95);
  }
  let shade = 0;
  if (audio?.mode && audio.modeConfidence >= 0.3) shade = (audio.mode === 'major' ? 0.06 : -0.06) * audio.modeConfidence;

  const warmth = clamp(0.5 + 0.3 * Math.tanh((count(text, WARM) - count(text, COLD)) / 3) + (valence - 0.5) * 0.35, 0.05, 0.95);

  const imagery = Object.entries(IMAGERY)
    .map(([weather, words]) => [weather, count(text, words)])
    .sort((a, b) => b[1] - a[1]);
  const [topWeather, topCount] = imagery[0];
  let weather;
  if (topCount >= 2) weather = topWeather;
  else if (valence < 0.42) weather = 'dust';
  else if (valence > 0.62 && energy > 0.55) weather = 'dust';
  else weather = warmth > 0.55 ? 'fireflies' : 'dust';

  return { valence: clamp(valence + shade, 0.05, 0.95), energy, warmth, weather, imagery: imagery.filter(([, n]) => n > 0).map(([name]) => name) };
};
return { localMood };
})();

// ---- src/direction.mjs
const __direction = (() => {
// A song's "direction": how it feels and how each paragraph should be staged.
// The AI director writes one per song (one call, cached); the local reading in
// mood.mjs stands in when there is no AI, no network, or while the call runs.
// The planner (plan.mjs) turns a direction into the exact scene schedule, so a
// direction only names choices from fixed vocabularies and never draws anything.

const { clamp } = __motion;
const { localMood } = __mood;
const { normalizeText, WIDE } = __lyrics;

const DIRECTION_VERSION = 1;

const SCENES = {
  center: '居中独白：一句居中，细线随演唱生长，克制、通用',
  stanza: '诗稿：靠一侧排成竖向堆叠的诗行，旧句变淡上移，像手写稿，适合叙事、回忆、伤感',
  vertical: '竖排：中文竖排从右往左，配印章，古典、留白，适合安静伤感或中国风（只适合中文短句）',
  hero: '巨字：把关键词放成巨大的空心字压在背后，歌词在前，适合副歌、情绪最满的地方',
  collage: '拼贴：词块错落、带色块底板，跳跃热闹，只适合欢快有力的段落',
  whisper: '低语：小字偏在一角，大量留白，适合前奏、间奏、尾声、气口',
};
const WEATHERS = {
  none: '无',
  dust: '浮尘：缓慢漂浮的光点，最百搭',
  rain: '雨丝：斜落的细雨，伤感、思念',
  snow: '飘雪：慢慢飘落，冷、安静、怀念',
  petals: '落花：飘落的花瓣，温柔、青春、告别',
  fireflies: '萤火：忽明忽暗的光点，夏夜、温柔、童年',
  embers: '余烬：向上飘升的火星，怀旧、燃尽、不舍',
  stars: '星空：闪烁的星和偶尔的流星，夜晚、遥远、孤独',
};
const MOTIONS = {
  gentle: '静：字像墨晕开、雨滴落下、镜头对焦那样慢慢出现，缓慢推拉，溶解转场',
  lyrical: '抒：字升起、翻转、波浪式出现，演唱时轻轻鼓起，推拉摇移，柔和转场',
  dramatic: '烈而不闹：盖章、冲镜、拉伸、乱码解码，闪白和故障切换，适合伤感或悲壮的高潮',
  punchy: '燃：弹跳、落下回弹、爆开、故障，甩镜和闪切，词块配色板，只适合欢快热烈的段落',
};
const ACCENTS = {
  sparkler: '线香花火：一点小小的火花噼啪作响，伤感歌的高潮和回忆最合适',
  fireworks: '烟花：在夜空绽放，只用于真正热烈欢快的段落',
};

const SECTION_LABELS = { intro: '前奏后首段', verse: '主歌', lift: '推进', chorus: '副歌', breath: '气口', outro: '尾声' };

const clock = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clip = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const list = (vocab) => Object.entries(vocab).map(([key, text]) => `  - ${key}：${text}`).join('\n');

const SYSTEM = `你是歌词动画的视觉导演。读懂一首歌后，为它写一份分镜方向，供渲染器执行。只输出一个 JSON 对象，不要任何解释。

字段：
- summary：一句话（不超过 24 字）说出这首歌的情绪和画面。
- valence：0~1，情绪明暗。0 极度伤感，0.5 平静或复杂，1 明亮欢快。
- energy：0~1，整首歌的能量。0 静谧，1 激烈。
- warmth：0~1，色温。0 冷，1 暖。
- palette：2~4 个 #rrggbb，用于粒子和装饰。要和情绪一致、彼此和谐、偏柔和；只有热烈欢快的歌才用高饱和色。
- weather：整首歌的氛围元素，从下面选一个：
${list(WEATHERS)}
- seal：最能代表这首歌的一个汉字，盖成印章；英文歌可以给空字符串。
- sections：数组。对用户给出的每个段落 P 各给一项：{"p": 段落编号, "energy": 0~1 这一段的能量, "motion": 动态风格, "scene": 版式, "weather": 这一段的元素, "burst": 0~1 火花或烟花的强度, "keyword": 这一段最值得放大的一个词}
  motion 决定字怎么进场、怎么唱、怎么退场，以及镜头和转场的力度，从下面选：
${list(MOTIONS)}
  scene 从下面选：
${list(SCENES)}
  weather 可以沿用整首的元素，也可以从上面的氛围元素或下面的点睛元素里选：
${list(ACCENTS)}
  点睛元素要省着用：一首歌最多 2~4 个段落用 sparkler 或 fireworks，留给副歌和最高潮，其余段落用氛围元素。
  burst 只在 weather 是 sparkler 或 fireworks 时有意义，其他填 0。
  keyword 必须是这一段歌词里原样出现的词（2~6 个字或 1~2 个英文单词），用歌词原文的语言，英文歌给英文、日文歌给日文原文，不要翻译；没有合适的就给空字符串。

导演原则：
1. 以歌词的真实情绪为准。旋律欢快但歌词伤感（悲伤的快歌、强颜欢笑）时，压低 valence，但保留 energy。
2. 整首要有起伏：主歌克制，副歌展开，尾声收束。相邻段落尽量不用同一个 scene。
3. 伤感、安静的歌不要用 fireworks、collage 和 punchy；它的高潮用 dramatic、hero、sparkler 或更浓的氛围元素来表达。
3.1 动态要有层次：前奏和主歌多用 gentle 或 lyrical，副歌升一级，最后一次副歌最强，尾声回到 gentle。
4. 重复出现的副歌可以沿用第一次的 scene，最后一次副歌可以更满。
5. 留白也是表达，不要每段都很满。`;

/**
 * `{ system, user }` for one song. Paragraph numbers are the analysis' paragraph
 * indexes; credits are left out; a repeated paragraph is shown once and referenced.
 */
const buildPrompt = ({ analysis, song, theme, duration, audio = null }) => {
  const rows = [
    `歌名：${clip(song?.title, 60) || '（未知）'}`,
    `歌手：${clip(song?.artist, 60) || '（未知）'}`,
  ];
  if (song?.album) rows.push(`专辑：${clip(song.album, 60)}`);
  if (theme?.description) rows.push(`播放器为这首歌生成的主题：${clip(theme.name, 20)}（${clip(theme.description, 120)}）`);
  if (duration > 0) rows.push(`时长：${clock(duration)}`);
  if (audio?.bpm && audio.confidence >= 0.4) {
    const key = audio.key && audio.keyConfidence >= 0.4 ? `，${audio.key} ${audio.mode === 'minor' ? '小调' : '大调'}` : '';
    rows.push(`本机听出的音频特征：约 ${Math.round(audio.bpm)} BPM${key}（自动估算，可能有半拍或倍拍误差）`);
  }
  rows.push('', '段落（P 编号，[] 里是本地按结构判断的段落类型，仅供参考）：');
  for (const paragraph of analysis.paragraphs) {
    if (paragraph.kind === 'credits') continue;
    const label = SECTION_LABELS[paragraph.kind] ?? paragraph.kind;
    const head = `P${paragraph.index} [${label}] ${clock(paragraph.start)}–${clock(paragraph.end)}`;
    if (paragraph.repeatOf !== undefined) {
      rows.push(`${head}（歌词同 P${paragraph.repeatOf}）`);
      continue;
    }
    rows.push(head);
    for (const index of paragraph.lines) rows.push(`  ${clip(analysis.items[index].text, 60)}`);
  }
  if (!analysis.sung.length) rows.push('（纯音乐，没有歌词：sections 给空数组）');
  return { system: SYSTEM, user: rows.join('\n') };
};

const HEX = /^#[0-9a-f]{6}$/i;
const unit = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : clamp(Number(value)));

/* A keyword is kept only when it is really in the paragraph's lyric. */
const keywordIn = (paragraph, analysis, raw) => {
  const word = String(raw ?? '').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
  // 24: two English words ("summertime sadness") are often longer than 16 characters.
  if (!word || Array.from(word).length > 24) return '';
  const target = normalizeText(word);
  if (target.length < 1) return '';
  const hit = paragraph.lines.some((index) => normalizeText(analysis.items[index].text).includes(target));
  return hit ? word : '';
};

/**
 * Checks and clamps a model's answer. Throws when the song-level reading is
 * missing (nothing usable); drops any section field outside the vocabularies.
 */
const validateDirection = (json, analysis) => {
  if (!json || typeof json !== 'object') throw new Error('不是 JSON 对象');
  const valence = unit(json.valence);
  const energy = unit(json.energy);
  if (valence === null || energy === null) throw new Error('缺少 valence 或 energy');
  const palette = (Array.isArray(json.palette) ? json.palette : [])
    .map((color) => String(color).trim())
    .filter((color) => HEX.test(color))
    .slice(0, 4);
  const sealChar = Array.from(String(json.seal ?? '')).find((char) => WIDE.test(char)) ?? '';
  const sections = [];
  for (const raw of Array.isArray(json.sections) ? json.sections : []) {
    const p = Number.parseInt(raw?.p ?? String(raw?.P ?? '').replace(/^P/i, ''), 10);
    const paragraph = analysis.paragraphs[p];
    if (!paragraph || paragraph.kind === 'credits' || sections.some((s) => s.p === p)) continue;
    const scene = SCENES[raw.scene] ? raw.scene : null;
    const weather = WEATHERS[raw.weather] || ACCENTS[raw.weather] ? raw.weather : null;
    sections.push({
      p,
      energy: unit(raw.energy),
      motion: MOTIONS[raw.motion] ? raw.motion : null,
      scene,
      weather,
      burst: unit(raw.burst),
      keyword: keywordIn(paragraph, analysis, raw.keyword),
    });
  }
  return {
    v: DIRECTION_VERSION,
    src: 'ai',
    summary: String(json.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    valence,
    energy,
    warmth: unit(json.warmth) ?? 0.5,
    palette: palette.length >= 2 ? palette : [],
    weather: WEATHERS[json.weather] ? json.weather : null,
    seal: sealChar,
    sections,
  };
};

/** The direction without AI: the local mood, no per-section choices (the planner decides). */
const localDirection = ({ analysis, song, theme, audio = null }) => {
  const mood = localMood({ analysis, song, theme, audio });
  return {
    v: DIRECTION_VERSION,
    src: 'local',
    summary: '',
    valence: mood.valence,
    energy: mood.energy,
    warmth: mood.warmth,
    palette: [],
    weather: mood.weather,
    seal: '',
    sections: [],
  };
};
return { DIRECTION_VERSION, SCENES, WEATHERS, MOTIONS, ACCENTS, buildPrompt, validateDirection, localDirection };
})();

// ---- src/providers.mjs
const __providers = (() => {
// Endpoint presets for OpenAI-compatible chat APIs. A preset only fills in the
// base URL and knows how that provider switches reasoning off; the model name is
// always the user's (model lists change too often to ship), and "测试连接" can
// fetch the provider's own list. Any other OpenAI-compatible endpoint works
// through "自定义".

const PROVIDERS = {
  custom: { label: '自定义（填下面的接口地址）', url: '' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', thinking: 'reasoning_effort' },
  deepseek: { label: 'DeepSeek 深度求索', url: 'https://api.deepseek.com', thinking: 'thinking' },
  dashscope: { label: '阿里云百炼（通义千问）', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', thinking: 'enable_thinking' },
  zhipu: { label: '智谱 BigModel（GLM）', url: 'https://open.bigmodel.cn/api/paas/v4', thinking: 'thinking' },
  moonshot: { label: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1' },
  volcengine: { label: '火山方舟（豆包）', url: 'https://ark.cn-beijing.volces.com/api/v3', thinking: 'thinking' },
  siliconflow: { label: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1', thinking: 'enable_thinking' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  gemini: { label: 'Google Gemini（OpenAI 兼容端点）', url: 'https://generativelanguage.googleapis.com/v1beta/openai', thinking: 'reasoning_effort' },
  ollama: { label: 'Ollama（本机）', url: 'http://localhost:11434/v1', local: true },
  lmstudio: { label: 'LM Studio（本机）', url: 'http://localhost:1234/v1', local: true },
};

/** The request fields each way of switching reasoning off sends. */
const THINKING_OFF = {
  thinking: { thinking: { type: 'disabled' } },
  enable_thinking: { enable_thinking: false },
  reasoning_effort: { reasoning_effort: 'low' },
  none: {},
};

/* Hosts whose switch is known, for "自动" with a custom URL. */
const HOST_RULES = [
  [/deepseek\.com/, 'thinking'],
  [/bigmodel\.cn/, 'thinking'],
  [/volces\.com/, 'thinking'],
  [/dashscope|aliyuncs\.com/, 'enable_thinking'],
  [/siliconflow/, 'enable_thinking'],
  [/api\.openai\.com/, 'reasoning_effort'],
  [/generativelanguage\.googleapis\.com/, 'reasoning_effort'],
];

/** `auto` resolves by preset, then by host; anything else is used as given. */
const thinkingMethodFor = ({ method, provider, url }) => {
  if (method && method !== 'auto') return method;
  if (PROVIDERS[provider]?.thinking) return PROVIDERS[provider].thinking;
  const host = String(url).toLowerCase();
  return HOST_RULES.find(([pattern]) => pattern.test(host))?.[1] ?? 'none';
};

/** The base URL in effect: the user's own, or the preset's. */
const baseUrlFor = ({ provider, baseUrl }) => String(baseUrl ?? '').trim() || PROVIDERS[provider]?.url || '';

/** Local servers (Ollama, LM Studio, anything on this machine) need no key. */
const isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(url).trim());

/**
 * `<base>/<endpoint>`: a bare host gets `/v1` first (DeepSeek, most gateways);
 * a base that already has a path (`/v1`, `/api/v3`, `/v1beta/openai`) is used
 * as is. A full `.../chat/completions` URL is trimmed back to its base first.
 */
const endpointUrl = (base, endpoint) => {
  let url = String(base ?? '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const cut = url.search(/[?#]/);
  const query = cut === -1 ? '' : url.slice(cut);
  let path = (cut === -1 ? url : url.slice(0, cut)).replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/i, '');
  if (/^https?:\/\/[^/]+$/i.test(path)) path += '/v1';
  return `${path}/${endpoint}${query}`;
};
return { PROVIDERS, THINKING_OFF, thinkingMethodFor, baseUrlFor, isLocalUrl, endpointUrl };
})();

// ---- src/llm.mjs
const __llm = (() => {
// OpenAI-compatible chat calls through `folium.net.fetch` (host-side, no CORS,
// timeout at most 60 s), written to work with whatever endpoint a community user
// brings: OpenAI, Chinese providers, OpenRouter, local Ollama / LM Studio.
//
// Providers disagree on optional fields (JSON mode, how to switch reasoning off,
// max_tokens vs max_completion_tokens, whether temperature is allowed). The
// request starts with all of them and, when the provider rejects one, drops or
// swaps the field its error names and retries. What worked is handed back as a
// `compat` record so the next call for the same endpoint and model starts right.

const { endpointUrl } = __providers;

const TIMEOUT_MS = 45000;
const MAX_TOKENS = 1200;
const MAX_ATTEMPTS = 6;
const OPTIONAL_FIELDS = ['response_format', 'thinking', 'enable_thinking', 'reasoning_effort', 'temperature'];

const extractJson = (raw) => {
  let text = String(raw ?? '').trim();
  // Some local models wrap their answer in a <think> block even when asked not to.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }
  return JSON.parse(text);
};

const contentOf = (message) => {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('');
  return '';
};

/** Token counts, cache hits and reasoning tokens under the field names in use. */
const usageOf = (usage) => ({
  input: Number(usage?.prompt_tokens) || 0,
  output: Number(usage?.completion_tokens) || 0,
  cached: Number(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens) || 0,
  reasoning: Number(usage?.completion_tokens_details?.reasoning_tokens) || 0,
});

const redact = (text, apiKey) => String(text)
  .split(apiKey || '\u0000').join('[已隐藏]')
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1[已隐藏]')
  .replace(/("?(?:api[_-]?key|authorization|token)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi, '$1[已隐藏]');

/* What a status means to someone who just pasted a key in. */
const explainStatus = (status) => ({
  401: '密钥无效或已过期',
  402: '账户余额不足',
  403: '没有权限使用这个模型或接口',
  404: '地址或模型名不对（用“测试连接”看看可用的模型）',
  429: '请求太频繁或额度用完了',
}[status] ?? (status >= 500 ? '服务商那边出错了，稍后再试' : ''));

const headersFor = (apiKey) => ({
  'Content-Type': 'application/json',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

/** The request body for this attempt, from the compat record. */
const bodyFor = ({ model, temperature, thinkingFields, system, user, maxTokens = MAX_TOKENS }, compat) => {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature,
    stream: false,
    response_format: { type: 'json_object' },
    ...thinkingFields,
  };
  body[compat.maxTokensField ?? 'max_tokens'] = maxTokens;
  for (const field of compat.drop ?? []) delete body[field];
  return body;
};

/* Reads a 400/422 body for the field it complains about and returns the next
 * compat record, or null when there is nothing left to try. */
const nextCompat = (compat, body, errorText) => {
  const text = errorText.toLowerCase();
  if ((compat.maxTokensField ?? 'max_tokens') === 'max_tokens' && text.includes('max_tokens')) {
    return { ...compat, maxTokensField: 'max_completion_tokens' };
  }
  const named = OPTIONAL_FIELDS.find((field) => field in body && text.includes(field));
  const field = named ?? OPTIONAL_FIELDS.find((name) => name in body);
  if (!field) return null;
  return { ...compat, drop: [...new Set([...(compat.drop ?? []), field])] };
};

/**
 * @returns {Promise<{ json, usage, ms, thought: boolean, compat }>}
 *   `thought` is true when the model spent tokens reasoning anyway.
 */
const chatJson = async ({ fetch, baseUrl, apiKey, model, temperature, thinkingFields = {}, system, user, maxTokens, compat: start = {} }) => {
  const url = endpointUrl(baseUrl, 'chat/completions');
  if (!url) throw new Error('还没有选择服务商或填写接口地址');
  if (!model) throw new Error('还没有填写模型名');
  let compat = { drop: [], ...start };
  const started = performance.now();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const body = bodyFor({ model, temperature, thinkingFields, system, user, maxTokens }, compat);
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers: headersFor(apiKey), body: JSON.stringify(body), timeoutMs: TIMEOUT_MS });
    } catch (error) {
      throw new Error(`连不上接口：${redact(error?.message ?? error, apiKey)}`);
    }
    if (response.ok) {
      let data;
      try {
        data = response.json();
      } catch {
        throw new Error('接口返回的不是 JSON（地址可能填错了）');
      }
      const choice = data?.choices?.[0];
      const text = contentOf(choice?.message);
      const usage = usageOf(data?.usage);
      const thought = Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning || usage.reasoning > 0);
      if (!text) {
        throw new Error(choice?.finish_reason === 'length'
          ? '回答被长度上限截断：这个模型可能在“思考”，在设置里换一种关闭思考的方式，或换个模型'
          : '接口返回了空内容');
      }
      let json;
      try {
        json = extractJson(text);
      } catch {
        throw new Error(`模型没有按要求返回 JSON：${text.slice(0, 120)}`);
      }
      return { json, usage, ms: Math.round(performance.now() - started), thought, compat };
    }
    const errorText = (() => {
      try {
        return redact(response.text(), apiKey);
      } catch {
        return '';
      }
    })();
    const retryable = response.status === 400 || response.status === 422;
    const next = retryable ? nextCompat(compat, body, errorText) : null;
    if (!next) {
      const hint = explainStatus(response.status);
      throw new Error(`接口返回 ${response.status}${hint ? `（${hint}）` : ''}：${errorText.slice(0, 240) || response.statusText}`);
    }
    compat = next;
  }
  throw new Error('接口一直拒绝请求，换个模型试试');
};

/** GET /models, as most OpenAI-compatible servers offer it. */
const listModels = async ({ fetch, baseUrl, apiKey }) => {
  const url = endpointUrl(baseUrl, 'models');
  if (!url) throw new Error('还没有选择服务商或填写接口地址');
  const response = await fetch(url, { method: 'GET', headers: headersFor(apiKey), timeoutMs: 15000 });
  if (!response.ok) {
    const hint = explainStatus(response.status);
    throw new Error(`获取模型列表失败 ${response.status}${hint ? `（${hint}）` : ''}`);
  }
  const data = response.json();
  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
  return list.map((item) => (typeof item === 'string' ? item : item?.id ?? item?.name)).filter(Boolean).sort();
};

const PING_SYSTEM = '只输出一个 JSON 对象：{"ok": true, "word": "一个描述夜晚的中文词"}';

/** "测试连接": the model list (when offered) and one tiny JSON call. */
const testConnection = async ({ fetch, baseUrl, apiKey, model, thinkingFields, compat }) => {
  const report = { models: null, modelsError: null, modelListed: null, chat: null, chatError: null };
  try {
    report.models = await listModels({ fetch, baseUrl, apiKey });
    report.modelListed = report.models.length === 0 ? null : report.models.includes(model);
  } catch (error) {
    report.modelsError = String(error?.message ?? error);
  }
  if (model) {
    try {
      report.chat = await chatJson({ fetch, baseUrl, apiKey, model, temperature: 0.2, thinkingFields, system: PING_SYSTEM, user: '测试', compat });
    } catch (error) {
      report.chatError = String(error?.message ?? error);
    }
  }
  return report;
};
return { usageOf, chatJson, listModels, testConnection };
})();

// ---- src/random.mjs
const __random = (() => {
// Seeded randomness. Every scatter, pick and particle in 花笺 comes from here,
// keyed by the song and the song clock, so a frame looks the same after a pause,
// a seek, a remount or in the export window.

/** FNV-1a over code points: a stable 32-bit seed from any text. */
const hashString = (text) => {
  let h = 2166136261 >>> 0;
  for (const char of String(text ?? '')) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/** Stateless hash of up to three integers to [0, 1): per-particle constants without storing them. */
const hash01 = (a, b = 0, c = 0) => {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

/** mulberry32: a small seeded generator for sequences of picks. */
const createRandom = (seed) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const between = (random, min, max) => min + (max - min) * random();

/** `entries` is `[[value, weight], …]`; weights at or below 0 never win. */
const weightedPick = (random, entries) => {
  const usable = entries.filter(([, weight]) => weight > 0);
  if (usable.length === 0) return entries[0]?.[0];
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0);
  let x = random() * total;
  for (const [value, weight] of usable) {
    x -= weight;
    if (x <= 0) return value;
  }
  return usable[usable.length - 1][0];
};
return { hashString, hash01, createRandom, between, weightedPick };
})();

// ---- src/director.mjs
const __director = (() => {
// The AI director service, shared by every mount of the visualizer. For each
// song it hands out a direction at once (the local reading) and upgrades it
// when the AI's arrives: from the data file when the song was heard before,
// otherwise with one call to the user's OpenAI-compatible endpoint. While the
// mode is on screen it also prepares the next song in the queue, so a song
// change finds its direction already waiting.
//
// Calls are made only from the main window, only while 花笺 is the mode on
// screen (not for previews), one at a time, and a failed song is not retried
// for a few minutes.

const { analyzeLyrics, lyricFingerprint, songKeyOf } = __lyrics;
const { DIRECTION_VERSION, buildPrompt, localDirection, validateDirection } = __direction;
const { chatJson, testConnection } = __llm;
const { THINKING_OFF, baseUrlFor, isLocalUrl, thinkingMethodFor } = __providers;
const { hashString } = __random;

const RETRY_AFTER_MS = 5 * 60 * 1000;
const PREFETCH_DELAY_MS = 4000;
const MAX_TOKENS = 1800;

const STATUS_TEXT = {
  local: '本地导演',
  loading: '读取记忆',
  asking: 'AI 正在读歌',
  ai: 'AI 导演',
  cached: 'AI 导演（记忆）',
  error: 'AI 出错，用本地导演',
  'no-key': '没填密钥，用本地导演',
  off: '本地导演',
};

const createDirector = ({ folium, store, getConfig }) => {
  const log = folium.log;
  const entries = new Map();
  const liveMounts = new Set();
  const queue = [];
  let working = false;
  let compat = null;
  let usage = null;
  let prefetchTimer = null;
  let disposed = false;

  const loadCompat = async () => {
    compat ??= (await store.get('compat')) ?? {};
    return compat;
  };
  const loadUsage = async () => {
    usage ??= (await store.get('usage')) ?? { calls: 0, input: 0, output: 0 };
    return usage;
  };

  const notify = (entry) => {
    for (const listener of entry.listeners) {
      try {
        listener(entry);
      } catch (error) {
        log.warn('导演更新的监听出错', { message: String(error?.message ?? error) });
      }
    }
  };
  const setStatus = (entry, status, error = '') => {
    entry.status = status;
    entry.error = error;
    notify(entry);
  };

  const configured = () => {
    const config = getConfig();
    return config.ai && folium.env?.context === 'main' && Boolean(config.model) && Boolean(baseUrlFor(config));
  };

  /* One entry per song and lyric: a new lyric for the same song starts over. */
  const ensure = ({ song, lines, theme, duration }) => {
    const analysis = analyzeLyrics(lines);
    const fingerprint = lyricFingerprint(analysis);
    const key = songKeyOf(song) ?? `lyric:${hashString(fingerprint)}`;
    let entry = entries.get(key);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = {
        key,
        song,
        analysis,
        fingerprint,
        theme,
        duration,
        local: localDirection({ analysis, song, theme }),
        ai: null,
        status: 'local',
        error: '',
        listeners: entry?.listeners ?? new Set(),
        loaded: null,
        failedAt: 0,
        queued: false,
        audio: null,
        audioState: null,
        audioLoaded: null,
      };
      entries.set(key, entry);
      // Keep memory small: forget songs nobody watches, beyond the last few.
      if (entries.size > 12) {
        for (const [otherKey, other] of entries) {
          if (entries.size <= 12) break;
          if (other !== entry && other.listeners.size === 0) entries.delete(otherKey);
        }
      }
    } else if (duration > 0) {
      entry.duration = duration;
    }
    return entry;
  };

  const loadStored = (entry) => {
    entry.loaded ??= (async () => {
      setStatus(entry, entry.ai ? entry.status : 'loading');
      try {
        const record = await store.getDirection(entry.key);
        if (record?.d?.v === DIRECTION_VERSION && record.fp === entry.fingerprint) {
          entry.ai = record.d;
          setStatus(entry, 'cached');
          return;
        }
      } catch (error) {
        log.warn('读取导演记忆失败', { message: String(error?.message ?? error) });
      }
      if (!entry.ai) setStatus(entry, 'local');
    })();
    return entry.loaded;
  };

  const runQueue = async () => {
    if (working) return;
    working = true;
    try {
      while (queue.length > 0 && !disposed) {
        const entry = queue.shift();
        entry.queued = false;
        if (entry.ai) continue;
        await ask(entry);
      }
    } finally {
      working = false;
    }
  };

  const enqueue = (entry, urgent) => {
    if (entry.ai || entry.queued || !configured()) return;
    if (Date.now() - entry.failedAt < RETRY_AFTER_MS) return;
    entry.queued = true;
    if (urgent) queue.unshift(entry);
    else queue.push(entry);
    runQueue();
  };

  const hasKey = async () => {
    const apiKey = await folium.secrets.get('apiKey').catch(() => null);
    return { apiKey, ok: Boolean(apiKey) || isLocalUrl(baseUrlFor(getConfig())) };
  };

  /** One AI call for one lyric: the validated direction, the raw answer and the call's cost. Throws on failure. */
  const requestDirection = async ({ analysis, song, theme, duration, audio = null }) => {
    const config = getConfig();
    const baseUrl = baseUrlFor(config);
    const { apiKey } = await hasKey();
    const compatKey = `${baseUrl}|${config.model}`;
    const quirks = await loadCompat();
    const { system, user } = buildPrompt({ analysis, song, theme, duration, audio });
    const method = thinkingMethodFor({ method: config.thinking, provider: config.provider, url: baseUrl });
    const result = await chatJson({
      fetch: (url, init) => folium.net.fetch(url, init),
      baseUrl,
      apiKey,
      model: config.model,
      temperature: config.temperature,
      thinkingFields: THINKING_OFF[method] ?? {},
      system,
      user,
      maxTokens: MAX_TOKENS,
      compat: quirks[compatKey],
    });
    quirks[compatKey] = result.compat;
    store.set('compat', quirks).catch(() => {});
    const totals = await loadUsage();
    totals.calls += 1;
    totals.input += result.usage.input;
    totals.output += result.usage.output;
    store.set('usage', totals).catch(() => {});
    return { direction: validateDirection(result.json, analysis), json: result.json, result };
  };

  const ask = async (entry) => {
    if (!(await hasKey()).ok) {
      setStatus(entry, 'no-key');
      return;
    }
    if (entry.analysis.sung.length === 0) {
      setStatus(entry, 'local');
      return;
    }
    setStatus(entry, 'asking');
    try {
      const { direction, result } = await requestDirection(entry);
      entry.ai = direction;
      entry.lastCall = { ms: result.ms, input: result.usage.input, output: result.usage.output, thought: result.thought };
      setStatus(entry, 'ai');
      await store.putDirection(entry.key, entry.fingerprint, direction);
      log.info('AI 导演完成', { song: entry.song?.title, ms: result.ms, tokens: result.usage.input + result.usage.output });
    } catch (error) {
      entry.failedAt = Date.now();
      const message = String(error?.message ?? error).slice(0, 200);
      log.warn('AI 导演失败，继续用本地导演', { song: entry.song?.title, message });
      setStatus(entry, 'error', message);
    }
  };

  /* Takes a reading; the local direction is redone only when it would really change (a first lock,
   * or the tempo moving by more than 3 %), so the stage does not rebuild shots every few seconds. */
  const applyAudio = (entry, features, state) => {
    const before = entry.audio;
    entry.audio = features;
    entry.audioState = state ?? entry.audioState;
    const locked = (f) => Boolean(f?.bpm) && f.confidence >= 0.4;
    const moved = locked(features) && (!locked(before) || Math.abs(features.bpm - before.bpm) / before.bpm > 0.03);
    if (!moved) return;
    entry.local = localDirection({ analysis: entry.analysis, song: entry.song, theme: entry.theme, audio: features });
    // The plan follows the tempo too (流光 / 云阶 for slow songs, 心象 for fast ones), so a first lock
    // re-plans the shots not yet shown, AI direction or not.
    notify(entry);
  };

  // ------------------------------------------------------------ the next song

  /* The song after this one, as the queue and the repeat mode say (same rule as AI 导演 Plus). */
  const nextSong = () => {
    const playback = folium.playback;
    if (typeof playback?.getQueue !== 'function') return null;
    const queueSnapshot = playback.getQueue({ limit: 1 });
    if (queueSnapshot.kind === 'stage' || queueSnapshot.currentIndex < 0 || queueSnapshot.length === 0) return null;
    const loop = playback.getLoopMode?.() ?? 'off';
    if (loop === 'one') return null;
    let index = queueSnapshot.currentIndex + 1;
    if (index >= queueSnapshot.length) {
      if (loop !== 'all') return null;
      index = 0;
    }
    return playback.getQueue({ offset: index, limit: 1 }).items.find((item) => item.index === index)?.song ?? null;
  };

  const prefetch = async () => {
    prefetchTimer = null;
    if (disposed || liveMounts.size === 0 || !getConfig().prefetch || !configured()) return;
    if (working || queue.length > 0) {
      schedulePrefetch();
      return;
    }
    const song = nextSong();
    const key = songKeyOf(song);
    if (!song?.ref || !key || entries.get(key)?.ai) return;
    if (typeof folium.omni?.getLyrics !== 'function') return;
    try {
      const stored = await store.getDirection(key);
      if (stored?.d?.v === DIRECTION_VERSION) return;
      const lyrics = await folium.omni.getLyrics(song);
      if (!lyrics?.lines?.length) return;
      const entry = ensure({ song, lines: lyrics.lines, theme: null, duration: 0 });
      await loadStored(entry);
      enqueue(entry, false);
    } catch (error) {
      log.info('下一首拿不到歌词，播放时再分析', { message: String(error?.code ?? error?.message ?? error) });
    }
  };

  const schedulePrefetch = () => {
    if (prefetchTimer || disposed) return;
    prefetchTimer = setTimeout(() => prefetch(), PREFETCH_DELAY_MS);
  };

  // ------------------------------------------------------------ public

  return {
    /**
     * For one mount: the song's direction now, and updates as better ones arrive.
     * `live` is false for previews and the export window, which never call the AI.
     */
    attach({ song, lines, theme, duration, live }) {
      const entry = ensure({ song, lines, theme, duration });
      const handle = {
        get entry() {
          return entry;
        },
        get direction() {
          return entry.ai ?? entry.local;
        },
        get analysis() {
          return entry.analysis;
        },
        onUpdate(listener) {
          entry.listeners.add(listener);
          return () => entry.listeners.delete(listener);
        },
        /** The theme changed (Folia's AI theme often lands after the song starts): re-read the local mood. */
        updateTheme(nextTheme) {
          if (entry.ai || !nextTheme?.description || nextTheme.description === entry.theme?.description) return;
          entry.theme = nextTheme;
          entry.local = localDirection({ analysis: entry.analysis, song: entry.song, theme: nextTheme, audio: entry.audio });
          notify(entry);
        },
        /** What was heard of this song so far (from the data file, then refined while it plays). */
        loadAudio() {
          entry.audioLoaded ??= store.getAudio(entry.key).then((record) => {
            if (record?.f && !entry.audio) applyAudio(entry, record.f, record.s);
            return record;
          }).catch(() => null);
          return entry.audioLoaded;
        },
        /** A new reading from the stage; kept (throttled) and, for a local direction, used at once. */
        setAudio(features, state) {
          applyAudio(entry, features, state);
          const now = Date.now();
          if (now - (entry.audioSavedAt ?? 0) > 20000) {
            entry.audioSavedAt = now;
            store.putAudio(entry.key, { f: features, s: state }).catch(() => {});
          }
        },
        detach() {
          liveMounts.delete(handle);
        },
      };
      if (live) liveMounts.add(handle);
      loadStored(entry).then(() => {
        if (!live || entry.ai) {
          if (live) schedulePrefetch();
          return;
        }
        if (!configured()) return;
        enqueue(entry, true);
      });
      if (live) {
        const offPrefetch = handle.onUpdate((updated) => {
          if (updated.status === 'ai' || updated.status === 'cached') schedulePrefetch();
        });
        const detach = handle.detach;
        handle.detach = () => {
          offPrefetch();
          detach();
        };
      }
      return handle;
    },

    /** The entry of the song playing now, if a mount has seen it. */
    current() {
      const key = songKeyOf(folium.playback?.getState?.().song ?? null);
      return key ? entries.get(key) ?? null : null;
    },

    /** Forgets the stored direction of the song playing now and asks again. */
    async reanalyze() {
      const entry = this.current();
      if (!entry) return '先在播放页用花笺放一首有歌词的歌';
      if (!configured()) return '还没有配置 AI：在 设置 → 模组 → 花笺 里选服务商、填模型和密钥';
      await store.forget(entry.key);
      entry.ai = null;
      entry.failedAt = 0;
      notify(entry);
      enqueue(entry, true);
      return 'AI 正在重新读这首歌，几秒后画面会跟着变';
    },

    describe() {
      const entry = this.current();
      if (!entry) return '还没有用花笺放过这首歌';
      const d = entry.ai ?? entry.local;
      const head = `${STATUS_TEXT[entry.status] ?? entry.status}${entry.error ? `（${entry.error.slice(0, 60)}）` : ''}`;
      const mood = `明暗 ${d.valence.toFixed(2)} · 能量 ${d.energy.toFixed(2)} · 冷暖 ${d.warmth.toFixed(2)}`;
      return [head, d.summary, mood].filter(Boolean).join('\n');
    },

    async testConnection() {
      const config = getConfig();
      const baseUrl = baseUrlFor(config);
      const apiKey = await folium.secrets.get('apiKey').catch(() => null);
      const quirks = await loadCompat();
      const method = thinkingMethodFor({ method: config.thinking, provider: config.provider, url: baseUrl });
      return testConnection({
        fetch: (url, init) => folium.net.fetch(url, init),
        baseUrl,
        apiKey,
        model: config.model,
        thinkingFields: THINKING_OFF[method] ?? {},
        compat: quirks[`${baseUrl}|${config.model}`],
      });
    },

    /** For the developer evaluation: ask the AI about any lyric without touching per-song memory. */
    requestDirection,
    configured,

    async usage() {
      return { ...(await loadUsage()), songs: await store.count() };
    },

    onSetupChanged() {
      for (const entry of entries.values()) entry.failedAt = 0;
      for (const handle of liveMounts) enqueue(handle.entry, true);
    },

    dispose() {
      disposed = true;
      clearTimeout(prefetchTimer);
      queue.length = 0;
    },
  };
};
return { STATUS_TEXT, createDirector };
})();

// ---- src/kinetic.mjs
const __kinetic = (() => {
// The motion vocabulary: how a character comes in, how it moves while it is
// sung, and how it leaves. Every function writes a transform in em units (a
// fraction of the character's own size) so the same motion reads the same at
// any size, and every motion is a pure function of progress, so it is exact at
// any moment of a seek or an export.
//
// The craft is the classic one: anticipation, squash and stretch, overshoot,
// damped settle, staggered order. Motions are grouped by temperament so a sad
// song gets ink, rain and rack focus, and a loud one gets stamps and glitches.

const { clamp, easeInCubic, easeOutBack, easeOutCubic, easeOutExpo } = __motion;
const { hash01 } = __random;

const TAU = Math.PI * 2;
const sat = (x) => clamp(x);
const easeOutQuart = (t) => 1 - (1 - t) ** 4;
const easeInQuad = (t) => t * t;
/** A damped wobble over t in 0..1: the settle after an impact. */
const wobble = (t, frequency, decay) => Math.exp(-decay * t) * Math.sin(frequency * t) * (1 - t);

const blank = () => ({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skew: 0, alpha: 1, glow: 0, blur: 0, rgb: 0, scramble: 0, ghost: 0, tint: 0 });

const reset = (o) => {
  o.dx = 0; o.dy = 0; o.sx = 1; o.sy = 1; o.rot = 0; o.skew = 0; o.alpha = 1;
  o.glow = 0; o.blur = 0; o.rgb = 0; o.scramble = 0; o.ghost = 0; o.tint = 0;
  return o;
};
const scale = (o, s) => {
  o.sx *= s;
  o.sy *= s;
};

/*
 * ENTER: p is 0..1 through the entrance. `g` carries per-glyph randoms (r1..r3),
 * the shot's travel direction (dirX, dirY), the vector to the block center in em
 * (cx, cy) and the song time (t).
 */
const ENTER = {
  // ---- gentle: for quiet and sad passages
  fade: { dur: 1.0, fn(p, g, o) {
    // Nothing moves: the character simply comes up out of a soft blur.
    o.alpha = sat(p * 1.6) ** 1.3;
    o.blur = (1 - p) ** 1.6 * 0.6;
  } },
  ink: { dur: 1.1, fn(p, g, o) {
    const e = easeOutCubic(p);
    o.alpha = sat(p * 1.8);
    o.blur = (1 - p) ** 1.4;
    scale(o, 1.07 - 0.07 * e);
    o.glow = 0.55 * (1 - e);
  } },
  drift: { dur: 1.0, fn(p, g, o) {
    const e = easeOutCubic(p);
    o.dy = 0.85 * (1 - e);
    o.dx = (g.r1 - 0.5) * 0.25 * (1 - e);
    o.blur = (1 - p) ** 2;
    o.alpha = sat(p * 2);
  } },
  rain: { dur: 0.95, fn(p, g, o) {
    const e = easeOutCubic(p);
    o.dy = -1.7 * (1 - e);
    o.sy = 1 + 0.4 * (1 - e);
    o.sx = 1 - 0.18 * (1 - e);
    o.blur = 0.6 * (1 - p);
    o.alpha = sat(p * 3);
    if (p > 0.6) o.sy *= 1 - 0.06 * wobble((p - 0.6) / 0.4, 12, 3);
  } },
  focus: { dur: 1.0, fn(p, g, o) {
    const e = easeOutExpo(p);
    scale(o, 1.55 - 0.55 * e);
    o.blur = (1 - p) ** 1.1;
    o.alpha = sat(p * 2.4) * (0.6 + 0.4 * e);
  } },
  gather: { dur: 1.2, fn(p, g, o) {
    // Tracking closes in: characters start spread out and gather into the word.
    const e = easeOutQuart(p);
    o.dx = -g.cx * 0.9 * (1 - e);
    o.dy = -g.cy * 0.5 * (1 - e);
    o.blur = 0.7 * (1 - e);
    o.alpha = sat(p * 2);
  } },
  float: { dur: 1.0, fn(p, g, o) {
    const e = easeOutCubic(p);
    o.dy = 0.55 * (1 - e);
    o.rot = (g.r1 - 0.5) * 0.45 * (1 - e);
    o.dx = Math.sin(p * Math.PI) * 0.2 * (g.r2 - 0.5);
    o.blur = 0.5 * (1 - p);
    o.alpha = sat(p * 2.2);
  } },

  // ---- lively: for lyrical and dramatic passages
  rise: { dur: 0.65, fn(p, g, o) {
    const e = easeOutCubic(sat(p / 0.58));
    o.dy = 1.6 * (1 - e);
    if (p < 0.58) {
      o.sy = 1 + 0.5 * (1 - e);
      o.sx = 1 - 0.25 * (1 - e);
    } else {
      const q = (p - 0.58) / 0.42;
      o.sy = 1 - 0.18 * wobble(q, 11, 2.5);
      o.sx = 1 + 0.14 * wobble(q, 11, 2.5);
    }
    o.alpha = sat(p * 4);
  } },
  slide: { dur: 0.6, fn(p, g, o) {
    const e = easeOutQuart(p);
    o.dx = -2.4 * g.dirX * (1 - e);
    o.dy = -2.4 * g.dirY * (1 - e);
    o.sx = 1 + 0.7 * (1 - e) * Math.abs(g.dirX);
    o.sy = 1 + 0.7 * (1 - e) * Math.abs(g.dirY);
    o.skew = -0.35 * (1 - e) * Math.sign(g.dirX || 1);
    o.ghost = (1 - e) ** 3;
    o.alpha = sat(p * 5);
  } },
  flip: { dur: 0.7, fn(p, g, o) {
    const angle = Math.PI * 2.5 * (1 - easeOutCubic(p));
    o.sx = Math.cos(angle);
    o.sy = 1 + 0.08 * Math.sin(angle);
    o.dy = -0.3 * Math.sin(Math.PI * p) * (1 - p);
    o.alpha = sat(p * 6);
  } },
  wave: { dur: 0.85, fn(p, g, o) {
    const k = (1 - p) ** 1.5;
    o.dy = 1.1 * k * Math.cos(p * Math.PI * 3);
    o.rot = 0.4 * k * Math.sin(p * Math.PI * 3);
    o.sy = 1 + 0.18 * k * Math.sin(p * Math.PI * 3 + 0.6);
    o.alpha = sat(p * 4);
  } },
  zoom: { dur: 0.6, fn(p, g, o) {
    const k = 1.8 * (1 - easeOutQuart(p));
    scale(o, 1 + k * 1.5);
    o.dx = -g.cx * k;
    o.dy = -g.cy * k;
    o.blur = (1 - p) ** 1.4;
    o.alpha = sat(p * 3.5);
  } },
  stretch: { dur: 0.6, fn(p, g, o) {
    const k = (1 - p) ** 3;
    o.sx = 1 + 2 * k - 0.16 * wobble(p, 13, 3);
    o.sy = 1 - 0.72 * k + 0.12 * wobble(p, 13, 3);
    o.dx = -1.4 * k * g.dirX;
    o.dy = -1.4 * k * g.dirY;
    o.ghost = k * k;
    o.alpha = sat(p * 5);
  } },
  spiral: { dur: 0.95, fn(p, g, o) {
    const e = easeOutCubic(p);
    const radius = 3.2 * (1 - e);
    const angle = g.r1 * TAU + Math.PI * 2.5 * (1 - e);
    o.dx = Math.cos(angle) * radius;
    o.dy = Math.sin(angle) * radius * 0.8;
    o.rot = -TAU * (1 - e) * (g.r2 < 0.5 ? 1 : -1);
    scale(o, 0.25 + 0.75 * easeOutBack(p, 1.5));
    o.alpha = sat(p * 3);
  } },

  // ---- punchy: for loud and bright passages
  pop: { dur: 0.5, fn(p, g, o) {
    const s = easeOutBack(p, 2.4);
    o.sy = s * (1 + 0.14 * wobble(p, 14, 3));
    o.sx = s * (1 - 0.1 * wobble(p, 14, 3));
    o.rot = (g.r1 - 0.5) * 0.7 * (1 - easeOutCubic(p));
    o.dy = 0.25 * (1 - easeOutCubic(p));
    o.alpha = sat(p * 6);
  } },
  drop: { dur: 0.75, fn(p, g, o) {
    if (p < 0.48) {
      const e = p / 0.48;
      o.dy = -2.4 * (1 - e * e);
      o.sy = 1 + 0.3 * e;
      o.sx = 1 - 0.12 * e;
    } else {
      const e = (p - 0.48) / 0.52;
      o.dy = -0.32 * Math.abs(Math.sin(e * TAU)) * Math.exp(-3 * e) * (1 - e);
      o.sy = 1 - 0.3 * wobble(e, 16, 4);
      o.sx = 1 + 0.22 * wobble(e, 16, 4);
    }
    o.alpha = sat(p * 7);
  } },
  stamp: { dur: 0.5, fn(p, g, o) {
    if (p < 0.5) {
      const e = p / 0.5;
      scale(o, 2.6 - 1.6 * easeInQuad(e));
      o.rot = (g.r1 - 0.5) * 0.35 * (1 - e);
      o.alpha = sat(e * 2.2);
      o.blur = 0.4 * (1 - e);
    } else {
      const e = (p - 0.5) / 0.5;
      o.sx = 1 + 0.22 * wobble(e, 17, 4);
      o.sy = 1 - 0.22 * wobble(e, 17, 4);
      o.glow = 0.9 * Math.exp(-e * 5);
    }
  } },
  burst: { dur: 0.6, fn(p, g, o) {
    const e = easeOutBack(p, 1.8);
    o.dx = g.cx * (1 - e);
    o.dy = g.cy * (1 - e);
    scale(o, 0.2 + 0.8 * easeOutBack(sat(p * 1.3), 1.6));
    o.rot = (g.r3 - 0.5) * 4 * (1 - easeOutCubic(p));
    o.alpha = sat(p * 6);
  } },
  elastic: { dur: 0.95, fn(p, g, o) {
    const angle = g.r1 * TAU;
    const k = Math.exp(-4.2 * p) * Math.cos(p * Math.PI * 4.5) * (1 - p);
    o.dx = Math.cos(angle) * 1.6 * k;
    o.dy = Math.sin(angle) * 1.6 * k;
    o.rot = (g.r2 - 0.5) * 0.8 * k;
    o.sx = 1 + 0.18 * Math.abs(k);
    o.sy = 1 - 0.12 * Math.abs(k);
    o.alpha = sat(p * 5);
  } },
  scramble: { dur: 0.75, fn(p, g, o) {
    o.alpha = sat(p * 8);
    if (p < 0.72) {
      const tick = Math.floor(g.t * 22);
      o.scramble = 1 + Math.floor(hash01(tick, g.id, 1) * 1e6);
      o.dy = (hash01(tick, g.id, 2) - 0.5) * 0.12;
      o.alpha *= 0.75 + 0.25 * hash01(tick, g.id, 3);
    } else {
      scale(o, 1 + 0.16 * (1 - (p - 0.72) / 0.28) ** 2);
    }
  } },
  glitch: { dur: 0.65, fn(p, g, o) {
    if (p >= 0.8) return;
    const tick = Math.floor(g.t * 24);
    const k = 1 - p / 0.8;
    const a = hash01(tick, g.id, 4);
    const b = hash01(tick, g.id, 5);
    o.dx = b > 0.35 ? (a - 0.5) * 0.9 * k : 0;
    o.rgb = (0.4 + 0.6 * hash01(tick, g.id, 6)) * k;
    o.skew = hash01(tick, g.id, 7) > 0.7 ? (a - 0.5) * 0.9 * k : 0;
    o.sx = b > 0.82 ? 1 + 0.4 * k : 1;
    o.alpha = sat(p * 10) * (hash01(tick, g.id, 8) > 0.18 ? 1 : 0.25);
  } },
};

/* SING: s is seconds since the character's own time, d its duration, k the strength (0..1.5). */
const SING = {
  none: () => {},
  glow(s, d, o) {
    const hold = Math.max(d, 0.25);
    const env = sat(s / 0.08) * (1 - sat((s - hold) / 0.5));
    o.glow += env * 0.9;
    scale(o, 1 + 0.05 * env);
  },
  breath(s, d, o) {
    const env = Math.sin(Math.PI * sat(s / 0.7));
    scale(o, 1 + 0.045 * env);
    o.glow += 0.45 * env;
    o.dy -= 0.04 * env;
  },
  ripple(s, d, o) {
    const env = Math.sin(Math.PI * sat(s / 0.42));
    o.dy -= 0.16 * env;
    o.glow += 0.4 * env;
  },
  swell(s, d, o) {
    const hold = Math.max(d, 0.12);
    scale(o, 1 + 0.24 * easeOutBack(sat(s / 0.18), 2) * (1 - sat((s - hold) / 0.35)));
    o.glow += 0.5 * (1 - sat((s - hold) / 0.35)) * sat(s / 0.05);
  },
  bounce(s, d, o) {
    if (s < 0.3) o.dy -= 0.28 * Math.sin((s / 0.3) * Math.PI);
    const q = s - 0.3;
    if (q >= 0 && q < 0.3) {
      o.sy *= 1 - 0.14 * wobble(q / 0.3, 14, 3);
      o.sx *= 1 + 0.1 * wobble(q / 0.3, 14, 3);
    } else if (s < 0.3) {
      o.sy *= 1 + 0.08 * Math.sin((s / 0.3) * Math.PI);
    }
    o.glow += 0.4 * Math.exp(-s / 0.3);
  },
  jump(s, d, o, g) {
    if (s < 0.42) {
      const q = s / 0.42;
      o.dy -= 0.5 * Math.sin(q * Math.PI);
      o.rot += (g.r1 < 0.5 ? 1 : -1) * 0.22 * Math.sin(q * TAU) * (1 - q);
      o.sy *= 1 + 0.2 * Math.sin(q * Math.PI) * (1 - q);
    } else if (s < 0.77) {
      const q = (s - 0.42) / 0.35;
      o.sy *= 1 - 0.2 * wobble(q, 13, 3);
      o.sx *= 1 + 0.16 * wobble(q, 13, 3);
    }
    o.glow += 0.5 * Math.exp(-s / 0.35);
  },
  shake(s, d, o, g) {
    const hold = Math.max(d, 0.12);
    const env = sat(s / 0.04) * Math.exp(-Math.max(0, s - hold) / 0.08) * (s < hold + 0.4 ? 1 : 0);
    o.dx += 0.07 * Math.sin(s * 61 + g.r1 * 9) * env;
    o.dy += 0.05 * Math.sin(s * 47 + g.r2 * 5) * env;
    o.rot += 0.09 * Math.sin(s * 53 + g.r3 * 7) * env;
    o.glow += 0.5 * env;
  },
  flash(s, d, o) {
    o.glow += 0.8 * Math.exp(-s / 0.14);
    scale(o, 1 + 0.2 * Math.exp(-s / 0.1) * sat(s / 0.03));
  },
  color(s, d, o) {
    // The accent while the word is sung, fading back after it: a word is not left recoloured.
    o.tint = sat(s / 0.1) * (1 - sat((s - Math.max(d, 0.2)) / 0.6));
    scale(o, 1 + 0.14 * Math.exp(-s / 0.12) * sat(s / 0.03));
    o.glow += 0.35 * Math.exp(-s / 0.4);
  },
};

/* EXIT: p is 0..1 through the exit. */
const EXIT = {
  // gentle
  fade: { dur: 0.9, fn(p, g, o) {
    o.alpha *= (1 - p) ** 1.4;
    o.blur = Math.max(o.blur, 0.7 * p);
  } },
  driftUp: { dur: 0.9, fn(p, g, o) {
    o.dy -= 0.8 * easeInCubic(p);
    o.alpha *= 1 - p ** 1.4;
    o.blur = Math.max(o.blur, p);
  } },
  dissolve: { dur: 0.85, fn(p, g, o) {
    const flicker = hash01(Math.floor(g.t * 20), g.id, 9);
    o.alpha *= (1 - p) ** 1.3 * (1 - 0.45 * p * flicker);
    scale(o, 1 + 0.14 * easeOutCubic(p));
    o.dy -= 0.35 * easeOutCubic(p);
    o.blur = Math.max(o.blur, p);
  } },
  sink: { dur: 1.0, fn(p, g, o) {
    o.dy += 0.6 * easeInCubic(p);
    o.sy *= 1 + 0.25 * p;
    o.alpha *= 1 - p;
    o.blur = Math.max(o.blur, 0.8 * p);
  } },
  // lively
  fall: { dur: 0.8, fn(p, g, o) {
    const e = easeInCubic(p);
    o.dy += 3 * e;
    o.dx += 0.28 * Math.sin(p * TAU + g.r1 * 6) * p;
    o.rot += (g.r2 - 0.5) * 1.2 * e;
    o.sy *= 1 + 0.4 * e;
    o.sx *= 1 - 0.25 * e;
    o.alpha *= 1 - p ** 1.6;
  } },
  slide: { dur: 0.5, fn(p, g, o) {
    const e = easeInCubic(p);
    o.dx += g.dirX * 7 * e;
    o.dy += g.dirY * 7 * e;
    o.sx *= 1 + 0.45 * easeInQuad(p) * Math.abs(g.dirX);
    o.skew -= 0.45 * easeInQuad(p) * Math.sign(g.dirX || 1);
    o.ghost = Math.max(o.ghost, e * e);
    o.alpha *= 1 - sat((p - 0.45) / 0.55) ** 1.5;
  } },
  shrink: { dur: 0.55, fn(p, g, o) {
    const s = p < 0.2 ? 1 + 0.16 * Math.sin((p / 0.2) * Math.PI / 2) : 1.16 * (1 - easeInCubic((p - 0.2) / 0.8));
    scale(o, Math.max(0, s));
    o.rot += (g.r1 - 0.5) * 0.9 * p;
    o.alpha *= p > 0.8 ? (1 - p) / 0.2 : 1;
  } },
  zoomPast: { dur: 0.55, fn(p, g, o) {
    const e = easeInCubic(p);
    scale(o, 1 + 3 * e);
    o.dx -= g.cx * 2 * e;
    o.dy -= g.cy * 2 * e;
    o.blur = Math.max(o.blur, p);
    o.alpha *= 1 - p;
  } },
  // punchy
  scatter: { dur: 0.7, fn(p, g, o) {
    let vx = -g.cx + (g.r1 - 0.5) * 2;
    let vy = -g.cy + (g.r2 - 0.5) * 2;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len;
    vy /= len;
    const e = easeOutCubic(p);
    const reach = 2.4 + g.r3 * 1.8;
    o.dx += vx * reach * e;
    o.dy += vy * reach * e;
    o.rot += (g.r2 - 0.5) * 3.2 * e;
    scale(o, 1 - 0.65 * e);
    o.alpha *= 1 - p ** 1.6;
  } },
  ascend: { dur: 0.65, fn(p, g, o) {
    const e = easeInCubic(p);
    o.dy += (p < 0.22 ? Math.sin((p / 0.22) * Math.PI) * 0.12 : 0) - 2.8 * e;
    o.dx += (g.r1 - 0.5) * 0.7 * e;
    o.sy *= 1 + 0.45 * e;
    o.sx *= 1 - 0.22 * e;
    o.alpha *= 1 - easeInQuad(p);
  } },
  blink: { dur: 0.5, fn(p, g, o) {
    const on = p < 0.14 || (p >= 0.24 && p < 0.4) || (p >= 0.5 && p < 0.6) || (p >= 0.7 && p < 0.76) || (p >= 0.82 && p < 0.85);
    o.alpha *= on && p < 1 ? 1 : 0;
  } },
};

/** The order characters move in: a rank per glyph (0 first). `random` is a seeded shuffle. */
const ranks = (order, count, seed) => {
  const indexes = Array.from({ length: count }, (_, i) => i);
  if (order === 'reverse') return indexes.map((i) => count - 1 - i);
  if (order === 'center') {
    const mid = (count - 1) / 2;
    return indexes.map((i) => Math.round(Math.abs(i - mid) * 2) / 2);
  }
  if (order === 'edges') {
    const mid = (count - 1) / 2;
    return indexes.map((i) => Math.round((mid - Math.abs(i - mid)) * 2) / 2);
  }
  if (order === 'random') {
    const shuffled = [...indexes].sort((a, b) => hash01(seed, a, 77) - hash01(seed, b, 77));
    const rank = new Array(count);
    shuffled.forEach((glyph, position) => {
      rank[glyph] = position;
    });
    return rank;
  }
  return indexes;
};

/** Which order suits a motion: scrambles land at random, zooms from the middle out. */
const orderFor = (enter, random) => {
  if (enter === 'scramble' || enter === 'glitch') return 'random';
  if (enter === 'zoom' || enter === 'burst' || enter === 'gather') return 'center';
  if (enter === 'rain') return random < 0.5 ? 'random' : 'forward';
  return random < 0.2 ? 'reverse' : random < 0.32 ? 'center' : 'forward';
};

/** Seconds between ranks, fitted so the last character lands within `window` seconds. */
const fitStagger = (enter, maxRank, preferred, window) => {
  const duration = ENTER[enter]?.dur ?? 0.6;
  if (maxRank <= 0) return { stagger: 0, duration };
  const room = Math.max(0.05, window - duration);
  return { stagger: Math.min(preferred, room / maxRank), duration };
};

/**
 * Temperaments: which motions a passage may use. The planner picks from these,
 * so a ballad never stamps and a festival song never seeps in like ink.
 */
const TEMPERAMENTS = {
  gentle: {
    enter: ['ink', 'drift', 'rain', 'focus', 'gather', 'float'],
    sing: ['glow', 'breath', 'ripple'],
    exit: ['driftUp', 'dissolve', 'sink'],
    mode: [['line', 1]],
    stagger: 0.085,
    lead: 0.95,
    dim: 0.3,
  },
  lyrical: {
    enter: ['rise', 'float', 'focus', 'slide', 'flip', 'wave', 'ink', 'gather'],
    sing: ['swell', 'glow', 'ripple', 'breath', 'color'],
    exit: ['driftUp', 'dissolve', 'slide', 'shrink', 'fall'],
    mode: [['line', 3], ['sung', 1]],
    stagger: 0.05,
    lead: 0.75,
    dim: 0.34,
  },
  dramatic: {
    enter: ['stamp', 'zoom', 'focus', 'slide', 'rise', 'stretch', 'spiral', 'scramble'],
    sing: ['flash', 'swell', 'shake', 'color', 'glow'],
    exit: ['dissolve', 'scatter', 'zoomPast', 'fall', 'slide'],
    mode: [['line', 2], ['sung', 1]],
    stagger: 0.04,
    lead: 0.6,
    dim: 0.4,
  },
  punchy: {
    enter: ['pop', 'drop', 'stamp', 'spiral', 'scramble', 'glitch', 'elastic', 'stretch', 'burst', 'flip', 'wave', 'zoom'],
    sing: ['bounce', 'jump', 'shake', 'flash', 'swell', 'color'],
    exit: ['scatter', 'slide', 'ascend', 'shrink', 'blink', 'fall', 'zoomPast'],
    mode: [['line', 1], ['sung', 1]],
    stagger: 0.032,
    lead: 0.5,
    dim: 0.5,
  },
};

/**
 * A sad song's motions, whatever its temperament: characters fade up out of a blur, at most drift a
 * little, glow while sung and fade away. Its intensity shows in size, light and staging, not motion.
 */
const CALM = {
  enter: ['fade', 'ink', 'drift', 'fade'],
  sing: ['glow', 'breath'],
  exit: ['fade', 'driftUp', 'fade'],
};

/** The temperament of a passage from its energy and the song's brightness. */
const temperamentOf = (energy, valence) => {
  if (energy < 0.38) return 'gentle';
  if (energy < 0.62) return 'lyrical';
  return valence < 0.5 ? 'dramatic' : 'punchy';
};

const resetTransform = reset;
return { blank, ENTER, SING, EXIT, ranks, orderFor, fitStagger, TEMPERAMENTS, CALM, temperamentOf, resetTransform };
})();

// ---- src/emblems.mjs
const __emblems = (() => {
// Line-art emblems drawn behind a shot's main word, after the geometric
// figures of Folia's 商籁 (sonnet): dials, orbits, hexagons, a radar, a
// viewfinder, moon phases, a mandala, a constellation. Every figure is thin
// and thick strokes of one colour (the sprite is tinted), drawn around (0, 0)
// for a radius r, on a PixiJS Graphics.

const { hash01 } = __random;

const TAU = Math.PI * 2;

/* A closed polyline through points [[x, y], ...]. */
const loop = (g, points) => {
  g.moveTo(points[0][0], points[0][1]);
  for (let k = 1; k < points.length; k += 1) g.lineTo(points[k][0], points[k][1]);
  g.lineTo(points[0][0], points[0][1]);
};
const polygon = (cx, cy, r, sides, turn = 0) => Array.from({ length: sides }, (_, k) => [cx + r * Math.sin((k / sides) * TAU + turn), cy - r * Math.cos((k / sides) * TAU + turn)]);
const ellipse = (rx, ry, tilt, n = 72) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * TAU;
  const x = Math.cos(a) * rx;
  const y = Math.sin(a) * ry;
  return [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)];
});
const line = (g, x1, y1, x2, y2) => g.moveTo(x1, y1).lineTo(x2, y2);
const W = 0xffffff;

const EMBLEMS = {
  /* A dial: a double ring and radial ticks. */
  dial(g, r) {
    g.circle(0, 0, r).stroke({ color: W, width: 5, alpha: 0.8 });
    g.circle(0, 0, r * 0.965).stroke({ color: W, width: 1.5, alpha: 0.45 });
    for (let k = 0; k < 36; k += 1) {
      const a = (k / 36) * TAU;
      const inner = r * (k % 3 === 0 ? 0.74 : 0.84);
      line(g, Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    }
    g.stroke({ color: W, width: 1, alpha: 0.35 });
  },
  /* Nested diamonds on a cross. */
  diamond(g, r) {
    loop(g, polygon(0, 0, r, 4));
    g.stroke({ color: W, width: 5, alpha: 0.8 });
    loop(g, polygon(0, 0, r * 0.95, 4));
    g.stroke({ color: W, width: 1.5, alpha: 0.4 });
    loop(g, polygon(0, 0, r * 0.42, 4));
    g.stroke({ color: W, width: 1, alpha: 0.6 });
    line(g, -r * 1.25, 0, r * 1.25, 0);
    line(g, 0, -r * 1.25, 0, r * 1.25);
    g.stroke({ color: W, width: 1, alpha: 0.3 });
  },
  /* A hexagon with an inner hexagon and spokes between them. */
  hexagon(g, r) {
    loop(g, polygon(0, 0, r, 6));
    g.stroke({ color: W, width: 5, alpha: 0.8 });
    loop(g, polygon(0, 0, r * 0.95, 6));
    g.stroke({ color: W, width: 1.5, alpha: 0.4 });
    loop(g, polygon(0, 0, r * 0.4, 6));
    g.stroke({ color: W, width: 1, alpha: 0.5 });
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * TAU + Math.PI / 6;
      line(g, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
    }
    g.stroke({ color: W, width: 2, alpha: 0.4 });
  },
  /* Three orbits around a nucleus. */
  atom(g, r) {
    for (let k = 0; k < 3; k += 1) {
      loop(g, ellipse(r, r * 0.2, (k / 3) * Math.PI));
      g.stroke({ color: W, width: 1.5, alpha: 0.45 });
    }
    g.circle(0, 0, r * 0.07).fill({ color: W, alpha: 0.8 });
    g.circle(r * 0.92, 0, r * 0.035).fill({ color: W, alpha: 0.7 });
  },
  /* A ringed planet with a small moon. */
  planet(g, r) {
    g.circle(0, 0, r * 0.38).fill({ color: W, alpha: 0.08 }).stroke({ color: W, width: 2.5, alpha: 0.8 });
    loop(g, ellipse(r * 0.95, r * 0.22, -0.4));
    g.stroke({ color: W, width: 4, alpha: 0.5 });
    loop(g, ellipse(r * 1.08, r * 0.27, -0.4));
    g.stroke({ color: W, width: 1, alpha: 0.3 });
    g.circle(0, 0, r * 1.15).stroke({ color: W, width: 1, alpha: 0.18 });
    g.circle(Math.cos(0.8) * r * 1.15, Math.sin(0.8) * r * 1.15, r * 0.04).fill({ color: W, alpha: 0.7 });
  },
  /* A radar: rings, a crosshair, a swept sector and a scale of ticks. */
  radar(g, r, seed) {
    for (let k = 1; k <= 5; k += 1) g.circle(0, 0, r * 0.19 * k).stroke({ color: W, width: k % 2 === 0 ? 2 : 1, alpha: 0.18 + (k % 3) * 0.08 });
    line(g, -r * 1.12, 0, r * 1.12, 0);
    line(g, 0, -r * 1.12, 0, r * 1.12);
    g.stroke({ color: W, width: 1, alpha: 0.4 });
    const from = hash01(seed, 3) * TAU;
    g.moveTo(0, 0).arc(0, 0, r * 0.95, from, from + Math.PI / 4).lineTo(0, 0).fill({ color: W, alpha: 0.08 }).stroke({ color: W, width: 1.5, alpha: 0.5 });
    for (let k = 0; k < 72; k += 1) {
      const a = (k / 72) * TAU;
      const reach = k % 18 === 0 ? 0.13 : k % 6 === 0 ? 0.07 : 0.035;
      line(g, Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * r * (1 + reach), Math.sin(a) * r * (1 + reach));
    }
    g.stroke({ color: W, width: 1, alpha: 0.4 });
  },
  /* A viewfinder: corner brackets with rulers, a small crosshair in the middle. */
  viewfinder(g, r) {
    const w = r * 1.25;
    const h = r * 0.82;
    const arm = r * 0.22;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.moveTo(sx * w, sy * h + -sy * arm).lineTo(sx * w, sy * h).lineTo(sx * w - sx * arm, sy * h);
    }
    g.stroke({ color: W, width: 3.5, alpha: 0.75 });
    for (let x = -w + r * 0.12; x < w - r * 0.1; x += r * 0.12) {
      const long = Math.round((x + w) / (r * 0.12)) % 5 === 0;
      line(g, x, -h, x, -h - r * (long ? 0.07 : 0.035));
      line(g, x, h, x, h + r * (long ? 0.07 : 0.035));
    }
    g.stroke({ color: W, width: 1, alpha: 0.45 });
    g.circle(0, 0, r * 0.1).stroke({ color: W, width: 1.5, alpha: 0.4 });
    line(g, -r * 0.16, 0, r * 0.16, 0);
    line(g, 0, -r * 0.16, 0, r * 0.16);
    g.stroke({ color: W, width: 1, alpha: 0.4 });
  },
  /* Concentric orbits with beads on them. */
  orbits(g, r, seed) {
    for (let k = 1; k <= 5; k += 1) {
      const radius = r * 0.2 * k;
      g.circle(0, 0, radius).stroke({ color: W, width: k === 5 ? 3 : 1, alpha: k === 5 ? 0.6 : 0.25 });
      const a = hash01(seed, k, 5) * TAU;
      g.circle(Math.cos(a) * radius, Math.sin(a) * radius, r * (0.018 + 0.012 * (k % 2))).fill({ color: W, alpha: 0.75 });
    }
  },
  /* Moon phases on a ring around a large crescent. */
  phases(g, r) {
    const big = r * 0.42;
    g.moveTo(0, -big).arc(0, 0, big, -Math.PI / 2, Math.PI / 2).quadraticCurveTo(-big * 0.45, 0, 0, -big).fill({ color: W, alpha: 0.6 });
    g.circle(0, 0, big).stroke({ color: W, width: 1, alpha: 0.3 });
    g.circle(0, 0, r).stroke({ color: W, width: 1, alpha: 0.2 });
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * TAU - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const s = r * 0.055;
      g.circle(x, y, s).stroke({ color: W, width: 1, alpha: 0.5 });
      if (k === 4) g.circle(x, y, s * 0.8).fill({ color: W, alpha: 0.75 });
      else if (k !== 0) g.moveTo(x, y - s * 0.8).arc(x, y, s * 0.8, -Math.PI / 2, Math.PI / 2, k > 4).lineTo(x, y - s * 0.8).fill({ color: W, alpha: 0.5 });
    }
  },
  /* A mandala of petals in three rings. */
  petals(g, r) {
    for (let ring = 0; ring < 3; ring += 1) {
      const count = 8 + ring * 4;
      const reach = r * (1 - ring * 0.22);
      const width = 0.28 - ring * 0.05;
      for (let k = 0; k < count; k += 1) {
        const a = (k / count) * TAU + (Math.PI / count) * ring;
        const tip = [Math.cos(a) * reach, Math.sin(a) * reach];
        const c1 = [Math.cos(a - width) * reach * 0.5, Math.sin(a - width) * reach * 0.5];
        const c2 = [Math.cos(a + width) * reach * 0.5, Math.sin(a + width) * reach * 0.5];
        g.moveTo(0, 0).quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]).quadraticCurveTo(c2[0], c2[1], 0, 0);
      }
      g.stroke({ color: W, width: 1, alpha: 0.7 - ring * 0.18 });
    }
    g.circle(0, 0, r * 0.07).stroke({ color: W, width: 2, alpha: 0.8 });
  },
  /* Overlapping circles (the flower of life), faint outer ones. */
  flower(g, r) {
    const s = r * 0.33;
    g.circle(0, 0, s).stroke({ color: W, width: 1.5, alpha: 0.4 });
    for (let k = 0; k < 6; k += 1) g.circle(Math.cos((k / 6) * TAU) * s, Math.sin((k / 6) * TAU) * s, s).stroke({ color: W, width: 1.5, alpha: 0.28 });
    for (let k = 0; k < 12; k += 1) {
      const d = k % 2 === 0 ? s * 2 : s * Math.sqrt(3);
      const a = (k / 12) * TAU;
      g.circle(Math.cos(a) * d, Math.sin(a) * d, s).stroke({ color: W, width: 1, alpha: 0.1 });
    }
    g.circle(0, 0, s * 3).stroke({ color: W, width: 2, alpha: 0.3 });
  },
  /* Stars joined to their near neighbours. */
  constellation(g, r, seed) {
    const stars = Array.from({ length: 15 }, (_, k) => {
      const d = r * (0.15 + 0.85 * hash01(seed, k, 1));
      const a = hash01(seed, k, 2) * TAU;
      return [Math.cos(a) * d, Math.sin(a) * d];
    });
    stars.forEach(([x, y], k) => {
      for (let j = k + 1; j < stars.length; j += 1) {
        const dist = Math.hypot(stars[j][0] - x, stars[j][1] - y);
        if (dist < r * 0.5) line(g, x, y, stars[j][0], stars[j][1]);
      }
    });
    g.stroke({ color: W, width: 1, alpha: 0.32 });
    for (const [x, y] of stars) {
      g.circle(x, y, 2.6).fill({ color: W, alpha: 0.8 });
      g.circle(x, y, 6).stroke({ color: W, width: 1, alpha: 0.3 });
    }
    g.circle(0, 0, r * 1.08).stroke({ color: W, width: 1, alpha: 0.16 });
  },
};

const EMBLEM_NAMES = Object.keys(EMBLEMS);
/** The quiet ones, for a sad song: no sweep, no crosshair. */
const QUIET_EMBLEMS = ['orbits', 'phases', 'flower', 'dial', 'petals', 'constellation'];

/** Draws an emblem of radius r on a Graphics (white; tint it). */
const drawEmblem = (name, g, r, seed = 1) => {
  (EMBLEMS[name] ?? EMBLEMS.dial)(g, r, seed);
  return g;
};
return { EMBLEM_NAMES, QUIET_EMBLEMS, drawEmblem };
})();

// ---- src/layouts.mjs
const __layouts = (() => {
// Shot layouts: where every character of a shot sits, relative to the shot's
// center. A line is first cut into phrases (the spaces Chinese lyrics already
// use, then word segments) and each layout arranges phrases with a hierarchy:
// one hero phrase large, the others smaller, the way a poster is set.
//
// Word shots (after Folia's 商籁) set every word of one to four lines around a
// main word three to five times their size: orbit, ribbon, column, scatter,
// impact, tableau. Single lines: centerBig, stack, split, hero, type. Pages set
// a whole paragraph (each line appears when sung and stays): page (a
// manuscript stanza) and vertical (columns read right to left).

const { WIDE } = __lyrics;
const { hash01 } = __random;
const { clamp } = __motion;

const SPACE = /\s/u;
/* Chinese particles and light words that should not lead a headline word. */
const FUNCTION_CHARS = new Set(Array.from('的了着过吗呢吧啊呀嘛么就都也还又在是和与把被让给从向往对'));
const CLOSING = /[，。、；：！？）》」』】〕…—,.;:!?)\]}'"”’]/u;

let probe = null;
const measure = (font, char) => {
  probe ??= document.createElement('canvas').getContext('2d');
  if (probe.font !== font) probe.font = font;
  return probe.measureText(char).width;
};

/* Phrases of a line: runs between spaces; a long CJK run is cut again at word boundaries. */
const phrasesOf = (chars, segments, maxPieces = 4) => {
  const phrases = [];
  let current = null;
  chars.forEach((char, ci) => {
    if (SPACE.test(char)) {
      current = null;
      return;
    }
    if (!current) {
      current = { start: ci, end: ci + 1 };
      phrases.push(current);
    } else {
      current.end = ci + 1;
    }
  });
  // Cut the longest phrase at a word boundary until there are enough pieces (or none is long).
  const boundaries = segmentMarks(chars, segments).starts;
  const visible = (p) => p.end - p.start;
  for (let guard = 0; guard < 6 && phrases.length < maxPieces; guard += 1) {
    const longest = [...phrases].sort((a, b) => visible(b) - visible(a))[0];
    if (!longest || visible(longest) < 6) break;
    const mid = longest.start + visible(longest) / 2;
    let cut = -1;
    let best = Infinity;
    for (let k = longest.start + 2; k <= longest.end - 2; k += 1) {
      if (!boundaries.has(k)) continue;
      if (Math.abs(k - mid) < best) {
        best = Math.abs(k - mid);
        cut = k;
      }
    }
    if (cut < 0) cut = Math.round(mid);
    const at = phrases.indexOf(longest);
    phrases.splice(at, 1, { start: longest.start, end: cut }, { start: cut, end: longest.end });
  }
  // Merge one-character orphans into a neighbour (a lone 啊 is not a phrase).
  for (let i = phrases.length - 1; i >= 0 && phrases.length > 1; i -= 1) {
    if (visible(phrases[i]) <= 1 && WIDE.test(chars[phrases[i].start])) {
      const into = i > 0 ? i - 1 : 1;
      const a = phrases[Math.min(i, into)];
      const b = phrases[Math.max(i, into)];
      phrases.splice(Math.min(i, into), 2, { start: a.start, end: b.end });
    }
  }
  return phrases;
};

/*
 * Where the segments start, in character (code point) positions, and which characters are
 * punctuation. A segment's own `index` (a UTF-16 offset into the line) is trusted; without one, the
 * segments are taken to follow each other. Folia's segmenter may leave out spaces (jieba, a saved
 * split), so lengths alone cannot be summed.
 */
const segmentMarks = (chars, segments) => {
  const atOffset = new Map();
  let utf16 = 0;
  chars.forEach((char, i) => {
    atOffset.set(utf16, i);
    utf16 += char.length;
  });
  atOffset.set(utf16, chars.length);
  const starts = new Set();
  const punctuation = new Set();
  let next = 0;
  for (const seg of segments ?? []) {
    const start = Number.isInteger(seg.index) && atOffset.has(seg.index) ? atOffset.get(seg.index) : next;
    const length = Array.from(String(seg.segment ?? '')).length;
    starts.add(start);
    if (!seg.isWordLike) for (let k = start; k < start + length; k += 1) punctuation.add(k);
    next = start + length;
  }
  return { starts, punctuation };
};

/* Words of a line, walked character by character so none is ever lost: a new word starts where a
 * segment starts; punctuation joins the word before it; a space ends a word and marks the next as
 * `spaced` (Latin words), otherwise words abut (Chinese). */
const wordsOf = (chars, segments) => {
  const { starts, punctuation } = segmentMarks(chars, segments);
  const words = [];
  let current = null;
  let spaced = false;
  chars.forEach((char, i) => {
    if (SPACE.test(char)) {
      current = null;
      spaced = true;
      return;
    }
    const mark = punctuation.has(i) || /\p{P}/u.test(char);
    if (current && (mark || !starts.has(i))) {
      current.end = i + 1;
      return;
    }
    current = { start: i, end: i + 1, spaced: words.length > 0 && spaced };
    words.push(current);
    spaced = false;
  });
  return words;
};

/* Particles that belong to the word before them. */
const PARTICLES = new Set(Array.from('的了着过吗呢吧啊呀嘛么哦喔哈'));

/*
 * A line cut the way it reads: phrases (a space ends one, as Chinese lyrics mark them; in Latin,
 * punctuation or every third word), each a list of units (words), a single Chinese character never
 * standing alone: a particle joins the word before it, any other the word after it.
 */
const readingPhrases = (line, li = 0) => {
  const visible = (start, end) => line.chars.slice(start, end).filter((c) => !SPACE.test(c)).length;
  const words = wordsOf(line.chars, line.segments)
    .map((w) => ({ ...w, li, len: visible(w.start, w.end), cjk: WIDE.test(line.chars[w.start]) }))
    .filter((w) => w.len > 0);
  const phrases = [];
  for (const w of words) {
    const last = phrases[phrases.length - 1];
    const prev = last?.words[last.words.length - 1];
    const latinBreak = last && !w.cjk && !prev.cjk && (/[,.;:!?，。；：！？]$/u.test(line.chars.slice(prev.start, prev.end).join('').trim()) || last.words.length >= 3);
    if (!last || (w.spaced && (w.cjk || prev.cjk)) || latinBreak) phrases.push({ li, words: [w] });
    else last.words.push(w);
  }
  const result = [];
  for (const p of phrases) {
    const units = [];
    let run = []; // consecutive single characters
    /* One or two loose characters join the next word (把没 + 说完), or the last word at the end; a
     * longer run (a segmenter that gave up: 比 / 鼓 / 点 / 还) is cut into pairs, the last of three. */
    const flush = (next) => {
      if (!run.length) return next;
      const loose = run;
      run = [];
      if (loose.length <= 2) {
        const start = loose[0].start;
        const end = loose[loose.length - 1].end;
        if (next) return { ...next, start, len: next.len + loose.length };
        if (units.length) {
          units[units.length - 1].end = end;
          units[units.length - 1].len += loose.length;
        } else {
          units.push({ ...loose[0], end, len: loose.length });
        }
        return null;
      }
      for (let k = 0; k < loose.length;) {
        const take = loose.length - k === 3 ? 3 : 2;
        units.push({ ...loose[k], end: loose[k + take - 1].end, len: take, loose: true });
        k += take;
      }
      return next;
    };
    for (const word of p.words) {
      const w = { ...word };
      const single = w.cjk && w.len === 1;
      if (single && PARTICLES.has(line.chars[w.start]) && !run.length && units.length) {
        units[units.length - 1].end = w.end;
        units[units.length - 1].len += 1;
        continue;
      }
      if (single) {
        run.push(w);
        continue;
      }
      units.push(flush(w));
    }
    flush(null);
    // A long phrase with no space in it (心跳比鼓点还要急) is cut once, at the word boundary nearest
    // its middle, so a set has more than one row to work with. The cut is soft: no gap opens there
    // when both halves share a row.
    const total = units.reduce((n, u) => n + u.len, 0);
    let cut = -1;
    if (units.length >= 2 && units[0].cjk && total >= 8) {
      let acc = 0;
      let best = Infinity;
      for (let k = 1; k < units.length; k += 1) {
        acc += units[k - 1].len;
        if (acc >= 3 && total - acc >= 3 && Math.abs(acc - total / 2) < best) {
          best = Math.abs(acc - total / 2);
          cut = k;
        }
      }
    }
    if (cut > 0) {
      units[cut] = { ...units[cut], softStart: true };
      result.push({ li: p.li, units: units.slice(0, cut) }, { li: p.li, units: units.slice(cut) });
    } else {
      result.push({ li: p.li, units });
    }
  }
  return result;
};

/* A row of characters at `size`: advances and glyph centers, from a start x. */
const setRow = (chars, start, end, size, font, tracking = 0) => {
  const entries = [];
  let x = 0;
  let width = 0;
  for (let ci = start; ci < end; ci += 1) {
    const char = chars[ci];
    const glyphWidth = measure(font(size), char);
    if (!SPACE.test(char)) {
      entries.push({ char, ci, x: x + glyphWidth / 2 });
      width = x + glyphWidth;
    }
    x += glyphWidth + (SPACE.test(char) ? 0 : tracking * size);
  }
  return { entries, width };
};

/* Wraps phrases into rows no wider than maxWidth (phrases are never split across rows). */
const wrapPhrases = (chars, phrases, size, font, maxWidth, tracking) => {
  const rows = [];
  let row = null;
  for (const phrase of phrases) {
    const candidate = row ? { start: row.start, end: phrase.end } : { start: phrase.start, end: phrase.end };
    const width = setRow(chars, candidate.start, candidate.end, size, font, tracking).width;
    if (row && width > maxWidth && !CLOSING.test(chars[phrase.start])) {
      rows.push(row);
      row = { start: phrase.start, end: phrase.end };
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);
  return rows;
};

/* Wraps into as few rows as maxWidth allows, then evens them out (no lone word on the last row):
 * the narrowest width that still gives that many rows. */
const wrapBalanced = (chars, phrases, size, font, maxWidth, tracking) => {
  let rows = wrapPhrases(chars, phrases, size, font, maxWidth, tracking);
  if (rows.length < 2) return rows;
  let lo = maxWidth * 0.45;
  let hi = maxWidth;
  for (let k = 0; k < 6; k += 1) {
    const mid = (lo + hi) / 2;
    const tried = wrapPhrases(chars, phrases, size, font, mid, tracking);
    if (tried.length > rows.length) lo = mid;
    else {
      hi = mid;
      rows = tried;
    }
  }
  return rows;
};

/**
 * @param {object} input
 * @param {{ chars: string[], segments: object[] }[]} input.lines shot lines (several on a page)
 * @param {string} input.layout layout name
 * @param {object} input.m metrics { W, H, fs }
 * @param {(size:number, weight?:number)=>string} input.font CSS font for a size
 * @param {{ line: number, charIndex: number, length: number } | null} input.keyword
 * @param {number} input.variant 0..1, picks among a layout's arrangements
 * @param {boolean} input.mirror
 * @param {boolean} [input.calm] a sad song: word shots enter without travel
 * @returns {{ glyphs: object[], pieces: object[] }}
 */
const layoutShot = ({ lines, layout, m, font, keyword, variant, mirror, calm = false }) => {
  const { W, H, fs } = m;
  const glyphs = [];
  const pieces = [];
  const side = mirror ? -1 : 1;

  /* Adds a row of characters as one piece, anchored by `align` at (x, y). */
  const addPiece = (lineIndex, start, end, { x, y, size, align = 'center', rotation = 0, role = 'support', tracking = 0 }) => {
    const { chars } = lines[lineIndex];
    const row = setRow(chars, start, end, size, font, tracking);
    const left = align === 'center' ? -row.width / 2 : align === 'right' ? -row.width : 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const piece = { index: pieces.length, x: x + (left + row.width / 2) * cos, y: y + (left + row.width / 2) * sin, w: row.width, h: size * 1.25, rotation, size, role, line: lineIndex, glyphs: [] };
    for (const entry of row.entries) {
      const lx = left + entry.x;
      piece.glyphs.push(glyphs.length);
      glyphs.push({ char: entry.char, ci: entry.ci, line: lineIndex, x: x + lx * cos, y: y + lx * sin, size, rotation, role, piece: piece.index });
    }
    pieces.push(piece);
    return piece;
  };

  const main = 0;

  /*
   * Word shots, after Folia's 商籁, set the way the lines read: each line is cut into phrases (a
   * space ends one, as Chinese lyrics mark them; in Latin, punctuation or every third word), and a
   * phrase is never broken across rows. One unit of one phrase, the main word, is set two to five
   * times the rest, in place in its phrase, so the sentence still reads straight through. The kinds
   * differ in how the rows sit: centred (orbit, impact), flush left and stepped (column), one row
   * per sung line (tableau), one row for all (ribbon), phrases around the main one (scatter).
   */
  const arrangeWords = (kind, calm) => {
    const seed = Math.round(variant * 1e5);
    const units = [];
    const phrases = [];
    lines.forEach((line, li) => {
      for (const p of readingPhrases(line, li)) {
        for (const u of p.units) u.phrase = phrases.length;
        phrases.push(p);
        units.push(...p.units);
      }
    });
    if (!units.length) return false;

    // The keyword is one unit even where segmentation cut it (向光奔跑 → 向 / 光 / 奔跑).
    if (keyword) {
      const inside = units.map((u, i) => (u.li === keyword.line && u.end > keyword.charIndex && u.start < keyword.charIndex + keyword.length ? i : -1)).filter((i) => i >= 0);
      if (inside.length > 1 && inside.every((i) => units[i].phrase === units[inside[0]].phrase)) {
        const first = units[inside[0]];
        const merged = { ...first, end: units[inside[inside.length - 1]].end, len: inside.reduce((n, i) => n + units[i].len, 0) };
        const p = phrases[first.phrase];
        p.units.splice(p.units.indexOf(p.units.find((u) => u.start === first.start)), inside.length, merged);
        units.splice(inside[0], inside.length, merged);
      }
    }
    let hero = keyword ? units.findIndex((u) => u.li === keyword.line && keyword.charIndex >= u.start && keyword.charIndex < u.end) : -1;
    if (hero < 0) {
      // A unit that can be set huge: two to four characters (three to nine letters), a whole short
      // phrase best, not one led by a particle; the longest such, nearest the middle.
      const mid = (units.length - 1) / 2;
      const fits = (u) => (u.cjk ? u.len >= 2 && u.len <= 4 : u.len >= 3 && u.len <= 9);
      const whole = (u) => phrases[u.phrase].units.length === 1;
      const particle = (u) => u.cjk && FUNCTION_CHARS.has(lines[u.li].chars[u.start]);
      // Nor one ending in 的 (你的, 我的): a possessive is no headline either.
      const possessive = (u) => u.cjk && u.len <= 3 && lines[u.li].chars[u.end - 1] === '的';
      const score = (u, i) => (fits(u) ? 100 : 0) + (whole(u) ? 12 : 0) - (particle(u) ? 60 : 0) - (possessive(u) ? 50 : 0) - (u.loose ? 30 : 0) + u.len - Math.abs(i - mid) * 0.01;
      hero = 0;
      units.forEach((u, i) => {
        if (score(u, i) > score(units[hero], hero)) hero = i;
      });
      // A whole short Chinese phrase (雨停以后, 说成明天) is the most natural thing to set large: it
      // is chosen over a word inside a phrase, so no phrase is cut where segmentation went wrong.
      const lengthOf = (p) => p.units.reduce((n, u) => n + u.len, 0);
      const short = phrases.filter((p) => p.units.length > 1 && p.units[0].cjk && !p.units.some((u) => u.loose) && lengthOf(p) >= 2 && lengthOf(p) <= 5);
      if (short.length && !whole(units[hero])) {
        const p = short.reduce((best, q) => (lengthOf(q) > lengthOf(best) ? q : best));
        const first = p.units[0];
        const merged = { ...first, end: p.units[p.units.length - 1].end, len: lengthOf(p) };
        hero = units.indexOf(first);
        units.splice(hero, p.units.length, merged);
        p.units = [merged];
      }
    }
    const h0 = units[hero];
    const [heroScale, otherScale, kindScale] = WORD_SCALES[kind];
    const userScale = fs / clamp(Math.min(W, H) * 0.066, 18, 124);
    // The base size, as 商籁 sizes it from the word count, but small enough for the main word to
    // keep its full scale within the frame (the hierarchy is the point); never below legibility.
    const heroRun = setRow(lines[h0.li].chars, h0.start, h0.end, 100, font, 0.02).width;
    const heroBase = (W * 0.62 * 100) / Math.max(1, heroRun * heroScale);
    const base = Math.max(fs * 0.42, Math.min(clamp((W / Math.max(7, units.length * 2.15)) * kindScale, 24, 112) * userScale, heroBase));
    const stack = base * 0.3;

    /* Sets a unit, shrunk if it alone would not fit (the main word may take most of the width). */
    const measure = (u, scale) => {
      u.size = base * scale;
      const size = () => {
        [u.w, u.h] = [setRow(lines[u.li].chars, u.start, u.end, u.size, font, 0.02).width, u.size * 1.2];
      };
      size();
      const k = Math.min(1, (W * (u === h0 ? 0.62 : 0.8)) / u.w, (H * 0.5) / u.h);
      if (k < 1) {
        u.size *= k;
        size();
      }
    };
    units.forEach((u) => measure(u, u === h0 ? heroScale : otherScale));
    /* The space before a unit in a row: a word space inside a phrase (none in Chinese), wider between phrases. */
    const gapBefore = (prev, u) => {
      const size = Math.min(prev.size, u.size);
      if (prev.phrase !== u.phrase && !u.softStart) return size * 0.55;
      return u.cjk && prev.cjk ? size * 0.04 : size * 0.28;
    };
    const widthOf = (row) => row.reduce((sum, u, i) => sum + u.w + (i ? gapBefore(row[i - 1], u) : 0), 0);
    const heightOf = (row) => Math.max(0, ...row.map((u) => u.h));
    /* Phrases (lists of units) packed into rows no wider than `limit`, never splitting a phrase. */
    const pack = (list, limit) => {
      const rows = [];
      for (const p of list) {
        const row = rows[rows.length - 1];
        if (row && widthOf([...row, ...p.units]) <= limit) row.push(...p.units);
        else rows.push([...p.units]);
      }
      return rows;
    };
    const heroPhrase = phrases[h0.phrase];
    const limit = W * (kind === 'tableau' ? 0.7 : 0.6);
    const linesBefore = phrases.filter((p) => p.li < h0.li);
    const linesAfter = phrases.filter((p) => p.li > h0.li);
    const sameBefore = phrases.filter((p) => p.li === h0.li && phrases.indexOf(p) < h0.phrase);
    const sameAfter = phrases.filter((p) => p.li === h0.li && phrases.indexOf(p) > h0.phrase);
    const enter = (u, x, y) => {
      u.enterX = calm ? 0 : x;
      u.enterY = calm ? 0 : y;
    };
    /* Lays a row from x with its units' feet on one line (y is the row's centre). */
    const lay = (row, x, y, from) => {
      const foot = y + heightOf(row) / 2;
      row.forEach((u, i) => {
        if (i) x += gapBefore(row[i - 1], u);
        [u.x, u.y] = [x + u.w / 2, foot - u.h / 2];
        x += u.w;
        enter(u, u === h0 ? 0 : from[0], u === h0 ? base * 0.6 : from[1]);
      });
    };
    /* Stacks rows top to bottom; `x0` gives each row's left edge from its index and width. */
    const stackRows = (rows, x0, from = (k, heroAt) => [0, k < heroAt ? -30 : 30]) => {
      const heroAt = rows.findIndex((row) => row.includes(h0));
      const total = rows.reduce((sum, row) => sum + heightOf(row), 0) + stack * (rows.length - 1);
      let y = -total / 2;
      rows.forEach((row, k) => {
        lay(row, x0(k, widthOf(row), heroAt), y + heightOf(row) / 2, from(k, heroAt));
        y += heightOf(row) + stack;
      });
    };
    const centreRows = () => [
      ...pack(linesBefore, limit),
      ...pack(sameBefore, limit),
      [...heroPhrase.units],
      ...pack(sameAfter, limit),
      ...pack(linesAfter, limit),
    ].filter((row) => row.length);

    switch (kind) {
      case 'lyric': {
        // 流光 (after Folia's classic): each sung line one large centred row, every unit a little off
        // the line, tilted and sized its own way; sung units turn further (shots.mjs).
        const tilt = calm ? 0.35 : 1;
        units.forEach((u, i) => {
          if (u !== h0) measure(u, otherScale * (0.88 + 0.3 * hash01(seed, i, 51)));
          u.rot = (hash01(seed, i, 52) - 0.5) * 0.16 * tilt;
          u.lift = (hash01(seed, i, 53) - 0.5) * 0.3 * tilt;
        });
        const rows = [];
        for (const li of [...new Set(phrases.map((p) => p.li))]) rows.push(...pack(phrases.filter((p) => p.li === li), W * 0.82));
        stackRows(rows, (k, w) => -w / 2, () => [0, 24]);
        for (const u of units) u.y += u.lift * u.size;
        break;
      }
      case 'cloud': {
        // 云阶 (after Folia's partita): each phrase a block of its own, stepping down in alternate
        // offsets like a stair in cloud, each a little tilted; a hair line beside each (shots.mjs).
        const rows = phrases.map((p) => [...p.units]);
        const offsets = rows.map((_, k) => (k % 2 === 0 ? -1 : 1) * W * (0.05 + 0.1 * hash01(seed, k, 61)));
        stackRows(rows, (k, w) => -w / 2 + offsets[k], (k) => [(k % 2 === 0 ? -40 : 40), 0]);
        rows.forEach((row, k) => {
          for (const u of row) u.rot = (hash01(seed, k, 62) - 0.5) * (calm ? 0.03 : 0.1);
        });
        break;
      }
      case 'shards': {
        // 心象 (after Folia's cadenza): every character (every word, in Latin) a fragment of its own,
        // scattered across the frame along a wandering path that still reads left to right; the
        // main word's characters larger. They swim, turn and drift in shots.mjs.
        const fragments = [];
        for (const u of units) {
          if (u.cjk) {
            for (let ci = u.start; ci < u.end; ci += 1) {
              if (SPACE.test(lines[u.li].chars[ci])) continue;
              fragments.push({ ...u, start: ci, end: ci + 1, len: 1, hero: u === h0 });
            }
          } else {
            fragments.push({ ...u, hero: u === h0 });
          }
        }
        const n = fragments.length;
        const bands = n > 14 ? 2 : 1;
        const perBand = Math.ceil(n / bands);
        const phase = hash01(seed, 71) * Math.PI * 2;
        fragments.forEach((f, i) => {
          measure(f, (f.hero ? heroScale * 0.62 : otherScale) * (0.85 + 0.45 * hash01(seed, i, 72)));
          f.rot = (hash01(seed, i, 75) - 0.5) * 0.4;
          f.enterX = 0;
          f.enterY = 0;
        });
        // Each band laid left to right by the fragments' own widths with a loose gap, so none overlap
        // across; the path then wanders up and down.
        for (let band = 0; band < bands; band += 1) {
          const row = fragments.slice(band * perBand, (band + 1) * perBand);
          let x = 0;
          row.forEach((f, j) => {
            if (j) x += row[j - 1].w / 2 + f.w / 2 + base * (0.12 + 0.3 * hash01(seed, band * perBand + j, 73));
            f.x = x;
          });
          const bandY = bands === 1 ? 0 : (band === 0 ? -1 : 1) * H * 0.2;
          row.forEach((f, j) => {
            const along = row.length > 1 ? j / (row.length - 1) : 0.5;
            f.x -= x / 2;
            f.y = bandY + Math.sin(along * Math.PI * 2 + phase) * H * (bands === 1 ? 0.14 : 0.07) + (hash01(seed, band * perBand + j, 74) - 0.5) * H * 0.05;
          });
        }
        units.splice(0, units.length, ...fragments);
        break;
      }
      case 'stairs': {
        // A staircase: each row steps further across as it goes down, the main word's row larger.
        const rows = centreRows();
        const step = base * (1.2 + 0.6 * hash01(seed, 9));
        const down = hash01(seed, 31) < 0.5 ? 1 : -1;
        const widest = Math.max(...rows.map(widthOf));
        stackRows(rows, (k, w) => (down > 0 ? -widest / 2 + k * step : widest / 2 - w - k * step), () => [-down * 30, 0]);
        break;
      }
      case 'split': {
        // Corner to corner: what comes before the main word flush left at the top, the main word
        // large in the middle, what follows flush right at the bottom.
        const top = [...pack(linesBefore, limit), ...pack(sameBefore, limit)].filter((row) => row.length);
        const bottom = [...pack(sameAfter, limit), ...pack(linesAfter, limit)].filter((row) => row.length);
        const rows = [...top, [...heroPhrase.units], ...bottom];
        const widest = Math.max(...rows.map(widthOf), W * 0.56);
        stackRows(rows, (k, w) => (k < top.length ? -widest / 2 : k > top.length ? widest / 2 - w : -w / 2), (k) => [k < top.length ? -40 : k > top.length ? 40 : 0, 0]);
        break;
      }
      case 'drop': {
        // A drop head: the main word large to one side, what follows it as short rows beside it,
        // what comes before it in a row above, flush with it.
        const heroRow = [...heroPhrase.units];
        const beside = [...pack(sameAfter, W * 0.32), ...pack(linesAfter, W * 0.32)].filter((row) => row.length);
        const above = [...pack(linesBefore, W * 0.7), ...pack(sameBefore, W * 0.7)].filter((row) => row.length);
        const right = hash01(seed, 31) < 0.5;
        const hw = widthOf(heroRow);
        const hx = right ? W * 0.12 - hw / 2 : -W * 0.12 - hw / 2;
        lay(heroRow, hx, 0, [0, 0]);
        const sideH = beside.reduce((sum, row) => sum + heightOf(row) + stack, -stack);
        let y = -sideH / 2;
        for (const row of beside) {
          const w = widthOf(row);
          lay(row, right ? hx - base * 0.8 - w : hx + hw + base * 0.8, y + heightOf(row) / 2, [right ? -30 : 30, 0]);
          y += heightOf(row) + stack;
        }
        y = -heightOf(heroRow) / 2 - stack;
        for (let k = above.length - 1; k >= 0; k -= 1) {
          const row = above[k];
          lay(row, right ? hx + hw - widthOf(row) : hx, y - heightOf(row) / 2, [0, -30]);
          y -= heightOf(row) + stack;
        }
        break;
      }
      case 'rhythm': {
        // A headline rhythm: every phrase its own row, large and small in turn, left and right in turn.
        phrases.forEach((p, k) => {
          if (p !== heroPhrase && k % 2 === 1) for (const u of p.units) measure(u, otherScale * 1.6);
        });
        const rows = phrases.map((p) => [...p.units]);
        const widest = Math.max(...rows.map(widthOf));
        const lead = hash01(seed, 31) < 0.5 ? 1 : -1;
        stackRows(rows, (k, w) => ((k % 2 === 0) === lead > 0 ? -widest / 2 : widest / 2 - w), (k) => [((k % 2 === 0) === lead > 0 ? -30 : 30), 0]);
        break;
      }
      case 'ribbon':
        // Everything in one row, the main word large in its place.
        stackRows([units], (k, w) => -w / 2, () => [-40, 0]);
        break;
      case 'tableau': {
        // A short poem: each sung line its own row (wrapped only between phrases), flush left.
        const rows = [];
        for (const li of [...new Set(phrases.map((p) => p.li))]) rows.push(...pack(phrases.filter((p) => p.li === li), limit));
        const widest = Math.max(...rows.map(widthOf));
        stackRows(rows, () => -widest / 2, () => [0, 0]);
        break;
      }
      case 'column': {
        // Flush left and stepped, like an editorial page: the rows before the main one step in,
        // the ones after step out again.
        const rows = centreRows();
        const step = base * (0.8 + 0.6 * hash01(seed, 7));
        const widest = Math.max(...rows.map(widthOf));
        const flushLeft = hash01(seed, 31) < 0.5;
        stackRows(rows, (k, w, heroAt) => (flushLeft ? -widest / 2 + Math.abs(k - heroAt) * step : widest / 2 - w - Math.abs(k - heroAt) * step), (k, heroAt) => [k < heroAt ? 30 : -30, 0]);
        break;
      }
      case 'scatter': {
        // The other phrases find places around the main one's row, in the order they are sung,
        // starting at its upper left, none overlapping.
        const heroRow = [...heroPhrase.units];
        lay(heroRow, -widthOf(heroRow) / 2, 0, [0, 0]);
        const taken = [{ l: -widthOf(heroRow) / 2, r: widthOf(heroRow) / 2, t: -heightOf(heroRow) / 2, b: heightOf(heroRow) / 2 }];
        const clear = (a, c) => Math.max(a.l - c.r, c.l - a.r, a.t - c.b, c.t - a.b) >= base * 0.25;
        let angle = Math.PI * 1.15 + hash01(seed, 41) * 0.4;
        phrases.filter((p) => p !== heroPhrase).forEach((p, k) => {
          const row = [...p.units];
          const w = widthOf(row);
          const h = heightOf(row);
          let radius = Math.hypot(widthOf(heroRow), heightOf(heroRow)) / 2 + stack + base * (0.1 + ((k * 0.29) % 0.6));
          let at = null;
          for (let tries = 0; tries < 12 && !at; tries += 1) {
            for (let step = 0; step < 90 && !at; step += 1) {
              const cx = Math.cos(angle) * radius;
              const cy = Math.sin(angle) * radius * 0.7;
              const box = { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
              if (taken.every((t) => clear(t, box))) {
                taken.push(box);
                at = [cx, cy];
              } else {
                angle += 0.07;
              }
            }
            if (!at) radius += base * 0.35;
          }
          const [cx, cy] = at ?? [0, radius];
          lay(row, cx - w / 2, cy, [Math.cos(angle) * 60, Math.sin(angle) * 60]);
          angle += 0.6;
        });
        break;
      }
      default:
        // orbit / impact: rows centred, in reading order, the main word's row in the middle.
        stackRows(centreRows(), (k, w) => -w / 2);
        break;
    }

    // Fit the whole arrangement into the frame, centred.
    const left = Math.min(...units.map((u) => u.x - u.w / 2));
    const right = Math.max(...units.map((u) => u.x + u.w / 2));
    const top = Math.min(...units.map((u) => u.y - u.h / 2));
    const bottom = Math.max(...units.map((u) => u.y + u.h / 2));
    const k = Math.min(1, (W * 0.86) / Math.max(1, right - left), (H * 0.8) / Math.max(1, bottom - top));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    units.forEach((u, i) => {
      const piece = addPiece(u.li, u.start, u.end, { x: (u.x - cx) * k, y: (u.y - cy) * k, size: u.size * k, role: u === h0 || u.hero ? 'hero' : 'support', align: 'center', rotation: u.rot ?? 0, tracking: 0.02 });
      piece.enterX = (u.enterX ?? 0) * k;
      piece.enterY = (u.enterY ?? 0) * k;
      // The order a piece is set in, for the motions of the classic, partita and cadenza kinds.
      piece.order = i;
    });
    return true;
  };
  const heroOf = (lineIndex, phrases) => {
    if (keyword && keyword.line === lineIndex) {
      const at = phrases.findIndex((p) => keyword.charIndex >= p.start && keyword.charIndex < p.end);
      if (at >= 0) return at;
    }
    // Otherwise the longest phrase, ties to the first.
    let best = 0;
    phrases.forEach((p, i) => {
      if (p.end - p.start > phrases[best].end - phrases[best].start) best = i;
    });
    return best;
  };

  /* Plain wrapped text, every line of the shot one after another. */
  const flowing = ({ size, align, x, y, maxWidth, tracking = 0, lineGap = 1.36 }) => {
    const blocks = lines.map((line, li) => ({ li, rows: wrapBalanced(line.chars, phrasesOf(line.chars, line.segments, 1), size, font, maxWidth, tracking) }));
    const total = blocks.reduce((n, b) => n + b.rows.length, 0);
    let row = 0;
    for (const block of blocks) {
      for (const r of block.rows) {
        const ry = y + (row - (total - 1) / 2) * size * lineGap;
        addPiece(block.li, r.start, r.end, { x, y: ry, size, align, tracking, role: 'support' });
        row += 1;
      }
    }
  };

  /* Fits a set of pieces into a box by scaling sizes (used by poster layouts before placing). */
  const fitScale = (items, maxWidth, maxHeight) => {
    const widest = Math.max(...items.map((it) => setRow(lines[it.li].chars, it.start, it.end, it.size, font, it.tracking ?? 0).width));
    const height = items.reduce((sum, it) => sum + it.size * 1.08, 0);
    return Math.min(1, maxWidth / Math.max(1, widest), maxHeight / Math.max(1, height));
  };

  const posterItems = (sizeHero, sizeOther) => {
    const li = Math.max(0, main);
    const { chars, segments } = lines[li];
    const phrases = phrasesOf(chars, segments, 4);
    const hero = heroOf(li, phrases);
    return phrases.map((p, i) => ({
      li,
      start: p.start,
      end: p.end,
      role: i === hero ? 'hero' : 'support',
      size: fs * (i === hero ? sizeHero : sizeOther * (0.82 + 0.3 * hash01(Math.round(variant * 1e4), i, 3))),
    }));
  };

  if (WORD_KINDS.includes(layout) && arrangeWords(layout, calm)) return { glyphs, pieces };

  switch (layout) {
    case 'type': {
      // After Folia's 凝彩: the line's words set in rows, one long word large and the rest small,
      // each row its own width, nudged and tilted a little, the whole fitted into the frame.
      const seed = Math.round(variant * 1e5);
      const { chars } = lines[0];
      const words = readingPhrases(lines[0], 0).flatMap((p, phrase) => p.units.map((u) => ({ ...u, phrase })));
      if (!words.length) {
        flowing({ size: fs * 1.3, align: 'center', x: 0, y: 0, maxWidth: W * 0.8 });
        break;
      }
      const lengths = words.map((w) => w.len);
      const longest = Math.max(...lengths);
      const inKeyword = keyword ? words.findIndex((w) => keyword.charIndex >= w.start && keyword.charIndex < w.end) : -1;
      const longOnes = words.map((_, i) => i).filter((i) => lengths[i] >= Math.max(2, longest - 1));
      const hero = inKeyword >= 0 ? inKeyword : longOnes.length ? longOnes[Math.floor(hash01(seed, 1) * longOnes.length) % longOnes.length] : 0;
      // The main word large; the others sized by phrase, so a phrase keeps one size.
      const scales = words.map((w, i) => (i === hero ? 1.4 + 0.22 * hash01(seed, i, 2) : 0.72 + 0.14 * hash01(seed, w.phrase, 3)));
      const align = ['center', 'left', 'right'][Math.floor(hash01(seed, 4) * 3)];
      const regionW = W * 0.8;
      const regionH = H * 0.66;
      let base = fs * 1.7;
      let rows = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        rows = [];
        let row = null;
        words.forEach((w, i) => {
          const size = base * scales[i];
          const width = setRow(chars, w.start, w.end, size, font, 0.01).width;
          const prev = words[i - 1];
          const newPhrase = !prev || (prev.phrase !== w.phrase && !w.softStart);
          const gap = newPhrase ? base * 0.3 : w.cjk && prev.cjk ? base * 0.035 : base * 0.26;
          const limit = regionW * (0.72 + 0.28 * hash01(seed, rows.length, 5));
          // A row breaks only between phrases; a long phrase is shrunk to fit instead.
          if (row && newPhrase && row.width + gap + width > limit) {
            rows.push(row);
            row = null;
          }
          if (!row) row = { items: [], width: 0, height: 0 };
          row.width += (row.items.length ? gap : 0) + width;
          row.items.push({ i, w, size, width, gap: row.items.length ? gap : 0 });
          row.height = Math.max(row.height, size * 1.08);
        });
        if (row) rows.push(row);
        const total = rows.reduce((h, r) => h + r.height, 0);
        const widest = Math.max(...rows.map((r) => r.width));
        const k = Math.min(1, regionH / total, regionW / widest);
        if (k > 0.999) break;
        base *= k;
      }
      const tilt = (hash01(seed, 6) - 0.5) * 0.05;
      let y = -rows.reduce((h, r) => h + r.height, 0) / 2;
      rows.forEach((row, r) => {
        const rowY = y + row.height / 2;
        y += row.height;
        const nudge = (hash01(seed, r, 7) - 0.5) * W * 0.05;
        const left = align === 'center' ? -row.width / 2 + nudge : align === 'left' ? -regionW / 2 + Math.abs(nudge) * 0.6 : regionW / 2 - row.width - Math.abs(nudge) * 0.6;
        const rowTilt = tilt + (hash01(seed, r, 8) - 0.5) * 0.05;
        const cx = left + row.width / 2;
        let cursor = left;
        for (const item of row.items) {
          cursor += item.gap;
          // Each word sits on the row's tilted line, a little off it.
          const dx = cursor - cx;
          const lift = (hash01(seed, item.i, 9) - 0.5) * base * 0.09;
          addPiece(0, item.w.start, item.w.end, {
            x: cx + dx * Math.cos(rowTilt),
            y: rowY + dx * Math.sin(rowTilt) + lift,
            size: item.size,
            align: 'left',
            rotation: rowTilt + (hash01(seed, item.i, 10) - 0.5) * 0.06,
            role: item.i === hero ? 'hero' : 'support',
            tracking: 0.01,
          });
          cursor += item.width;
        }
      });
      break;
    }
    case 'centerBig':
      flowing({ size: fs * 1.42, align: 'center', x: 0, y: -H * 0.02, maxWidth: W * 0.84, tracking: 0.02, lineGap: 1.2 });
      break;
    case 'stack': {
      const items = posterItems(1.95, 1);
      const k = fitScale(items, W * 0.8, H * 0.64);
      const pattern = variant < 0.34 ? 'stairs' : variant < 0.67 ? 'alternate' : 'center';
      let y = -items.reduce((s, it) => s + it.size * k * 1.08, 0) / 2;
      items.forEach((it, i) => {
        const size = it.size * k;
        y += size * 0.54;
        let x = 0;
        let align = 'center';
        if (pattern === 'stairs') {
          align = 'left';
          x = side * (-W * 0.3 + i * W * 0.07);
          if (side < 0) align = 'right';
        } else if (pattern === 'alternate') {
          align = i % 2 === 0 ? 'left' : 'right';
          x = (i % 2 === 0 ? -1 : 1) * W * 0.3 * side;
          if (side < 0) align = align === 'left' ? 'right' : 'left';
        }
        addPiece(it.li, it.start, it.end, { x, y, size, align, role: it.role, rotation: 0 });
        y += size * 0.54;
      });
      break;
    }
    case 'split': {
      const li = Math.max(0, main);
      const { chars, segments } = lines[li];
      let phrases = phrasesOf(chars, segments, 2);
      if (phrases.length > 2) phrases = [{ start: phrases[0].start, end: phrases[Math.ceil(phrases.length / 2) - 1].end }, { start: phrases[Math.ceil(phrases.length / 2)].start, end: phrases[phrases.length - 1].end }];
      const size = fs * 1.2;
      if (phrases.length === 1) {
        addPiece(li, phrases[0].start, phrases[0].end, { x: 0, y: 0, size, role: 'hero' });
      } else {
        addPiece(li, phrases[0].start, phrases[0].end, { x: -side * W * 0.36, y: -H * 0.14, size, align: side > 0 ? 'left' : 'right', role: 'hero' });
        addPiece(li, phrases[1].start, phrases[1].end, { x: side * W * 0.36, y: H * 0.14, size: size * 0.92, align: side > 0 ? 'right' : 'left', role: 'support' });
      }
      break;
    }
    case 'hero': {
      const li = Math.max(0, main);
      const { chars, segments } = lines[li];
      const phrases = phrasesOf(chars, segments, 3);
      const hero = heroOf(li, phrases);
      const heroPhrase = phrases[hero];
      const heroWidth = setRow(chars, heroPhrase.start, heroPhrase.end, 100, font).width;
      const heroSize = clamp((W * 0.78 * 100) / Math.max(1, heroWidth), fs * 1.3, Math.min(fs * 3.2, H * 0.3));
      const heroY = -H * 0.06;
      addPiece(li, heroPhrase.start, heroPhrase.end, { x: 0, y: heroY, size: heroSize, role: 'hero' });
      const rest = phrases.filter((_, i) => i !== hero);
      if (rest.length) {
        const smallSize = fs * 0.62;
        const restY = heroY + heroSize * 0.78 + smallSize * 0.4;
        const before = rest.filter((p) => p.start < heroPhrase.start);
        const after = rest.filter((p) => p.start > heroPhrase.start);
        if (before.length) addPiece(li, before[0].start, before[before.length - 1].end, { x: 0, y: heroY - heroSize * 0.78 - smallSize * 0.2, size: smallSize, role: 'support', tracking: 0.12 });
        if (after.length) addPiece(li, after[0].start, after[after.length - 1].end, { x: 0, y: restY, size: smallSize, role: 'support', tracking: 0.12 });
      }
      break;
    }
    case 'vertical': {
      // A page of columns, first line on the right, all hanging from one top edge like a scroll.
      const perColumn = 12;
      const columns = [];
      lines.forEach((line, li) => {
        const visible = line.chars.map((c, ci) => ({ c, ci })).filter(({ c }) => !SPACE.test(c));
        for (let col = 0; col * perColumn < visible.length; col += 1) columns.push({ li, slice: visible.slice(col * perColumn, (col + 1) * perColumn) });
      });
      const pitch = 1.85;
      const tallest = Math.max(1, ...columns.map((c) => c.slice.length));
      const size = Math.min(fs * 1.3, (W * 0.66) / Math.max(1, (columns.length - 1) * pitch + 1), (H * 0.78) / (tallest * 1.08));
      const top = (-tallest * size * 1.08) / 2;
      let columnX = ((columns.length - 1) * size * pitch) / 2 - side * W * 0.06;
      for (const { li, slice } of columns) {
        const height = slice.length * size * 1.08;
        const piece = { index: pieces.length, x: columnX, y: top + height / 2, w: size, h: height, rotation: 0, size, role: 'support', line: li, glyphs: [] };
        slice.forEach(({ c, ci }, k) => {
          const closing = CLOSING.test(c);
          piece.glyphs.push(glyphs.length);
          glyphs.push({ char: c, ci, line: li, x: columnX + (closing ? size * 0.3 : 0), y: top + (k + 0.5) * size * 1.08 - (closing ? size * 0.3 : 0), size, rotation: WIDE.test(c) ? 0 : Math.PI / 2, role: 'support', piece: piece.index });
        });
        pieces.push(piece);
        columnX -= size * pitch;
      }
      break;
    }
    case 'world': {
      // 浮名 (after Folia's fume): the whole paragraph on one sheet larger than the frame, line after
      // line, each its own size, side and tilt; the camera flies from line to line (shots.mjs).
      const seed = Math.round(variant * 1e5);
      const entries = [];
      let y = 0;
      lines.forEach((line, li) => {
        const big = keyword && keyword.line === li;
        const size = fs * (big ? 2.8 : 1.6 + 0.8 * hash01(seed, li, 3));
        const rows = wrapBalanced(line.chars, phrasesOf(line.chars, line.segments, 1), size, font, W * 0.8, 0.02);
        const x = (li % 2 === 0 ? -1 : 1) * side * W * (0.06 + 0.16 * hash01(seed, li, 4));
        const rotation = (hash01(seed, li, 5) - 0.5) * 0.08;
        rows.forEach((r, k) => entries.push({ li, r, x, y: y + k * size * 1.15, size, rotation }));
        y += rows.length * size * 1.15 + size * 0.7;
      });
      const middle = (y - fs) / 2;
      for (const e of entries) addPiece(e.li, e.r.start, e.r.end, { x: e.x, y: e.y - middle, size: e.size, align: 'center', rotation: e.rotation, role: keyword && keyword.line === e.li ? 'hero' : 'support', tracking: 0.02 });
      break;
    }
    case 'page': {
      // A manuscript stanza: every line of the paragraph down one margin, wrapped lines kept tight.
      const right = mirror;
      const align = right ? 'right' : 'left';
      const wrapAll = (size) => lines.map((line, li) => ({ li, rows: wrapBalanced(line.chars, phrasesOf(line.chars, line.segments, 1), size, font, W * 0.62, 0.02) }));
      const heightOf = (blocks, size) => blocks.reduce((h, b) => h + (b.rows.length - 1) * size * 1.3, 0) + (blocks.length - 1) * size * 1.85;
      let size = fs * 1.2;
      let blocks = wrapAll(size);
      const room = H * 0.72;
      if (heightOf(blocks, size) > room) {
        size = Math.max(fs * 0.6, (size * room) / heightOf(blocks, size));
        blocks = wrapAll(size);
      }
      // Down one margin, or each line in turn flush left and flush right (a dialogue), or each line
      // stepped further in (a stair down the page).
      const style = pageStyleOf(variant);
      const placeOf = (li) => {
        if (style === 'zigzag') {
          const r = (li % 2 === 1) !== right;
          return { x: (r ? 1 : -1) * W * 0.36, align: r ? 'right' : 'left' };
        }
        if (style === 'steps') {
          const step = Math.min(W * 0.06, (W * 0.24) / Math.max(1, blocks.length - 1));
          return { x: (right ? 1 : -1) * (W * 0.36 - li * step), align };
        }
        return { x: (right ? 1 : -1) * W * 0.31, align };
      };
      let y = -heightOf(blocks, size) / 2;
      blocks.forEach((block) => {
        const { x, align: side } = placeOf(block.li);
        block.rows.forEach((r, k) => {
          addPiece(block.li, r.start, r.end, { x, y, size, align: side, tracking: 0.02 });
          if (k < block.rows.length - 1) y += size * 1.3;
        });
        y += size * 1.85;
      });
      break;
    }
    case 'center':
    default:
      flowing({ size: fs * 1.3, align: 'center', x: 0, y: -H * 0.02, maxWidth: W * 0.8 });
      break;
  }
  return { glyphs, pieces };
};

/** Layouts that set several lines' words around one main word (after 商籁). */
const WORD_KINDS = ['orbit', 'ribbon', 'column', 'scatter', 'impact', 'tableau', 'stairs', 'split', 'drop', 'rhythm', 'lyric', 'cloud', 'shards'];
/** Word kinds whose pieces move on their own (流光, 云阶, 心象): see shots.mjs. */
const MOVING_KINDS = ['lyric', 'cloud', 'shards'];
const LAYOUTS = ['center', 'centerBig', 'stack', 'split', 'hero', 'type', 'page', 'vertical', 'world', ...WORD_KINDS];
/** Layouts that set a whole paragraph in one shot. */
const PAGES = ['page', 'vertical', 'world'];

/* Per word kind: the main word's scale, the others', and the base size's. */
const WORD_SCALES = {
  impact: [5, 1.45, 1.4],
  scatter: [3.2, 1.3, 1],
  column: [3.6, 1.2, 1],
  ribbon: [3.2, 1.4, 1],
  orbit: [3, 1.15, 1],
  tableau: [2.4, 1.1, 0.85],
  stairs: [2.6, 1.3, 1],
  split: [3.4, 1.3, 1],
  drop: [3.6, 1.25, 1],
  rhythm: [2.8, 1.15, 1],
  lyric: [1.7, 1.25, 1.35],
  cloud: [2.2, 1.25, 1.1],
  shards: [2.2, 1.3, 1.2],
};

/** A stanza page's style, from its variant: down a margin, lines in turn left and right, or stepped. */
const pageStyleOf = (variant) => ['margin', 'zigzag', 'steps'][Math.floor(variant * 3) % 3];
return { phrasesOf, layoutShot, WORD_KINDS, MOVING_KINDS, LAYOUTS, PAGES, pageStyleOf };
})();

// ---- src/plan.mjs
const __plan = (() => {
// The planner: turns a lyric analysis and a direction (AI or local) into the
// exact schedule the stage plays: one scene per paragraph with its energy,
// ambient element, accent (sparkler / fireworks) and keyword, plus every
// firework shell and sparkler with its time and place. Pure and deterministic:
// the same song, lyric and direction always give the same plan, so previews,
// playback, seeking and export agree.

const { clamp } = __motion;
const { createRandom, hashString, weightedPick } = __random;
const { WIDE, charTimings } = __lyrics;
const { ACCENTS, WEATHERS, SCENES } = __direction;
const { CALM, TEMPERAMENTS, orderFor, temperamentOf } = __kinetic;
const { EMBLEM_NAMES, QUIET_EMBLEMS } = __emblems;
const { MOVING_KINDS, pageStyleOf } = __layouts;

/** A line shows this long before its first word, so the eye is there when it is sung. */
const LINE_LEAD = 0.45;
/** Ornaments start drawing this long before the paragraph's first line shows. */
const ORNAMENT_LEAD = 0.3;
/** A paragraph's scene stays this long after its last line ends, to fade out. */
const PARAGRAPH_TAIL = 0.9;

const PALETTES = {
  frost: ['#dfe7ef', '#a9bacb', '#7d90a8'],
  mist: ['#e7e3ef', '#b7b4cc', '#8f9ab3'],
  dusk: ['#f3dcc0', '#dcae7a', '#a87a55'],
  blush: ['#f7e0e4', '#e9b9c5', '#fff0dd'],
  dawn: ['#ffe4ad', '#ffb98a', '#f2d8ff'],
  fiesta: ['#ffd166', '#ff7f7f', '#7fd6ff', '#c3a6ff'],
};

const pickPalette = ({ valence, energy, warmth }) => {
  if (valence < 0.4) return warmth < 0.5 ? PALETTES.frost : PALETTES.dusk;
  if (valence < 0.6) return warmth < 0.5 ? PALETTES.mist : PALETTES.blush;
  return energy > 0.6 ? PALETTES.fiesta : PALETTES.dawn;
};

const KIND_ENERGY = { intro: -0.12, verse: 0, lift: 0.08, chorus: 0.2, breath: -0.16, outro: -0.14 };
const TEMPERAMENT_ORDER = ['gentle', 'lyrical', 'dramatic', 'punchy'];

/* Visible characters of a line, as the stage lays them out (raw fullText, not trimmed). */
const charsOf = (item) => Array.from(String(item.line.fullText ?? ''));
const visibleLength = (item) => charsOf(item).filter((char) => !/\s/u.test(char)).length;

/** Where `word` sits in a line: the code-point index of its first character, or -1. */
const indexIn = (item, word) => {
  const chars = charsOf(item);
  const target = Array.from(word);
  const lower = (s) => s.toLowerCase();
  outer: for (let i = 0; i + target.length <= chars.length; i += 1) {
    for (let k = 0; k < target.length; k += 1) if (lower(chars[i + k]) !== lower(target[k])) continue outer;
    return i;
  }
  return -1;
};

const keywordAt = (analysis, paragraph, word) => {
  if (!word) return null;
  for (const index of paragraph.lines) {
    const item = analysis.items[index];
    const at = indexIn(item, word);
    if (at >= 0) {
      const timing = charTimings(item.line)[at] ?? null;
      return { text: word, item: index, charIndex: at, length: Array.from(word).length, start: timing?.start ?? item.start };
    }
  }
  return null;
};

/* The local keyword: the word-like segment that recurs most in the paragraph, longer wins ties. */
const localKeyword = (analysis, paragraph, segment) => {
  const scores = new Map();
  paragraph.lines.forEach((index, order) => {
    for (const seg of segment(analysis.items[index].line)) {
      if (!seg.isWordLike) continue;
      const text = seg.segment.trim();
      const length = Array.from(text).length;
      const wide = WIDE.test(text);
      if (wide ? length < 2 || length > 4 : length < 3) continue;
      const key = text.toLowerCase();
      const prior = scores.get(key) ?? { text, score: 0 };
      prior.score += 2 + length * 0.3 - order * 0.15;
      scores.set(key, prior);
    }
  });
  const best = [...scores.values()].sort((a, b) => b.score - a.score)[0];
  return best ? keywordAt(analysis, paragraph, best.text) : null;
};

const canVertical = (analysis, paragraph) => paragraph.wide >= 0.85
  && paragraph.lines.every((index) => visibleLength(analysis.items[index]) <= 14);

const canCollage = (analysis, paragraph) => paragraph.lines.every((index) => visibleLength(analysis.items[index]) <= 26);

/* Local scene choice: weights by paragraph kind and mood; the previous scene is strongly discouraged. */
const chooseScene = (random, { kind, valence, energy, vertical, collage, previous }) => {
  const sad = 1 - valence;
  const weights = {
    intro: { whisper: 3, center: 1.5, stanza: sad, vertical: vertical ? sad * 1.2 : 0 },
    verse: { center: 1.6, stanza: 1 + sad * 1.8, vertical: vertical ? sad * 1.6 : 0, whisper: 0.35 * (1 - energy), collage: collage && energy > 0.6 && valence > 0.55 ? 0.8 : 0 },
    lift: { center: 1.4, hero: 1.6, collage: collage && energy > 0.6 && valence > 0.55 ? 1.6 : 0 },
    chorus: { hero: 3, collage: collage && energy > 0.55 && valence > 0.5 ? 3 * energy : 0, center: 0.8, stanza: 0.4 * sad },
    breath: { whisper: 3, center: 1 },
    outro: { whisper: 2, center: 1.4, stanza: sad, vertical: vertical ? sad : 0 },
  }[kind] ?? { center: 1 };
  const entries = Object.entries(weights).map(([scene, weight]) => [scene, scene === previous ? weight * 0.12 : weight]);
  return weightedPick(random, entries);
};

/* Read locally, fireworks also need the whole song to be lively: a chorus boost alone is not enough. */
const localAccent = ({ kind, valence, energy, songEnergy }) => {
  const lively = songEnergy >= 0.55;
  if (kind === 'chorus') {
    if (valence > 0.58 && energy > 0.5 && lively) return 'fireworks';
    if (energy > 0.32) return 'sparkler';
  }
  if (kind === 'lift' && valence > 0.62 && energy > 0.62 && lively) return 'fireworks';
  return null;
};

const SHELL_TYPES = {
  bright: ['peony', 'chrysanthemum', 'ring', 'peony'],
  mid: ['chrysanthemum', 'willow', 'peony'],
  dark: ['willow', 'willow', 'chrysanthemum'],
};

/**
 * @param {object} input
 * @param {object} input.analysis from analyzeLyrics
 * @param {object} input.direction from validateDirection or localDirection
 * @param {number} input.seed song seed
 * @param {(line) => {segment: string, isWordLike: boolean}[]} input.segment word segmentation
 * @param {object} [input.song] for the title card
 * @param {{ bpm: number, confidence: number } | null} [input.tempo] what the stage has heard
 */
const buildPlan = ({ analysis, direction, seed, segment, song, tempo = null }) => {
  const mood = { valence: direction.valence, energy: direction.energy, warmth: direction.warmth };
  // Sad and still: no collage, no bounce, whatever the direction says.
  const quietSad = mood.valence < 0.4 && mood.energy < 0.6;
  // A sad song (not a dark driving one): its words fade in and out without bounce, punch or flash.
  const calm = mood.valence < 0.45 && mood.energy < 0.65;
  const palette = direction.palette?.length >= 2 ? direction.palette : pickPalette(mood);
  const base = WEATHERS[direction.weather] ? direction.weather : 'dust';
  const sections = new Map((direction.sections ?? []).map((section) => [section.p, section]));

  const paragraphs = [];
  const shells = [];
  const sparklers = [];
  const firstByRepeat = new Map();
  let previous = null;

  for (const paragraph of analysis.paragraphs) {
    if (paragraph.kind === 'credits') continue;
    const random = createRandom((seed ^ hashString(`p${paragraph.index}`)) >>> 0);
    const ai = sections.get(paragraph.index) ?? (paragraph.repeatOf !== undefined ? sections.get(paragraph.repeatOf) : undefined);
    const energy = clamp(ai?.energy ?? mood.energy + (KIND_ENERGY[paragraph.kind] ?? 0), 0.05, 1);
    const vertical = canVertical(analysis, paragraph);
    const collage = canCollage(analysis, paragraph);

    let scene = ai?.scene ?? null;
    if (!scene && paragraph.repeatOf !== undefined && firstByRepeat.has(paragraph.repeatOf)) scene = firstByRepeat.get(paragraph.repeatOf);
    if (!scene) scene = chooseScene(random, { kind: paragraph.kind, valence: mood.valence, energy, vertical, collage, previous });
    if (scene === 'vertical' && !vertical) scene = 'stanza';
    // A quiet sad song gets no collage even if asked (the M1 evaluation caught the AI doing it once).
    if (scene === 'collage' && (!collage || quietSad)) scene = 'hero';
    if (!SCENES[scene]) scene = 'center';
    firstByRepeat.set(paragraph.index, scene);

    let accent = null;
    let weather = base;
    if (ai?.weather) {
      if (ACCENTS[ai.weather]) accent = ai.weather;
      else weather = ai.weather;
    } else {
      accent = localAccent({ kind: paragraph.kind, valence: mood.valence, energy, songEnergy: mood.energy });
    }
    // Fireworks in a dark song read as a celebration it is not: the sparkler says it quietly.
    if (accent === 'fireworks' && mood.valence < 0.4) accent = 'sparkler';
    const burst = accent ? clamp(ai?.burst ?? (accent === 'fireworks' ? 0.45 + 0.5 * energy : 0.55), 0.15, 1) : 0;

    let keyword = keywordAt(analysis, paragraph, ai?.keyword);
    const wantsKeyword = scene === 'hero' || scene === 'collage' || paragraph.kind === 'chorus';
    if (!keyword && wantsKeyword) keyword = localKeyword(analysis, paragraph, segment);
    if (!keyword && scene === 'hero') {
      const first = analysis.items[paragraph.lines[0]];
      const head = segment(first.line).find((seg) => seg.isWordLike);
      keyword = head ? keywordAt(analysis, paragraph, head.segment.trim()) : null;
      if (!keyword) scene = 'center';
    }

    const firstLine = analysis.items[paragraph.lines[0]];
    const show = Math.max(0, firstLine.start - LINE_LEAD - ORNAMENT_LEAD);
    const end = paragraph.end + PARAGRAPH_TAIL;
    const mirror = random() < 0.5;

    let temperament = TEMPERAMENTS[ai?.motion] ? ai.motion : temperamentOf(energy, mood.valence);
    // A sad song is never bouncy. A dark but driving one (hard rap, angry rock) may be:
    // the 22 real directions so far gave those valence ~0.3 with energy 0.7+.
    if (temperament === 'punchy' && quietSad) temperament = 'dramatic';
    // Read locally, a chorus boost alone must not make a mid-energy love song bounce.
    if (temperament === 'punchy' && !ai?.motion && mood.energy < 0.6) temperament = 'dramatic';

    paragraphs.push({
      index: paragraph.index,
      kind: paragraph.kind,
      ordinal: paragraph.ordinal,
      repeatOf: paragraph.repeatOf,
      wide: paragraph.wide,
      temperament,
      lines: paragraph.lines,
      show,
      end,
      scene,
      weather,
      accent,
      energy,
      burst,
      keyword,
      mirror,
      variant: random(),
    });

    if (accent === 'fireworks') {
      const types = mood.valence > 0.65 ? SHELL_TYPES.bright : mood.valence > 0.45 ? SHELL_TYPES.mid : SHELL_TYPES.dark;
      const add = (t0, rise) => {
        if (shells.some((shell) => Math.abs(shell.t0 - t0) < 0.3)) return;
        shells.push({
          t0,
          x: 0.16 + 0.68 * random(),
          y: 0.14 + 0.24 * random(),
          type: types[Math.floor(random() * types.length)],
          color: Math.floor(random() * 16),
          scale: 0.8 + 0.45 * random() * (0.5 + burst),
          rise,
          seed: Math.floor(random() * 1e9),
        });
      };
      // A volley that lands on the first sung word, then shells on line starts and on the keyword.
      const volley = 1 + Math.round(burst * 2);
      for (let k = 0; k < volley; k += 1) add(firstLine.start + 0.04 + k * 0.34, true);
      paragraph.lines.slice(1).forEach((index) => {
        if (random() < burst * 0.75) add(analysis.items[index].start + 0.02, random() < 0.5);
      });
      if (keyword) add(keyword.start, true);
    }
    if (accent === 'sparkler') {
      // Held at the side away from the text, about mid-height: outside every scene's text and frame.
      sparklers.push({ t0: show + 0.35, t1: end - 0.3, x: mirror ? 0.09 : 0.91, y: 0.5, intensity: burst });
    }
    previous = scene;
  }

  // The chorus is never calmer than the verses: lift it to their average (rounded up).
  const rank = (temperament) => TEMPERAMENT_ORDER.indexOf(temperament);
  const verses = paragraphs.filter((p) => p.kind === 'verse').map((p) => rank(p.temperament));
  if (verses.length) {
    const floor = Math.ceil(verses.reduce((a, b) => a + b, 0) / verses.length);
    for (const p of paragraphs) if (p.kind === 'chorus' && rank(p.temperament) < floor) p.temperament = TEMPERAMENT_ORDER[floor];
  }

  // How many times a paragraph's words came before; the last return of a chorus is the climax.
  const roots = paragraphs.map((p) => p.repeatOf ?? p.index);
  paragraphs.forEach((p, i) => {
    p.nth = roots.slice(0, i).filter((root) => root === roots[i]).length;
    p.climax = p.kind === 'chorus' && p.nth > 0 && !roots.slice(i + 1).includes(roots[i]);
  });

  const bpm = tempo?.bpm && tempo.confidence >= 0.4 ? tempo.bpm : null;
  const shots = buildShots({ analysis, paragraphs, seed, calm, segment, bpm });
  const { wipes } = stageParagraphs({ paragraphs, shots, seed, calm });

  // Title card: the song's name (and its credits) while the intro plays, when there is room.
  const firstSung = analysis.sung[0];
  const credits = analysis.paragraphs.find((p) => p.kind === 'credits')?.lines ?? [];
  const introEnd = firstSung ? firstSung.start - LINE_LEAD - 0.6 : 8;
  const title = introEnd >= 2.6 ? { show: 0.25, end: Math.min(introEnd, 0.25 + 10), credits } : null;

  return {
    source: direction.src,
    summary: direction.summary ?? '',
    mood,
    palette,
    weather: base,
    calm,
    paragraphs,
    shots,
    wipes,
    shells: shells.sort((a, b) => a.t0 - b.t0),
    sparklers,
    title,
  };
};

// ---------------------------------------------------------------- shots

/*
 * Word-shot kinds by passage (after 商籁): a sad song stays with hanging columns, magazine columns,
 * a quiet orbit or a ribbon, its chorus may set one word huge; a lively one adds scattered words
 * and impacts. A single line may also take a one-line layout.
 */
const KINDS = {
  calm: ['tableau', 'stairs', 'drop', 'split', 'orbit', 'column', 'rhythm', 'ribbon'],
  calmChorus: ['orbit', 'impact', 'drop', 'split', 'column'],
  gentle: ['tableau', 'stairs', 'drop', 'orbit', 'split', 'ribbon'],
  lyrical: ['orbit', 'stairs', 'drop', 'split', 'rhythm', 'column', 'ribbon'],
  dramatic: ['impact', 'split', 'drop', 'rhythm', 'column', 'scatter', 'orbit'],
  punchy: ['impact', 'rhythm', 'split', 'scatter', 'ribbon', 'drop', 'orbit'],
};
const SINGLE_LINE = { calm: ['type'], lively: ['type', 'hero'] };
const SCENE_KINDS = { whisper: ['tableau'], hero: ['impact', 'orbit'], collage: ['impact', 'ribbon', 'orbit', 'scatter'] };
/* The background each kind draws: a line-art emblem, a magazine grid, a staff, a few squares. */
const BACKGROUND = { column: 'mesh', ribbon: 'staff', tableau: 'squares', drop: 'mesh', rhythm: 'squares', cloud: 'guides' };
/* One guide around the main word. */
const GUIDES = { calm: ['arches', 'underline', 'frame', 'rule'], lively: ['frame', 'crosshair', 'diamondFrame', 'arches', 'underline'] };
/* How a shot comes in: the first of a paragraph opens bigger than the ones inside it. */
const OPENERS = {
  gentle: ['dissolve', 'zoomIn', 'dissolve', 'leak'],
  lyrical: ['pushIn', 'dissolve', 'zoomIn', 'leak'],
  dramatic: ['flash', 'pushIn', 'zoomIn', 'glitch'],
  punchy: ['flash', 'whipIn', 'zoomIn', 'glitch'],
};
/* Cuts inside a paragraph: 商籁's quick blur most often. */
const CUTS = {
  gentle: ['flick', 'dissolve', 'flick'],
  lyrical: ['flick', 'pushIn', 'whipIn', 'flick', 'drift'],
  dramatic: ['flick', 'whipIn', 'cut', 'zoomIn', 'glitch'],
  punchy: ['flick', 'whipIn', 'cut', 'zoomIn', 'glitch'],
};
/* A sad song's shots: soft cuts, no camera tilt, quiet emblems. */
const CALM_SHOTS = { opener: ['dissolve', 'leak', 'dissolve'], cut: ['blurIn', 'dissolve', 'blurIn'] };
const PAGE_DECOR = { page: ['margin'], vertical: ['grid'], world: ['squares'] };

/*
 * How fast a paragraph is sung: Chinese characters a second (a Latin word counts as 1.8, about its
 * syllables), over the time its lines are actually sung.
 */
const densityOf = (analysis, paragraph) => {
  let amount = 0;
  let time = 0;
  for (const index of paragraph.lines) {
    const item = analysis.items[index];
    const text = String(item.line.fullText ?? '');
    const wide = Array.from(text).filter((c) => WIDE.test(c)).length;
    const latin = text.replace(/[^\s\p{L}'’]/gu, ' ').split(/\s+/).filter((w) => w && !WIDE.test(w)).length;
    amount += wide + latin * 1.8;
    // The time the line is actually sung (its own end), not the time it stays on screen.
    const end = item.end > item.start + 0.3 ? item.end : item.renderEnd;
    time += Math.max(0.6, end - item.start);
  }
  return amount / Math.max(0.6, time);
};

/* When a line has been sung to its end: its own end time, or when the host hides it. */
const sungEndOf = (item) => (item.end > item.start + 0.3 ? Math.min(item.end, item.renderEnd + 1) : item.renderEnd);

/**
 * A paragraph's pace: 'rap' when it is sung very densely, else from the heard tempo (or the density
 * until the tempo is heard): 'fast', 'slow' or 'mid'. A sad song is always taken slowly.
 */
const paceOf = ({ density, bpm, calm }) => {
  if (density >= 5.5) return 'rap';
  if (calm) return 'slow';
  if (bpm ? bpm >= 112 : density >= 4.2) return 'fast';
  if (bpm ? bpm < 92 : density < 3) return 'slow';
  return 'mid';
};
/* The kinds a pace brings in (after Folia's modes): 流光 and 云阶 for slow songs, 心象 for fast ones. */
const PACE_KINDS = { slow: ['lyric', 'cloud', 'lyric', 'cloud'], mid: ['lyric', 'cloud'], fast: ['shards', 'shards'], rap: ['shards'] };
const DIRECTIONS = [[1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

const pickAvoiding = (random, list, avoid = []) => {
  const pool = list.filter((x) => !avoid.includes(x));
  const from = pool.length ? pool : list;
  return from[Math.floor(random() * from.length) % from.length];
};

/* Phrase count without measuring: space-separated runs, or a long run counted as two. */
const phraseCount = (item) => {
  const runs = String(item.line.fullText ?? '').trim().split(/\s+/).filter(Boolean);
  return runs.reduce((n, run) => n + (Array.from(run).length >= 6 ? 2 : 1), 0);
};

const layoutFits = (layout, item, paragraph) => {
  const visible = visibleLength(item);
  // The line itself must be CJK: a mixed line ("Oh yeah …") would turn its Latin sideways.
  if (layout === 'vertical') return paragraph.wide >= 0.85 && item.wide >= 0.85 && visible <= 14;
  if (layout === 'stack' || layout === 'split') return phraseCount(item) >= 2;
  if (layout === 'hero') return visible >= 2;
  if (layout === 'type') return visible >= 4 && visible <= 28;
  return true;
};

/* Whether a paragraph is set as one page (every line stays on it), and which page. */
const pageFor = (paragraph, analysis) => {
  const items = paragraph.lines.map((index) => analysis.items[index]);
  if (items.length < 2 || items.length > 8) return null;
  if (paragraph.scene === 'stanza') return 'page';
  if (paragraph.scene === 'vertical') return items.length <= 7 && items.every((item) => layoutFits('vertical', item, paragraph)) ? 'vertical' : 'page';
  return null;
};

/* Lines grouped into word shots the way 商籁 groups them: up to four lines and six seconds, and here
 * at most a dozen words, so each word can be set large. */
const groupLines = (analysis, paragraph, segment) => {
  const groups = [];
  let group = [];
  let words = 0;
  for (const index of paragraph.lines) {
    const item = analysis.items[index];
    const count = Math.max(1, segment(item.line).filter((seg) => seg.isWordLike).length);
    if (group.length && (group.length >= 4 || item.renderEnd - analysis.items[group[0]].start > 6 || words + count > 12)) {
      groups.push(group);
      group = [];
      words = 0;
    }
    group.push(index);
    words += count;
  }
  if (group.length) groups.push(group);
  return groups;
};

/**
 * Shots. A stanza or a vertical scroll is one page for its whole paragraph. Every other paragraph
 * is cut into word shots of one to four lines (after 商籁): all their words set around one main
 * word, each appearing as it is sung, on a line-art emblem, a grid or a staff, the camera a little
 * close and pushing in slowly. Neighbouring shots never repeat a kind; a returning chorus keeps its
 * motions but is set anew; its last return is set as big as it gets.
 */
const buildShots = ({ analysis, paragraphs, seed, calm, segment, bpm }) => {
  const shots = [];
  const recipesByParagraph = new Map();
  let previous = null;
  let earlier = null;
  let stanzaPaged = false;
  for (const paragraph of paragraphs) {
    const random = createRandom((seed ^ hashString(`s${paragraph.index}`)) >>> 0);
    const temperament = paragraph.temperament;
    const pools = calm ? { ...TEMPERAMENTS[temperament], ...CALM } : TEMPERAMENTS[temperament];
    const openers = calm ? CALM_SHOTS.opener : OPENERS[temperament];
    const cuts = calm ? CALM_SHOTS.cut : CUTS[temperament];
    const source = paragraph.repeatOf !== undefined ? recipesByParagraph.get(paragraph.repeatOf) : null;
    const recipes = [];
    const common = { paragraph: paragraph.index, temperament, calm, energy: paragraph.energy, accentWeather: paragraph.accent, weather: paragraph.weather, climax: paragraph.climax };

    // Only the first stanza of a song is a manuscript page: with every stanza a page, the verses read
    // line after line (the user found that monotonous). Later ones get word shots; a repeat keeps its page.
    const pace = paceOf({ density: densityOf(analysis, paragraph), bpm, calm });
    let page = pageFor(paragraph, analysis);
    // A rapped verse (浮名): the whole paragraph on one sheet, the camera flying line to line.
    if (pace === 'rap' && paragraph.kind !== 'chorus' && paragraph.lines.length >= 2 && paragraph.lines.length <= 12) page = 'world';
    if (page === 'page' && stanzaPaged && !source?.page) page = null;
    if (page === 'page') stanzaPaged = true;
    if (page) {
      const base = source?.page ? source[0] : null;
      const items = paragraph.lines.map((index) => analysis.items[index]);
      const variant = base?.variant ?? random();
      const recipe = {
        variant,
        layout: page,
        enter: base?.enter ?? pickAvoiding(random, pools.enter, [previous?.enter]),
        // Quiet pages are written as they are sung; louder ones set each line as it arrives.
        mode: calm || temperament === 'gentle' || temperament === 'lyrical' ? 'sung' : 'line',
        sing: base?.sing ?? pickAvoiding(random, pools.sing, [previous?.sing]),
        exit: base?.exit ?? pickAvoiding(random, pools.exit, [previous?.exit]),
        camera: page === 'world' ? 'fly' : 'track',
        transIn: pickAvoiding(random, openers),
        order: 'forward',
        decor: [...(page === 'page' && pageStyleOf(variant) !== 'margin' ? [] : PAGE_DECOR[page]), 'emblem'],
        emblem: pickAvoiding(random, calm ? QUIET_EMBLEMS : EMBLEM_NAMES, [previous?.emblem]),
      };
      recipes.push(recipe);
      recipes.page = true;
      recipesByParagraph.set(paragraph.index, recipes);
      const [dirX, dirY] = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
      const kwLine = paragraph.keyword ? paragraph.lines.indexOf(paragraph.keyword.item) : -1;
      const shot = {
        id: `${paragraph.index}:page`,
        ...common,
        item: paragraph.lines[0],
        items: paragraph.lines,
        first: true,
        last: true,
        ...recipe,
        mirror: paragraph.mirror !== Boolean(base),
        dir: { x: dirX, y: dirY },
        keyword: kwLine >= 0 ? { line: kwLine, charIndex: paragraph.keyword.charIndex, length: paragraph.keyword.length } : null,
        show: Math.max(0, items[0].start - pools.lead),
        start: items[0].start,
        lastStart: items[items.length - 1].start,
        renderEnd: items[items.length - 1].renderEnd,
        sungEnd: sungEndOf(items[items.length - 1]),
      };
      shots.push(shot);
      earlier = previous;
      previous = shot;
      continue;
    }

    const groups = groupLines(analysis, paragraph, segment);
    const chorusLike = paragraph.kind === 'chorus' || paragraph.climax;
    const kindPool = SCENE_KINDS[paragraph.scene]
      ?? (calm ? (chorusLike ? KINDS.calmChorus : KINDS.calm) : KINDS[temperament] ?? KINDS.lyrical);
    groups.forEach((group, k) => {
      const items = group.map((index) => analysis.items[index]);
      const base = source && !source.page ? source[k] : null;
      const words = group.reduce((n, index) => n + segment(analysis.items[index].line).filter((seg) => seg.isWordLike).length, 0);
      // The pool for this shot: word kinds, a one-line layout for a single line, the climax's own.
      let pool = paragraph.climax ? ['impact', 'scatter', 'orbit'] : kindPool;
      if (calm) pool = pool.filter((kind) => kind !== 'scatter');
      // A ribbon is one row: only a few words fit it at a size worth having.
      if (words > 7 || items.reduce((n, item) => n + visibleLength(item), 0) > 10) pool = pool.filter((kind) => kind !== 'ribbon');
      if (!paragraph.wide || paragraph.wide < 0.85) pool = pool.filter((kind) => kind !== 'tableau');
      if (group.length === 1 && random() < 0.35) pool = [...pool, ...(calm ? SINGLE_LINE.calm : SINGLE_LINE.lively).filter((name) => layoutFits(name, items[0], paragraph))];
      pool = [...pool, ...PACE_KINDS[pace]];
      if (calm) pool = pool.filter((kind) => kind !== 'shards');
      if (!pool.length) pool = ['orbit'];
      // A returning chorus is set anew: another kind than the first time.
      const layout = pickAvoiding(random, pool, [previous?.layout, earlier?.layout, base?.layout]);
      const enter = base?.enter ?? pickAvoiding(random, pools.enter, [previous?.enter]);
      const emblems = calm ? QUIET_EMBLEMS : EMBLEM_NAMES;
      const guides = calm ? GUIDES.calm : GUIDES.lively;
      const background = BACKGROUND[layout] ?? 'emblem';
      const recipe = {
        layout,
        enter,
        // 流光, 云阶 and 心象 set the whole line out at once and light each unit as it is sung.
        mode: MOVING_KINDS.includes(layout) ? 'line' : 'sung',
        sing: base?.sing ?? pickAvoiding(random, pools.sing, [previous?.sing]),
        exit: base?.exit ?? pickAvoiding(random, pools.exit, [previous?.exit]),
        camera: 'focus',
        transIn: k === 0
          ? (paragraph.climax ? (calm ? 'leak' : temperament === 'gentle' || temperament === 'lyrical' ? 'zoomIn' : 'flash') : pickAvoiding(random, openers))
          : pickAvoiding(random, cuts, [previous?.transIn]),
        order: orderFor(enter, random()),
        decor: [background, pickAvoiding(random, guides, [previous?.decor?.[1]])],
        emblem: pickAvoiding(random, emblems, [previous?.emblem, base?.emblem]),
      };
      recipes.push(recipe);

      const [dirX, dirY] = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
      const kw = paragraph.keyword && group.includes(paragraph.keyword.item)
        ? { line: group.indexOf(paragraph.keyword.item), charIndex: paragraph.keyword.charIndex, length: paragraph.keyword.length }
        : null;
      const shot = {
        id: `${paragraph.index}:${k}`,
        ...common,
        item: group[0],
        items: group,
        first: k === 0,
        last: k === groups.length - 1,
        ...recipe,
        variant: random(),
        mirror: ((k % 2 === 1) !== paragraph.mirror) !== Boolean(base),
        dir: { x: dirX, y: dirY },
        keyword: kw,
        // The camera sits close and leans a little; a sad song's barely moves.
        zoom: calm ? 1.01 + 0.02 * random() : 1.03 + 0.04 * random() + (paragraph.climax ? 0.03 : 0),
        tilt: calm ? 0 : (random() - 0.5) * 0.04,
        // Words already sung stay; only a page's earlier lines step back further.
        pastFade: 0.3,
        show: Math.max(0, items[0].start - pools.lead),
        start: items[0].start,
        lastStart: items[items.length - 1].start,
        renderEnd: items[items.length - 1].renderEnd,
        sungEnd: sungEndOf(items[items.length - 1]),
      };
      shots.push(shot);
      earlier = previous;
      previous = shot;
    });
    recipesByParagraph.set(paragraph.index, recipes);
  }

  // Timing: a shot leaves as the next one arrives (they overlap for the transition), or when the host
  // would hide its line, but never before its last line has been sung to its end (leaving earlier
  // took the end of a line away, or words that had not appeared yet, wherever lines follow closely).
  // The next shot shows at most 0.35 s before that, yet is in place 0.15 s before its own line.
  shots.forEach((shot, i) => {
    const next = shots[i + 1];
    if (next) next.show = Math.max(next.show, Math.min(shot.sungEnd - 0.35, next.start - 0.15), shot.show + 0.25);
    const nextShow = next ? next.show : Infinity;
    const leave = Math.min(shot.renderEnd + 0.15, nextShow + 0.12);
    shot.exitStart = Math.max(shot.show + 0.9, shot.sungEnd, Math.min(leave, shot.lastStart + 30));
    shot.transOut = next && next.show - shot.exitStart < 0.5
      ? ({ whipIn: 'whipOut', pushIn: 'pushOut', zoomIn: 'pushOut', glitch: 'cutOut', flash: 'cutOut', cut: 'cutOut', flick: 'flickOut', blurIn: 'blurOut' }[next.transIn] ?? 'none')
      : 'none';
    shot.nextDir = next?.dir ?? shot.dir;
  });
  return shots;
};

// ---------------------------------------------------------------- paragraph transitions

/* How one paragraph hands over to the next (after 凝彩 and 商籁): a colour band wiping across the
 * frame, a pan of the whole frame, or a blur dissolve. A sad song only blurs or pans, slowly. */
const TRANSITIONS = {
  calm: [['blur', 3], ['pan', 1.2]],
  gentle: [['blur', 2], ['pan', 1]],
  lyrical: [['pan', 1.4], ['blur', 1.1], ['wipe', 0.9]],
  dramatic: [['wipe', 1.5], ['pan', 1.2], ['blur', 0.7]],
  punchy: [['wipe', 1.8], ['pan', 1.2], ['blur', 0.4]],
};
const ANGLES = [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.35, Math.PI - 0.35, -0.35, Math.PI + 0.35];

/** Transitions between paragraphs; returns the wipe bands to draw. */
const stageParagraphs = ({ paragraphs, shots, seed, calm }) => {
  const random = createRandom((seed ^ hashString('staging')) >>> 0);
  const shotsOf = (p) => shots.filter((shot) => shot.paragraph === p.index);
  const wipes = [];
  for (let i = 1; i < paragraphs.length; i += 1) {
    const before = shotsOf(paragraphs[i - 1]);
    const after = shotsOf(paragraphs[i]);
    if (!before.length || !after.length) continue;
    const old = before[before.length - 1];
    const next = after[0];
    // A lively song keeps some of its openers (flash, glitch, zoom) for variety.
    if (!calm && random() < 0.3) continue;
    const kind = weightedPick(random, TRANSITIONS[calm ? 'calm' : paragraphs[i].temperament] ?? TRANSITIONS.lyrical);
    const angle = ANGLES[Math.floor(random() * ANGLES.length)];
    const adjacent = next.show - old.exitStart < 0.6;
    next.angle = angle;
    // A wipe hides the whole frame and a pan carries it off: only once the old line has been sung.
    const done = old.sungEnd <= next.show + 0.05;
    if (kind === 'wipe' && !done) {
      next.transIn = 'blurIn';
      if (adjacent) {
        old.transOut = 'blurOut';
        old.angle = angle;
      }
    } else if (kind === 'wipe') {
      // The band covers the frame at `at`: the old shot goes under it, the new one comes out.
      const at = next.show + 0.2;
      wipes.push({ t: at, angle, tone: i % 4 });
      next.transIn = 'wipeIn';
      next.wipeAt = at;
      if (old.exitStart > at - 0.45) {
        old.exitStart = Math.min(old.exitStart, at);
        old.transOut = 'wipeOut';
        old.wipeAt = at;
      }
    } else {
      next.transIn = kind === 'pan' ? 'panIn' : 'blurIn';
      if (adjacent) {
        old.transOut = kind === 'pan' ? 'panOut' : 'blurOut';
        old.angle = angle;
        // A pan moves both frames as one strip: the old one starts leaving as the new one arrives.
        if (kind === 'pan' && done) old.exitStart = Math.max(old.show + 0.9, next.show);
        else if (kind === 'pan') old.transOut = 'blurOut';
      }
    }
  }
  return { wipes };
};

/** The paragraph on screen (or coming up within `ahead` seconds) at time `t`, or null. */
const paragraphAt = (plan, t, ahead = 0) => {
  let found = null;
  for (const paragraph of plan.paragraphs) {
    if (t >= paragraph.show - ahead && t <= paragraph.end) found = paragraph;
    if (paragraph.show - ahead > t) break;
  }
  return found;
};

/** Plain Intl.Segmenter word split, for hosts or tests without `folium.lyrics.segmentWords`. */
const fallbackSegment = (() => {
  let segmenter = null;
  return (line) => {
    const text = String(line?.fullText ?? '');
    if (typeof Intl?.Segmenter === 'function') {
      segmenter ??= new Intl.Segmenter('zh', { granularity: 'word' });
      return [...segmenter.segment(text)].map((s) => ({ segment: s.segment, index: s.index, isWordLike: Boolean(s.isWordLike) }));
    }
    return text.split(/(\s+)/).map((segment) => ({ segment, index: 0, isWordLike: /\S/.test(segment) }));
  };
})();
return { LINE_LEAD, buildPlan, densityOf, paceOf, paragraphAt, fallbackSegment };
})();

// ---- src/particles.mjs
const __particles = (() => {
// Every particle in 花笺: the ambient elements (dust, rain, snow, petals,
// fireflies, embers, stars), the sparkler (線香花火), firework shells and the
// light that leaves the characters when a line fades.
//
// Nothing here is simulated step by step. Each particle's place is a closed
// formula of the song clock and a per-particle hash, so pausing freezes it,
// seeking jumps to the right picture, and two renders of the same moment
// match. Ambient elements cross-fade through levels; shells and sparklers are
// events with a start time, from the plan (known in advance, so a shell can be
// launched early and burst exactly on the word) or from live onsets.
//
// Two particle containers (behind and in front of the text) share one atlas,
// so all of it is two draw calls.

const { hash01 } = __random;
const { clamp, damp, smoothstep, wrap } = __motion;

const TAU = Math.PI * 2;
const AMBIENTS = ['dust', 'rain', 'snow', 'petals', 'fireflies', 'embers', 'stars'];
const COUNTS = { dust: 64, rain: 150, snow: 110, petals: 40, fireflies: 34, embers: 52, stars: 130 };
const LEVEL_TAU = 1.8;

const SHELLS = {
  peony: { n: 84, radius: 0.2, drag: 3.0, gravity: 0.1, life: 1.75, ghosts: 2, spacing: 0.045, twoTone: true },
  chrysanthemum: { n: 72, radius: 0.22, drag: 2.6, gravity: 0.12, life: 2.1, ghosts: 4, spacing: 0.04 },
  willow: { n: 56, radius: 0.18, drag: 1.5, gravity: 0.36, life: 3.6, ghosts: 7, spacing: 0.065, gold: true },
  ring: { n: 52, radius: 0.17, drag: 2.8, gravity: 0.08, life: 1.6, ghosts: 2, spacing: 0.05, ring: true },
  spark: { n: 26, radius: 0.075, drag: 3.4, gravity: 0.12, life: 0.95, ghosts: 1, spacing: 0.04 },
};
const RISE_SEC = 0.85;

const createLayer = () => {
  const container = new PIXI.ParticleContainer({
    dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true },
  });
  container.blendMode = 'add';
  return { container, pool: [], used: 0 };
};

const createParticles = (atlas) => {
  const back = createLayer();
  const front = createLayer();
  const levels = Object.fromEntries(AMBIENTS.map((name) => [name, 0]));
  const targets = Object.fromEntries(AMBIENTS.map((name) => [name, 0]));
  let plan = null;
  let tints = [0xffffff];
  let warm = 0xffc27a;
  let hot = 0xfff1d6;
  let rainTint = 0xbfd0e6;
  let budget = 1;
  let cap = 2600;
  const runtimeShells = [];
  const glyphBursts = new Map();
  let pulse = 0;

  // Frame-local geometry, set at the top of update().
  let W = 1;
  let H = 1;
  let k = 1;
  let u = 1;

  const put = (layer, texture, x, y, w, h, alpha, tint, rotation = 0) => {
    if (alpha <= 0.004 || layer.used >= cap) return;
    if (x < -w - 40 || x > W + w + 40 || y < -h - 40 || y > H + h + 40) return;
    let particle = layer.pool[layer.used];
    if (!particle) {
      particle = new PIXI.Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
      layer.pool.push(particle);
    }
    particle.texture = texture;
    particle.x = x;
    particle.y = y;
    particle.scaleX = w / texture.frame.width;
    particle.scaleY = h / texture.frame.height;
    particle.rotation = rotation;
    particle.tint = tint;
    particle.alpha = Math.min(1, alpha);
    layer.used += 1;
  };

  const commit = (layer) => {
    const children = layer.container.particleChildren;
    if (children.length === layer.used) return;
    if (children.length < layer.used) {
      for (let i = children.length; i < layer.used; i += 1) children.push(layer.pool[i]);
    } else {
      children.length = layer.used;
    }
    layer.container.update();
  };

  const tintOf = (i) => tints[i % tints.length];

  // ---------------------------------------------------------------- ambient elements

  const countFor = (name, level) => Math.ceil(COUNTS[name] * budget * Math.min(1, level * 1.4));

  const drawDust = (t, level) => {
    const n = countFor('dust', level);
    for (let i = 0; i < n; i += 1) {
      const depth = 0.25 + 0.75 * hash01(i, 1);
      const bokeh = hash01(i, 7) < 0.1;
      const vx = (hash01(i, 3) - 0.5) * 14 * k * depth;
      const vy = -(3 + 9 * depth) * k;
      const x = wrap(hash01(i, 2) * W * 1.2 + t * vx + Math.sin(t * (0.07 + 0.1 * hash01(i, 4)) + hash01(i, 5) * TAU) * 36 * k * depth, W * 1.2) - W * 0.1;
      const y = wrap(hash01(i, 6) * H * 1.2 + t * vy, H * 1.2) - H * 0.1;
      const twinkle = 0.62 + 0.38 * Math.sin(t * (0.4 + 0.9 * hash01(i, 8)) + hash01(i, 4) * TAU);
      const size = bokeh ? (26 + 38 * hash01(i, 9)) * k : (3 + 9 * depth * depth) * k;
      const alpha = level * (bokeh ? 0.05 + 0.06 * hash01(i, 9) : 0.1 + 0.34 * depth) * twinkle * (1 + pulse * 0.6);
      put(back, bokeh ? atlas.ring : atlas.dot, x, y, size, size, alpha, tintOf(i));
    }
  };

  const drawRain = (t, level) => {
    const n = countFor('rain', level);
    const angle = 0.2;
    const slope = Math.tan(angle);
    const travel = H * 1.3;
    for (let i = 0; i < n; i += 1) {
      const depth = 0.3 + 0.7 * hash01(i, 11);
      const speed = H * (1.05 + 0.9 * depth);
      const y = wrap(hash01(i, 12) + (t * speed) / travel, 1) * travel - H * 0.15;
      const x = hash01(i, 13) * (W + H * 0.5) - H * 0.3 + (y + H * 0.15) * slope;
      const length = (34 + 74 * depth) * k;
      const width = (3 + 2.5 * depth) * k;
      put(back, atlas.streak, x, y, width, length, level * (0.07 + 0.22 * depth), rainTint, -angle);
    }
  };

  const drawSnow = (t, level) => {
    const n = countFor('snow', level);
    for (let i = 0; i < n; i += 1) {
      const depth = 0.25 + 0.75 * hash01(i, 21);
      const fall = (16 + 46 * depth) * k;
      const y = wrap(hash01(i, 22) * H * 1.2 + t * fall, H * 1.2) - H * 0.1;
      const sway = Math.sin(t * (0.25 + 0.5 * hash01(i, 24)) + hash01(i, 25) * TAU) * (10 + 26 * depth) * k;
      const x = wrap(hash01(i, 23) * W * 1.1 + sway + t * (hash01(i, 26) - 0.5) * 10 * k, W * 1.1) - W * 0.05;
      const size = (4 + 10 * depth) * k;
      put(back, atlas.dot, x, y, size, size, level * (0.22 + 0.5 * depth), 0xf4f7fb);
    }
  };

  const drawPetals = (t, level) => {
    const n = countFor('petals', level);
    for (let i = 0; i < n; i += 1) {
      const depth = 0.3 + 0.7 * hash01(i, 31);
      const fall = (22 + 40 * depth) * k;
      const drift = (14 + 30 * hash01(i, 37)) * k;
      const y = wrap(hash01(i, 32) * H * 1.25 + t * fall, H * 1.25) - H * 0.12;
      const x = wrap(hash01(i, 33) * W * 1.3 + t * drift + Math.sin(t * (0.6 + 0.8 * hash01(i, 34)) + hash01(i, 35) * TAU) * 24 * k, W * 1.3) - W * 0.15;
      const spin = hash01(i, 36) * TAU + t * (0.5 + 1.1 * hash01(i, 38)) * (hash01(i, 39) < 0.5 ? -1 : 1);
      const flip = 0.25 + 0.75 * Math.abs(Math.cos(t * (0.9 + 1.6 * hash01(i, 40)) + hash01(i, 41) * TAU));
      const size = (9 + 9 * depth) * k;
      put(back, atlas.petal, x, y, size * 1.7, size * flip, level * (0.32 + 0.45 * depth), tintOf(i), spin);
    }
  };

  const drawFireflies = (t, level) => {
    const n = countFor('fireflies', level);
    for (let i = 0; i < n; i += 1) {
      const x = W * (0.06 + 0.88 * hash01(i, 51))
        + Math.sin(t * (0.11 + 0.12 * hash01(i, 52)) + hash01(i, 53) * TAU) * W * 0.05
        + Math.sin(t * (0.43 + 0.3 * hash01(i, 54)) + hash01(i, 55) * TAU) * 14 * k;
      const y = H * (0.22 + 0.7 * hash01(i, 56))
        + Math.cos(t * (0.09 + 0.1 * hash01(i, 57)) + hash01(i, 58) * TAU) * H * 0.05
        + Math.cos(t * (0.37 + 0.2 * hash01(i, 59)) + hash01(i, 53) * 3) * 10 * k;
      const blink = smoothstep(0.15, 0.95, Math.sin(t * (0.55 + 0.8 * hash01(i, 60)) + hash01(i, 61) * TAU) * 0.5 + 0.5);
      const alpha = level * blink * (0.55 + 0.45 * hash01(i, 62));
      const halo = (26 + 20 * hash01(i, 62)) * k;
      put(back, atlas.dot, x, y, halo, halo, alpha * 0.32, warm);
      put(back, atlas.core, x, y, 5 * k, 5 * k, alpha, hot);
    }
  };

  const drawEmbers = (t, level) => {
    const n = countFor('embers', level);
    const travel = H * 1.15;
    for (let i = 0; i < n; i += 1) {
      const depth = 0.3 + 0.7 * hash01(i, 71);
      const rise = (30 + 60 * depth) * k;
      const phase = wrap(hash01(i, 72) + (t * rise) / travel, 1);
      const y = H * 1.05 - phase * travel;
      const x = hash01(i, 73) * W + Math.sin(t * (0.7 + 0.9 * hash01(i, 74)) + hash01(i, 75) * TAU) * (10 + 20 * depth) * k
        + phase * travel * 0.12 * (hash01(i, 76) - 0.35);
      const flicker = 0.55 + 0.45 * Math.sin(t * (7 + 6 * hash01(i, 77)) + hash01(i, 78) * 30);
      const alpha = level * (1 - smoothstep(0.45, 0.95, phase)) * smoothstep(0, 0.06, phase) * flicker * (0.4 + 0.6 * depth);
      const size = (2 + 3 * depth) * k;
      put(back, atlas.dot, x, y, size * 5, size * 5, alpha * 0.28, warm);
      put(back, atlas.core, x, y, size, size, alpha, hot);
    }
  };

  const drawStars = (t, level) => {
    const n = countFor('stars', level);
    for (let i = 0; i < n; i += 1) {
      const x = hash01(i, 81) * W;
      const y = hash01(i, 82) * H * 0.78;
      const twinkle = 0.55 + 0.45 * Math.sin(t * (0.6 + 2.2 * hash01(i, 83)) + hash01(i, 84) * TAU);
      const bright = hash01(i, 85);
      const size = (2.4 + 7 * bright ** 3) * k;
      const alpha = level * (0.15 + 0.7 * hash01(i, 86) ** 2) * twinkle;
      put(back, atlas.dot, x, y, size, size, alpha, 0xf3f1ff);
      if (bright > 0.93) put(back, atlas.flare, x, y, 18 * k, 18 * k, alpha * 0.55, 0xffffff);
    }
    // A shooting star now and then.
    const period = 8.5;
    const cycle = Math.floor(t / period);
    const local = t - cycle * period;
    if (hash01(cycle, 91) < 0.55 && local < 1) {
      const x0 = W * (0.3 + 0.6 * hash01(cycle, 92));
      const y0 = H * (0.05 + 0.25 * hash01(cycle, 93));
      const fade = Math.sin(Math.PI * local);
      for (let j = 0; j < 16; j += 1) {
        const d = local * W * 0.5 - j * 9 * k;
        if (d < 0) break;
        put(back, atlas.core, x0 - d * 0.86, y0 + d * 0.5, (3.4 - j * 0.18) * k, (3.4 - j * 0.18) * k, level * fade * (1 - j / 16), 0xffffff);
      }
    }
  };

  const AMBIENT_DRAW = { dust: drawDust, rain: drawRain, snow: drawSnow, petals: drawPetals, fireflies: drawFireflies, embers: drawEmbers, stars: drawStars };

  // ---------------------------------------------------------------- sparkler (線香花火)

  const drawSparkler = (s, index, t, boost) => {
    const age = t - s.t0;
    const duration = s.t1 - s.t0;
    if (age < 0 || age > duration + 1.4) return;
    const ax = s.x * W;
    const ay = s.y * H;
    const ignite = smoothstep(0, 0.7, age);
    const drop = Math.max(0, age - duration);
    const beadAlpha = 1 - smoothstep(0, 0.9, drop);
    const beadY = ay + 0.5 * 900 * k * drop * drop;
    // The paper twist it hangs from.
    put(front, atlas.streak, ax, ay - 80 * k, 4 * k, 150 * k, 0.22 * ignite * beadAlpha, warm);
    const swell = 1 + 0.12 * Math.sin(t * 23) + 0.25 * boost;
    put(front, atlas.dot, ax, beadY, 46 * k * swell * ignite, 46 * k * swell * ignite, 0.5 * beadAlpha, warm);
    put(front, atlas.core, ax, beadY, 9 * k * ignite, 9 * k * ignite, 0.95 * beadAlpha, hot);

    // Sparks: a fixed cadence, thinned by intensity, so each spark is a function of its index.
    const rate = 90 * budget;
    const maxLife = 0.6;
    const first = Math.max(0, Math.ceil((age - maxLife) * rate));
    const last = Math.floor(Math.min(age, duration) * rate);
    for (let n = first; n <= last; n += 1) {
      const born = n / rate;
      const sparkAge = age - born;
      // Busiest in the middle of the burn (松葉), sparse while it catches and as it dies (散り菊).
      const phase = born / Math.max(0.1, duration);
      const density = (0.25 + 0.75 * Math.sin(Math.PI * clamp(phase * 1.05))) * (0.45 + 0.55 * s.intensity) * smoothstep(0.2, 0.9, born);
      if (hash01(n, index, 1) > Math.min(1, density + boost * 0.4)) continue;
      const life = 0.2 + 0.4 * hash01(n, index, 2);
      if (sparkAge > life) continue;
      const f = sparkAge / life;
      const angle = hash01(n, index, 3) * TAU;
      const speed = (100 + 220 * hash01(n, index, 4)) * k;
      const travel = (speed * (1 - Math.exp(-4 * sparkAge))) / 4;
      const vx = Math.cos(angle) * speed * Math.exp(-4 * sparkAge);
      const vy = Math.sin(angle) * speed * Math.exp(-4 * sparkAge) + 240 * k * sparkAge;
      const x = ax + Math.cos(angle) * travel;
      const y = ay + Math.sin(angle) * travel + 120 * k * sparkAge * sparkAge;
      put(front, atlas.streak, x, y, 3 * k, (5 + 12 * (1 - f)) * k, (1 - f) * 0.9, hot, Math.atan2(vy, vx) - Math.PI / 2);
      // Most sparks fork into three as they slow (the branching that makes 線香花火).
      if (hash01(n, index, 5) < 0.75 && f > 0.4) {
        const splitAge = life * 0.4;
        const splitTravel = (speed * (1 - Math.exp(-4 * splitAge))) / 4;
        const sx = ax + Math.cos(angle) * splitTravel;
        const sy = ay + Math.sin(angle) * splitTravel + 120 * k * splitAge * splitAge;
        const childAge = sparkAge - splitAge;
        for (let c = 0; c < 3; c += 1) {
          const ca = angle + (hash01(n, index, 10 + c) - 0.5) * 2.4;
          const cs = (40 + 70 * hash01(n, index, 20 + c)) * k;
          const cx = sx + Math.cos(ca) * cs * childAge;
          const cy = sy + Math.sin(ca) * cs * childAge + 60 * k * childAge * childAge;
          put(front, atlas.core, cx, cy, 2.6 * k, 2.6 * k, (1 - childAge / (life * 0.6)) * 0.85, hot);
        }
      }
    }
  };

  // ---------------------------------------------------------------- firework shells

  const drawShell = (shell, t) => {
    const spec = SHELLS[shell.type] ?? SHELLS.peony;
    const tau = t - shell.t0;
    const sx = shell.x * W;
    const sy = shell.y * H;
    if (tau < 0) {
      if (!shell.rise || tau < -RISE_SEC) return;
      const p = 1 + tau / RISE_SEC;
      for (let j = 0; j < 7; j += 1) {
        const q = p - j * 0.028;
        if (q < 0) break;
        const ease = 1 - (1 - q) ** 2.2;
        const x = sx + Math.sin(q * 9 + shell.seed) * 2 * k;
        const y = H * 1.04 + (sy - H * 1.04) * ease;
        put(back, atlas.core, x, y, (3.6 - j * 0.35) * k, (3.6 - j * 0.35) * k, 0.9 * (1 - j / 7), hot);
        if (j === 0) put(back, atlas.dot, x, y, 16 * k, 16 * k, 0.3, warm);
      }
      return;
    }
    if (tau > spec.life * 1.2) return;
    const radius = spec.radius * u * shell.scale;
    if (tau < 0.18) {
      const flash = (1 - tau / 0.18) ** 2;
      put(back, atlas.dot, sx, sy, radius * 1.5, radius * 1.5, flash * 0.5, hot);
    }
    const n = Math.max(8, Math.round(spec.n * budget * Math.min(1.2, shell.scale)));
    const c1 = spec.gold ? warm : tintOf(shell.color);
    const c2 = spec.twoTone ? tintOf(shell.color + 1) : c1;
    const tilt = hash01(shell.seed, 7) * Math.PI;
    for (let i = 0; i < n; i += 1) {
      const theta = hash01(shell.seed, i, 1) * TAU;
      let dx;
      let dy;
      let depth;
      if (spec.ring) {
        const cx = Math.cos((i / n) * TAU);
        const cy = Math.sin((i / n) * TAU) * 0.42;
        dx = cx * Math.cos(tilt) - cy * Math.sin(tilt);
        dy = cx * Math.sin(tilt) + cy * Math.cos(tilt);
        depth = 0.5 + 0.5 * Math.sin((i / n) * TAU);
      } else {
        // Points on a sphere seen from the front: denser at the rim, as real shells look.
        const z = hash01(shell.seed, i, 2) * 2 - 1;
        const r = Math.sqrt(1 - z * z);
        dx = Math.cos(theta) * r;
        dy = Math.sin(theta) * r;
        depth = (z + 1) / 2;
      }
      const jitter = 0.9 + 0.1 * hash01(shell.seed, i, 3);
      const life = spec.life * (0.85 + 0.3 * hash01(shell.seed, i, 4));
      const f = tau / life;
      if (f >= 1) continue;
      // Drag-slowed travel plus gravity, computed inline (no per-star closures: this runs for
      // thousands of stars a frame, and garbage here would surface as periodic GC pauses).
      const reach = (radius * jitter) * (1 - Math.exp(-spec.drag * tau));
      const fall = 0.5 * spec.gravity * u;
      const x = sx + dx * reach;
      const y = sy + dy * reach + fall * tau * tau;
      const sparkle = f > 0.5 ? 0.6 + 0.4 * Math.sin(tau * 38 + i * 1.7) : 1;
      const alpha = (1 - smoothstep(0.55, 1, f)) * sparkle * (0.55 + 0.45 * depth);
      const color = f < 0.55 ? c1 : c2;
      const size = (2.2 + 1.8 * (1 - f)) * k * (0.75 + 0.5 * depth);
      put(back, atlas.dot, x, y, size * 4, size * 4, alpha * 0.45, color);
      put(back, atlas.core, x, y, size, size, alpha, f < 0.25 ? hot : color);
      for (let j = 1; j <= spec.ghosts; j += 1) {
        const ghostAge = tau - j * spec.spacing;
        if (ghostAge <= 0) break;
        const ghostReach = (radius * jitter) * (1 - Math.exp(-spec.drag * ghostAge));
        const gx = sx + dx * ghostReach;
        const gy = sy + dy * ghostReach + fall * ghostAge * ghostAge;
        put(back, atlas.core, gx, gy, size * (1 - j * 0.08), size * (1 - j * 0.08), alpha * 0.55 * (1 - j / (spec.ghosts + 1)), color);
      }
    }
  };

  // ---------------------------------------------------------------- light leaving the characters

  // A shared hash helper for the burst loop (set the key, then read slots), so the loop allocates nothing.
  let hashKey = 0;
  let hashM = 0;
  const hashSlot = (slot) => hash01(hashKey, hashM, slot);

  const drawGlyphBurst = (burst, t) => {
    const tau = t - burst.t0;
    if (tau < 0 || tau > 3.2) return;
    for (let j = 0; j < burst.points.length; j += 1) {
      const point = burst.points[j];
      const per = burst.style === 'sparks' ? 3 : burst.style === 'embers' ? 2 : hash01(burst.seed, j, 9) < 0.5 ? 2 : 1;
      const key = burst.seed + j * 31;
      for (let m = 0; m < per; m += 1) {
        const h = hashSlot;
        hashKey = key;
        hashM = m;
        if (burst.style === 'sparks') {
          const life = 0.55 + 0.45 * h(1);
          const f = tau / life;
          if (f >= 1) continue;
          const angle = h(2) * TAU;
          const speed = (60 + 140 * h(3)) * k;
          const d = (speed * (1 - Math.exp(-3.5 * tau))) / 3.5;
          const x = point.x + Math.cos(angle) * d;
          const y = point.y + Math.sin(angle) * d + 70 * k * tau * tau;
          put(front, atlas.core, x, y, 2.8 * k, 2.8 * k, (1 - f) * 0.9, f < 0.3 ? hot : burst.tint);
        } else if (burst.style === 'embers') {
          const life = 1.4 + 1.0 * h(1);
          const f = tau / life;
          if (f >= 1) continue;
          const x = point.x + (h(2) - 0.5) * 30 * k * tau + Math.sin(tau * (2 + 2 * h(3)) + h(4) * TAU) * 8 * k;
          const y = point.y - (24 + 40 * h(5)) * k * tau;
          const flicker = 0.6 + 0.4 * Math.sin(tau * (9 + 5 * h(6)) + h(7) * 20);
          const alpha = (1 - f) ** 1.2 * flicker;
          put(front, atlas.dot, x, y, 12 * k, 12 * k, alpha * 0.3, warm);
          put(front, atlas.core, x, y, 2.6 * k, 2.6 * k, alpha, hot);
        } else {
          const life = 1.6 + 1.0 * h(1);
          const f = tau / life;
          if (f >= 1) continue;
          const angle = -Math.PI / 2 + (h(2) - 0.5) * 2.2;
          const d = (16 + 30 * h(3)) * k * tau;
          const x = point.x + Math.cos(angle) * d;
          const y = point.y + Math.sin(angle) * d;
          const size = (5 + 6 * h(4)) * k;
          put(front, atlas.dot, x, y, size, size, Math.sin(Math.PI * f) * 0.55, burst.tint);
        }
      }
    }
  };

  // ---------------------------------------------------------------- public

  return {
    back: back.container,
    front: front.container,

    setPlan(nextPlan) {
      plan = nextPlan;
    },

    /** Particle tints: the plan palette mixed with the theme, plus the warm and hot tones of fire. */
    setColors({ palette, warmTint, hotTint, rain }) {
      tints = palette.length ? palette : [0xffffff];
      warm = warmTint;
      hot = hotTint;
      rainTint = rain;
    },

    /** Additive light vanishes on a light background: there particles are painted normally. */
    setDaylight(daylight) {
      back.container.blendMode = daylight ? 'normal' : 'add';
      front.container.blendMode = daylight ? 'normal' : 'add';
    },

    setBudget(value) {
      budget = clamp(value, 0.2, 1.6);
      cap = Math.round(2600 * budget);
    },

    /** Target level (0..1) of each ambient element; the rest fade to 0. */
    setAmbient(targetLevels) {
      for (const name of AMBIENTS) targets[name] = clamp(targetLevels[name] ?? 0);
    },

    /** A shell from a live onset (energetic paragraphs only), bursting now. */
    addLiveShell(shell) {
      runtimeShells.push(shell);
      if (runtimeShells.length > 12) runtimeShells.shift();
    },

    /** Light leaving a line's characters at `t0`; the same `id` replaces the earlier one. */
    addGlyphBurst(id, burst) {
      glyphBursts.set(id, burst);
    },

    onSeek() {
      runtimeShells.length = 0;
    },

    /**
     * Draws the frame at song time `t`. `live` is `{ onset, boost }` from the ear;
     * `snap` sets levels at once (previews).
     */
    update(t, dt, { width, height, live, snap }) {
      W = width;
      H = height;
      u = Math.min(W, H);
      k = u / 800;
      back.used = 0;
      front.used = 0;
      pulse = damp(pulse, 0, 0.35, dt);
      if (live?.onset) pulse = Math.max(pulse, live.onset);

      for (const name of AMBIENTS) {
        levels[name] = snap ? targets[name] : damp(levels[name], targets[name], LEVEL_TAU, dt);
        if (levels[name] > 0.01) AMBIENT_DRAW[name](t, levels[name]);
      }
      if (plan) {
        plan.sparklers.forEach((sparkler, index) => drawSparkler(sparkler, index, t, live?.boost ?? 0));
        for (const shell of plan.shells) {
          if (shell.t0 - RISE_SEC > t) break;
          if (t - shell.t0 < 4.5) drawShell(shell, t);
        }
      }
      for (let i = runtimeShells.length - 1; i >= 0; i -= 1) {
        const shell = runtimeShells[i];
        if (t - shell.t0 > 4.5 || t < shell.t0 - 1) runtimeShells.splice(i, 1);
        else drawShell(shell, t);
      }
      for (const [id, burst] of glyphBursts) {
        if (t - burst.t0 > 3.5 || burst.t0 - t > 180) glyphBursts.delete(id);
        else drawGlyphBurst(burst, t);
      }
      commit(back);
      commit(front);
      return back.used + front.used;
    },

    destroy() {
      back.container.destroy({ children: true });
      front.container.destroy({ children: true });
    },
  };
};
return { createParticles };
})();

// ---- src/textures.mjs
const __textures = (() => {
// Everything 花笺 draws is made on canvases here, once, then moved and faded as
// sprites: no per-frame drawing. Glyphs are rendered white and tinted on the
// GPU, so a theme change needs no redraw.


const makeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
};

const sourceOf = (canvas, resolution = 1) => new PIXI.CanvasSource({ resource: canvas, resolution, autoGenerateMipmaps: false });
const sub = (source, x, y, w, h) => new PIXI.Texture({ source, frame: new PIXI.Rectangle(x, y, w, h) });

/**
 * One atlas for every particle shape, so each particle container draws in a
 * single batch. Shapes are white; particles are tinted.
 */
const createParticleAtlas = () => {
  const canvas = makeCanvas(256, 256);
  const c = canvas.getContext('2d');

  // dot: a soft round glow (0,0,64,64)
  let g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);

  // core: a small bright disc with a short falloff (64,0,32,32)
  g = c.createRadialGradient(80, 16, 0, 80, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(64, 0, 32, 32);

  // streak: a thin vertical line fading at both ends (96,0,8,96)
  g = c.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(99, 0, 2, 96);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(98, 20, 4, 60);

  // petal: an almond with a soft edge (112,0,48,28)
  c.save();
  c.translate(136, 14);
  g = c.createRadialGradient(-4, -2, 1, 0, 0, 22);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-22, 0);
  c.quadraticCurveTo(-4, -13, 22, -1);
  c.quadraticCurveTo(-2, 12, -22, 0);
  c.fill();
  c.restore();

  // flare: a four-point glint (160,0,64,64)
  c.save();
  c.translate(192, 32);
  for (const [w, h] of [[30, 1.6], [1.6, 30]]) {
    g = c.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-w, -h, w * 2, h * 2);
  }
  c.restore();

  // ring: a bokeh disc, brighter at its rim (0,64,96,96)
  g = c.createRadialGradient(48, 112, 0, 48, 112, 46);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.93, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 64, 96, 96);

  const source = sourceOf(canvas);
  return {
    source,
    dot: sub(source, 0, 0, 64, 64),
    core: sub(source, 64, 0, 32, 32),
    streak: sub(source, 96, 0, 8, 96),
    petal: sub(source, 112, 0, 48, 28),
    flare: sub(source, 160, 0, 64, 64),
    ring: sub(source, 0, 64, 96, 96),
    destroy() {
      source.destroy();
    },
  };
};

/** A radial gradient, white center to transparent: tinted and stretched for the wash and vignette. */
const createRadialTexture = (inner, outer) => {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const c = canvas.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  // Dither the alpha by a step or two: a soft gradient stretched across a screen otherwise shows bands.
  const image = c.getImageData(0, 0, size, size);
  let seed = 987654321;
  for (let i = 3; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + ((seed >>> 24) % 5) - 2));
  }
  c.putImageData(image, 0, 0);
  return new PIXI.Texture({ source: sourceOf(canvas) });
};

/** Film grain: mid-grey noise, tiled and shifted every few frames. */
const createGrainTexture = () => {
  const size = 160;
  const canvas = makeCanvas(size, size);
  const c = canvas.getContext('2d');
  const image = c.createImageData(size, size);
  let seed = 1234567;
  for (let i = 0; i < size * size; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const v = 96 + ((seed >>> 16) & 127);
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  c.putImageData(image, 0, 0);
  const source = sourceOf(canvas);
  source.style.addressMode = 'repeat';
  return new PIXI.Texture({ source });
};

/* Packs cells of the given widths into rows no wider than maxRow; returns positions and the sheet size. */
const pack = (widths, cellH, maxRow) => {
  const spots = [];
  let x = 0;
  let y = 0;
  let width = 1;
  for (const w of widths) {
    if (x + w > maxRow && x > 0) {
      x = 0;
      y += cellH;
    }
    spots.push({ x, y });
    x += w;
    width = Math.max(width, x);
  }
  return { spots, width, height: y + cellH };
};

/** The glow is drawn at this fraction of the size (times the screen's pixel ratio, up to 1.5) and
 *  enlarged on the GPU. Half size keeps it smooth on high-DPI screens; lower read as smeared. */
const GLOW_RES = 0.5;

/**
 * Glyph atlas for a set of characters: a sharp white copy of each at full resolution, and a glowing
 * copy on a small separate sheet (scale its sprites by 1 / GLOW_RES). `font(px)` gives a CSS font.
 * The glow sheet is drawn by a separate call, `buildGlow()`, so the two can land in different frames.
 * Returns `{ get(char) -> { sharp, glow, width }, sharpSource, buildGlow() -> glowSource, destroy }`.
 */
const createGlyphAtlas = (chars, { font, size, dpr, glow = 0.42 }) => {
  const unique = [...new Set(chars.filter((char) => !/\s/u.test(char)))];
  const probe = makeCanvas(4, 4).getContext('2d');
  probe.font = font(size);
  const advances = unique.map((char) => probe.measureText(char).width);

  // Sharp sheet: a small pad is enough (no blur).
  const pad = Math.ceil(size * 0.12 + 2);
  const cellH = Math.ceil(size * 1.32 + pad * 2);
  const sharpW = advances.map((a) => Math.ceil(Math.max(a, size * 0.3) + pad * 2));
  const sharp = pack(sharpW, cellH, 2048);
  const sharpCanvas = makeCanvas(sharp.width * dpr, sharp.height * dpr);
  let c = sharpCanvas.getContext('2d');
  c.scale(dpr, dpr);
  c.font = font(size);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#ffffff';
  // Large glyphs are slow to rasterize: the sheet is filled a few characters per call.
  let drawn = 0;
  const drawSharp = (count = Infinity) => {
    const sharpContext = sharpCanvas.getContext('2d');
    const end = Math.min(unique.length, drawn + count);
    for (; drawn < end; drawn += 1) {
      sharpContext.fillText(unique[drawn], sharp.spots[drawn].x + sharpW[drawn] / 2, sharp.spots[drawn].y + cellH / 2);
    }
    return drawn >= unique.length;
  };

  const sharpSource = sourceOf(sharpCanvas, dpr);
  const map = new Map(unique.map((char, i) => [char, {
    sharp: sub(sharpSource, sharp.spots[i].x, sharp.spots[i].y, sharpW[i], cellH),
    glow: null,
    width: advances[i],
  }]));
  // Glow sheet at GLOW_RES of the size, drawn a few characters per call like the sharp sheet.
  const gr = Math.min(1.5, dpr);
  const small = size * GLOW_RES;
  const blur = Math.max(1.5, small * glow);
  const gPad = Math.ceil(blur * 1.7 + 2);
  const gCellH = Math.ceil(small * 1.32 + gPad * 2);
  const glowW = advances.map((a) => Math.ceil(Math.max(a, size * 0.3) * GLOW_RES + gPad * 2));
  const glowSheet = pack(glowW, gCellH, 1400);
  let glowCanvas = null;
  let glowContext = null;
  let glowDrawn = 0;
  let glowSource = null;
  /** Draws up to `count` more glow characters; returns the source once all are drawn, else null. */
  const buildGlow = (count = Infinity) => {
    if (glowSource) return glowSource;
    if (!glowCanvas) {
      glowCanvas = makeCanvas(glowSheet.width * gr, glowSheet.height * gr);
      glowContext = glowCanvas.getContext('2d');
      glowContext.scale(gr, gr);
      glowContext.font = font(small);
      glowContext.textAlign = 'center';
      glowContext.textBaseline = 'middle';
      glowContext.fillStyle = '#ffffff';
      glowContext.shadowColor = '#ffffff';
      // The shadow blur is in device pixels: it ignores the context transform.
      glowContext.shadowBlur = blur * gr;
    }
    const end = Math.min(unique.length, glowDrawn + count);
    for (; glowDrawn < end; glowDrawn += 1) {
      // Drawn twice: one pass of shadow is too faint to read as light.
      const gx = glowSheet.spots[glowDrawn].x + glowW[glowDrawn] / 2;
      const gy = glowSheet.spots[glowDrawn].y + gCellH / 2;
      glowContext.fillText(unique[glowDrawn], gx, gy);
      glowContext.fillText(unique[glowDrawn], gx, gy);
    }
    if (glowDrawn < unique.length) return null;
    glowSource = sourceOf(glowCanvas, gr);
    unique.forEach((char, i) => {
      map.get(char).glow = sub(glowSource, glowSheet.spots[i].x, glowSheet.spots[i].y, glowW[i], gCellH);
    });
    return glowSource;
  };
  return {
    get: (char) => map.get(char) ?? null,
    sharpSource,
    drawSharp,
    buildGlow,
    destroy() {
      sharpSource.destroy();
      glowSource?.destroy();
    },
  };
};

/** One line of text as a single texture (labels, numerals, captions). */
const createLabelTexture = (text, { font, size, dpr, letterSpacing = 0 }) => {
  const probe = makeCanvas(4, 4).getContext('2d');
  probe.font = font;
  const chars = Array.from(String(text));
  const widths = chars.map((char) => probe.measureText(char).width);
  const width = widths.reduce((sum, w) => sum + w, 0) + letterSpacing * Math.max(0, chars.length - 1);
  const pad = Math.ceil(size * 0.3);
  const canvas = makeCanvas((width + pad * 2) * dpr, (size * 1.5 + pad * 2) * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.font = font;
  c.textBaseline = 'middle';
  c.fillStyle = '#ffffff';
  let x = pad;
  chars.forEach((char, i) => {
    c.fillText(char, x, pad + size * 0.75);
    x += widths[i] + letterSpacing;
  });
  return new PIXI.Texture({ source: sourceOf(canvas, dpr) });
};
return { createParticleAtlas, createRadialTexture, createGrainTexture, GLOW_RES, createGlyphAtlas, createLabelTexture };
})();

// ---- src/shots.mjs
const __shots = (() => {
// Shots: every sung line is a shot with its own layout, motion, camera,
// transition and decorations (the recipe comes from plan.mjs). A shot is built
// shortly before it appears and posed every frame as a pure function of song
// time: characters enter, are sung and leave by the motions in kinetic.mjs,
// the shot's container carries its camera move and transitions, and its
// decorations draw themselves on and off.
//
// Shots overlap during transitions; each has its own container, so a whip,
// a push-through or a dissolve is just two containers moving at once.

const { charTimings } = __lyrics;
const { GLOW_RES, createGlyphAtlas, createLabelTexture } = __textures;
const { drawEmblem } = __emblems;
const { MOVING_KINDS, layoutShot } = __layouts;
const { ENTER, EXIT, SING, TEMPERAMENTS, blank, fitStagger, ranks, resetTransform } = __kinetic;
const { hash01, hashString } = __random;
const { bump, clamp, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, easeOutExpo, lerp, progress, smoothstep } = __motion;

const SCRAMBLE = Array.from('#%&@*+=/<>?!$01ΔΣΩ※◇');
// Shots are built this far ahead, one per frame, so a frame never pays for two builds and the
// texture uploads happen in a quiet frame instead of the one where the line appears.
const BUILD_AHEAD = 2.2;
const ATLAS_CACHE = 10;
const easeOutQuart = (t) => 1 - (1 - t) ** 4;
const easeInQuart = (t) => t ** 4;

const whiteSprite = (container) => {
  const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
  container.addChild(sprite);
  return sprite;
};
const poseBar = (sprite, x, y, w, h, alpha, tint, ax = 0.5, ay = 0.5, rotation = 0) => {
  sprite.visible = alpha > 0.003 && Math.abs(w) > 0.05 && Math.abs(h) > 0.05;
  if (!sprite.visible) return;
  sprite.anchor.set(ax, ay);
  sprite.position.set(x, y);
  sprite.width = w;
  sprite.height = h;
  sprite.rotation = rotation;
  sprite.alpha = Math.min(1, alpha);
  sprite.tint = tint;
};
const centered = (container, texture) => {
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  container.addChild(sprite);
  return sprite;
};
const mixNumber = (a, b, t) => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

const createShots = (env) => {
  const live = new Map();
  let plan = null;
  let analysis = null;
  let song = null;
  const tmp = blank();

  const fonts = () => env.fonts();
  const fontAt = (weight) => (size) => `${weight} ${Math.max(1, size).toFixed(2)}px ${fonts().family}`;

  // ---------------------------------------------------------------- decorations
  // Each returns update(t, s) and draws in the shot's own coordinates (0,0 = shot center).

  /* A guide drawn around the main word: it grows in from small and turns a little over the shot. */
  const guide = (s, g, { turn = 0.15, alpha = 0.6 } = {}) => {
    const piece = s.heroPiece;
    const spin = (hash01(hashString(s.shot.id), 53) - 0.5) * turn;
    return (t) => {
      const grow = easeOutExpo(progress(t, s.shot.show + 0.15, 0.9));
      g.alpha = alpha * s.presence(t) * grow;
      g.visible = g.alpha > 0.003;
      if (!g.visible) return;
      g.position.set(piece.x, piece.y);
      g.scale.set(0.7 + 0.3 * grow);
      g.rotation = piece.rotation + spin * progress(t, s.shot.show, Math.max(1, s.exitEnd - s.shot.show));
    };
  };

  const DECOR = {
    /* A line-art emblem behind the main word (after 商籁): grows in, then turns slowly. */
    emblem(s, { colors, W, H }) {
      const seed = hashString(s.shot.id);
      const g = drawEmblem(s.shot.emblem, new PIXI.Graphics(), Math.min(W, H) * 0.36, seed);
      g.tint = colors.ink;
      s.back.addChild(g);
      // On a page the emblem sits in the open half, away from the text; elsewhere behind the main word.
      const page = s.shot.layout === 'page' || s.shot.layout === 'vertical';
      const away = (s.shot.mirror ? -1 : 1) * (s.shot.layout === 'vertical' ? -1 : 1);
      const piece = page ? { x: away * W * 0.26, y: 0 } : s.heroPiece;
      const turn0 = hash01(seed, 52) * Math.PI * 2;
      const spin = (hash01(seed, 51) - 0.5) * (s.shot.calm ? 0.12 : 0.35);
      const swing = s.shot.calm ? 0 : 0.35;
      const base = (colors.daylight ? 0.5 : 0.42) * (s.shot.calm ? 0.75 : 1);
      return (t) => {
        const grow = easeOutCubic(progress(t, s.shot.show, s.shot.calm ? 2 : 1.2));
        const life = progress(t, s.shot.show, Math.max(1, s.exitEnd - s.shot.show));
        g.alpha = base * s.presence(t) * (0.3 + 0.7 * grow);
        g.visible = g.alpha > 0.003;
        if (!g.visible) return;
        g.position.set(piece.x, piece.y);
        g.scale.set(0.84 + 0.16 * grow + 0.04 * life);
        g.rotation = turn0 + spin * life + (1 - grow) * swing;
      };
    },

    /* A magazine grid over the frame and a heavy inset frame (商籁's editorial column). */
    mesh(s, { colors, W, H }) {
      const g = new PIXI.Graphics();
      for (let k = 1; k <= 6; k += 1) g.moveTo(-W / 2 + (k / 7) * W, -H / 2).lineTo(-W / 2 + (k / 7) * W, H / 2);
      for (let k = 1; k <= 4; k += 1) g.moveTo(-W / 2, -H / 2 + (k / 5) * H).lineTo(W / 2, -H / 2 + (k / 5) * H);
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.12 });
      g.rect(-W * 0.3, -H * 0.3, W * 0.6, H * 0.6).stroke({ color: 0xffffff, width: 3, alpha: 0.38 });
      g.tint = colors.ink;
      s.back.addChild(g);
      return (t) => {
        const d = easeOutExpo(progress(t, s.shot.show, 1.2));
        g.alpha = s.presence(t) * (0.4 + 0.6 * d);
        g.visible = g.alpha > 0.003;
        g.scale.set(1.05 - 0.05 * d);
      };
    },

    /* A five-line staff under a ribbon of words, a note for each word lighting as it is sung. */
    staff(s, { colors, W }) {
      const piece = s.heroPiece;
      const step = Math.max(7, piece.size * 0.11);
      const width = W * 0.86;
      const g = new PIXI.Graphics();
      for (let k = 0; k < 5; k += 1) g.moveTo(-width / 2, (k - 2) * step).lineTo(width / 2, (k - 2) * step);
      g.stroke({ color: 0xffffff, width: 1.5, alpha: 0.3 });
      for (let k = 1; k < 4; k += 1) g.moveTo(-width / 2 + (k / 4) * width, -2 * step).lineTo(-width / 2 + (k / 4) * width, 2 * step);
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.16 });
      g.moveTo(-width / 2 + 6, -2 * step).lineTo(-width / 2 + 6, 2 * step).stroke({ color: 0xffffff, width: 4, alpha: 0.45 });
      g.moveTo(width / 2 - 8, -2 * step).lineTo(width / 2 - 8, 2 * step).stroke({ color: 0xffffff, width: 1.5, alpha: 0.45 });
      g.moveTo(width / 2 - 2, -2 * step).lineTo(width / 2 - 2, 2 * step).stroke({ color: 0xffffff, width: 5, alpha: 0.45 });
      g.tint = colors.ink;
      const root = new PIXI.Container();
      root.addChild(g);
      const seed = hashString(s.shot.id);
      const notes = s.wordInfo.map((word, k) => {
        const note = new PIXI.Graphics();
        const line = Math.floor(hash01(seed, k, 71) * 9) - 4;
        const up = line < 0;
        note.ellipse(0, 0, step * 0.62, step * 0.44).fill({ color: 0xffffff });
        note.moveTo(up ? -step * 0.58 : step * 0.58, 0).lineTo(up ? -step * 0.58 : step * 0.58, up ? step * 3.2 : -step * 3.2).stroke({ color: 0xffffff, width: 1.5 });
        note.position.set(-width / 2 + ((k + 0.5) / s.wordInfo.length) * width * 0.92 + width * 0.04, (line * step) / 2);
        note.rotation = -0.3;
        note.tint = colors.accentNumber;
        root.addChild(note);
        return { note, at: word.at };
      });
      s.back.addChild(root);
      return (t) => {
        const a = s.presence(t);
        root.visible = a > 0.003;
        if (!root.visible) return;
        root.position.set(0, piece.y + piece.h * 0.7);
        g.alpha = a * easeOutExpo(progress(t, s.shot.show, 1));
        for (const { note, at } of notes) {
          const lit = t >= at ? 1 : 0;
          const pop = lit ? Math.exp(-(t - at) / 0.25) : 0;
          note.alpha = a * (0.25 + 0.65 * lit);
          note.scale.set(1 + 0.35 * pop);
        }
      };
    },

    /* A few small squares set about the frame, appearing one after another (商籁's quiet tableau). */
    squares(s, { colors, W, H }) {
      const seed = hashString(s.shot.id);
      const marks = Array.from({ length: 5 }, (_, k) => ({
        sprite: whiteSprite(s.back),
        x: (hash01(seed, k, 61) - 0.5) * W * 0.7,
        y: (hash01(seed, k, 62) - 0.5) * H * 0.6,
        size: 7 + 9 * hash01(seed, k, 63),
        at: s.shot.show + 0.2 + k * 0.18,
      }));
      return (t) => {
        for (const m of marks) poseBar(m.sprite, m.x, m.y, m.size, m.size, 0.4 * s.presence(t) * smoothstep(m.at, m.at + 0.6, t), colors.accentNumber);
      };
    },

    /* 云阶's hair lines: a thin rule beside each block, drawn out as the block is sung. */
    guides(s, { colors }) {
      const marks = s.pieces.map((piece) => ({ piece, bar: whiteSprite(s.back), left: (piece.order ?? piece.index) % 2 === 0 }));
      return (t) => {
        for (const { piece, bar, left } of marks) {
          const grow = easeOutCubic(progress(t, piece.first - 0.2, 0.4));
          const x = piece.x + (left ? -1 : 1) * (piece.w / 2 + piece.size * 0.35);
          poseBar(bar, x, piece.y, 1.2, piece.h * 0.9 * grow, 0.5 * s.presence(t), colors.accentNumber, 0.5, 0.5, piece.rotation);
        }
      };
    },

    /* A ring with a crosshair through the main word. */
    crosshair(s, { colors }) {
      const piece = s.heroPiece;
      const r = Math.max(piece.w, piece.h) * 0.6;
      const g = new PIXI.Graphics();
      g.circle(0, 0, r).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
      g.circle(0, 0, r * 1.07).stroke({ color: 0xffffff, width: 1, alpha: 0.3 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.moveTo(dx * r * 0.85, dy * r * 0.85).lineTo(dx * r * 1.35, dy * r * 1.35);
      g.stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
      g.tint = colors.accentNumber;
      s.back.addChild(g);
      return guide(s, g, { turn: 0.5 });
    },

    /* A square frame turned to a diamond around the main word. */
    diamondFrame(s, { colors }) {
      const piece = s.heroPiece;
      const side = Math.max(piece.w, piece.h) * 0.92;
      const g = new PIXI.Graphics();
      g.rect(-side / 2, -side / 2, side, side).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      g.rect(-side * 0.46, -side * 0.46, side * 0.92, side * 0.92).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
      const wrap = new PIXI.Container();
      g.rotation = Math.PI / 4;
      wrap.addChild(g);
      g.tint = colors.ink;
      s.back.addChild(wrap);
      return guide(s, wrap, { turn: 0.3, alpha: 0.7 });
    },

    /* Two arches, one over and one under the main word. */
    arches(s, { colors }) {
      const piece = s.heroPiece;
      const r = Math.max(piece.w, piece.h) * 0.55;
      const off = Math.min(piece.w, piece.h) * 0.62;
      const g = new PIXI.Graphics();
      g.arc(0, -off, r, Math.PI, Math.PI * 2).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      g.arc(0, off, r, 0, Math.PI).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      g.arc(0, -off, r * 1.08, Math.PI * 1.1, Math.PI * 1.9).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
      g.tint = colors.ink;
      s.back.addChild(g);
      return guide(s, g, { turn: 0.08, alpha: 0.65 });
    },

    underline(s, { colors }) {
      const piece = s.heroPiece;
      const bar = whiteSprite(s.front);
      const glyphs = s.glyphs.filter((g) => g.g.piece === piece.index);
      const first = Math.min(...glyphs.map((g) => g.timing.start));
      const last = Math.max(...glyphs.map((g) => g.timing.end));
      return (t) => {
        const sung = easeOutCubic(progress(t, first, Math.max(0.3, last - first)));
        const out = easeInCubic(progress(t, s.exitStart, 0.4));
        poseBar(bar, piece.x - piece.w / 2, piece.y + piece.h * 0.52, piece.w * sung * (1 - out), Math.max(1.5, piece.size * 0.035), 0.85 * s.presence(t), colors.accentNumber, 0, 0.5, piece.rotation);
      };
    },

    frame(s, { colors }) {
      const piece = s.heroPiece;
      const variant = Math.floor(hash01(hashString(s.shot.id), 41) * 3);
      const pad = piece.size * 0.32;
      const w = piece.w + pad * 2;
      const h = piece.h + pad * 0.8;
      const cos = Math.cos(piece.rotation);
      const sin = Math.sin(piece.rotation);
      const at = (dx, dy) => [piece.x + dx * cos - dy * sin, piece.y + dx * sin + dy * cos];
      if (variant === 0) {
        // Corner brackets, growing out of each corner.
        const bars = Array.from({ length: 8 }, () => whiteSprite(s.front));
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        return (t) => {
          const draw = easeOutExpo(progress(t, s.shot.show + 0.2, 0.7));
          const arm = Math.min(w, h) * 0.3 * draw;
          const a = 0.7 * s.presence(t);
          corners.forEach(([sx, sy], c) => {
            const [x, y] = at((sx * w) / 2, (sy * h) / 2);
            poseBar(bars[c * 2], x, y, arm, 1.2, a, colors.ink, sx < 0 ? 0 : 1, 0.5, piece.rotation);
            poseBar(bars[c * 2 + 1], x, y, 1.2, arm, a, colors.ink, 0.5, sy < 0 ? 0 : 1, piece.rotation);
          });
        };
      }
      // A box drawn edge by edge (solid) or in dashes.
      const dashed = variant === 2;
      const edges = [[-w / 2, -h / 2, w / 2, -h / 2], [w / 2, -h / 2, w / 2, h / 2], [w / 2, h / 2, -w / 2, h / 2], [-w / 2, h / 2, -w / 2, -h / 2]];
      const dash = piece.size * 0.18;
      const segments = [];
      edges.forEach(([x0, y0, x1, y1], e) => {
        const length = Math.hypot(x1 - x0, y1 - y0);
        const count = dashed ? Math.max(1, Math.floor(length / (dash * 1.7))) : 1;
        for (let k = 0; k < count; k += 1) {
          const f0 = dashed ? k / count : 0;
          const f1 = dashed ? f0 + (dash / length) : 1;
          segments.push({ e, f0, f1, x0, y0, x1, y1, bar: whiteSprite(s.front) });
        }
      });
      return (t) => {
        const a = 0.6 * s.presence(t);
        for (const seg of segments) {
          const local = clamp(progress(t, s.shot.show + 0.15 + seg.e * 0.12, 0.35));
          const reach = clamp((local - seg.f0) / Math.max(1e-3, seg.f1 - seg.f0));
          const fx = seg.x0 + (seg.x1 - seg.x0) * seg.f0;
          const fy = seg.y0 + (seg.y1 - seg.y0) * seg.f0;
          const len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) * (seg.f1 - seg.f0) * reach;
          const angle = Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0) + piece.rotation;
          const [x, y] = at(fx, fy);
          poseBar(seg.bar, x, y, len, 1.2, a, colors.ink, 0, 0.5, angle);
        }
      };
    },

    /* A manuscript margin: a rule down the page, a tick on it as each line arrives. */
    margin(s, { colors }) {
      const right = s.shot.mirror;
      const size = s.pieces[0].size;
      const edge = right ? Math.max(...s.pieces.map((p) => p.x + p.w / 2)) + size * 0.8 : Math.min(...s.pieces.map((p) => p.x - p.w / 2)) - size * 0.8;
      const top = Math.min(...s.pieces.map((p) => p.y - p.h / 2)) - size * 0.2;
      const bottom = Math.max(...s.pieces.map((p) => p.y + p.h / 2)) + size * 0.2;
      const rule = whiteSprite(s.front);
      const ticks = s.lineInfo.map((line) => ({ ...line, bar: whiteSprite(s.front) }));
      return (t) => {
        const a = s.presence(t);
        poseBar(rule, edge, top, 1, (bottom - top) * easeOutExpo(progress(t, s.shot.show, 1.8)), 0.3 * a, colors.ink, 0.5, 0);
        for (const tick of ticks) {
          const p = easeOutCubic(progress(t, tick.enterAt, 0.5));
          const now = t < tick.pastAt ? 1 : 1 - 0.6 * smoothstep(tick.pastAt, tick.pastAt + 0.6, t);
          poseBar(tick.bar, edge, tick.y, size * 0.45 * p, 1.3, 0.75 * a * now, colors.accentNumber, right ? 0 : 1, 0.5);
        }
      };
    },

    /* Manuscript paper for a vertical page: column lines and a top and bottom rule, drawn right to left. */
    grid(s, { colors }) {
      const columns = s.pieces;
      const size = columns[0].size;
      const half = size * 0.925;
      const top = Math.min(...columns.map((p) => p.y - p.h / 2)) - size * 0.45;
      const bottom = Math.max(...columns.map((p) => p.y + p.h / 2)) + size * 0.45;
      const xs = [columns[0].x + half, ...columns.map((p) => p.x - half)];
      const lines = xs.map((x, i) => ({ x, i, bar: whiteSprite(s.back) }));
      const edges = [top, bottom].map((y) => ({ y, bar: whiteSprite(s.back) }));
      return (t) => {
        const a = s.presence(t);
        for (const line of lines) poseBar(line.bar, line.x, top, 1, (bottom - top) * easeOutExpo(progress(t, s.shot.show + line.i * 0.08, 1.4)), 0.22 * a, colors.accentNumber, 0.5, 0);
        const across = easeOutExpo(progress(t, s.shot.show + 0.1, 1.6));
        for (const edge of edges) poseBar(edge.bar, xs[0], edge.y, (xs[0] - xs[xs.length - 1]) * across, 1, 0.3 * a, colors.accentNumber, 1, 0.5);
      };
    },

    rule(s, { colors, H }) {
      const piece = s.mainPiece;
      const right = s.shot.mirror;
      const x = right ? piece.x + piece.w / 2 + piece.size * 0.7 : piece.x - piece.w / 2 - piece.size * 0.7;
      const bar = whiteSprite(s.front);
      return (t) => {
        const draw = easeOutExpo(progress(t, s.shot.show, 1.2));
        poseBar(bar, x, piece.y + piece.size * 0.7, 1, H * 0.46 * draw, 0.35 * s.presence(t), colors.ink, 0.5, 1);
      };
    },

    leak(s, { colors, W, H }) {
      const sprite = centered(s.back, env.radial);
      sprite.blendMode = colors.daylight ? 'normal' : 'add';
      sprite.tint = colors.warm;
      const side = s.shot.mirror ? -1 : 1;
      return (t) => {
        const p = progress(t, s.shot.show - 0.2, 2.4);
        sprite.visible = p > 0 && p < 1;
        if (!sprite.visible) return;
        sprite.position.set(side * lerp(-W * 0.55, W * 0.55, easeInOutCubic(p)), lerp(-H * 0.1, H * 0.05, p));
        sprite.width = W * 0.9;
        sprite.height = H * 0.9;
        sprite.alpha = (colors.daylight ? 0.12 : 0.22) * bump(p);
      };
    },
  };

  // ---------------------------------------------------------------- atlases

  /** When a shot is gone for good: its exit plus the longest possible stagger. */
  const endOf = (shot) => shot.exitStart + (EXIT[shot.exit]?.dur ?? 1) + 0.45;

  /* Glyph atlases by font, size and characters: a returning chorus reuses its glyphs. */
  const atlases = new Map();
  /* A generator: each heavy part (drawing a sheet, uploading it) is its own step. */
  const acquireAtlas = function* (chars, font, size, dpr) {
    const key = `${font(size)}|${dpr}|${[...new Set(chars)].sort().join('')}`;
    let entry = atlases.get(key);
    if (!entry) {
      const atlas = createGlyphAtlas(chars, { font, size, dpr });
      // Bigger glyphs, fewer per step.
      const perStep = Math.max(1, Math.round(1100 / Math.max(1, size * dpr)));
      while (!atlas.drawSharp(perStep)) yield;
      yield;
      env.upload(atlas.sharpSource);
      yield;
      let glowSource;
      while (!(glowSource = atlas.buildGlow(perStep))) yield;
      env.upload(glowSource);
      yield;
      entry = atlases.get(key) ?? { atlas, refs: 0, key };
      if (entry.atlas !== atlas) atlas.destroy();
      entry.atlas.key = key;
    }
    atlases.delete(key);
    atlases.set(key, entry); // most recently used last
    entry.refs += 1;
    // Unused atlases beyond the cache size go, oldest first.
    for (const [otherKey, other] of atlases) {
      if (atlases.size <= ATLAS_CACHE) break;
      if (other.refs === 0) {
        other.atlas.destroy();
        atlases.delete(otherKey);
      }
    }
    return entry.atlas;
  };
  const releaseAtlas = (atlas) => {
    const entry = atlases.get(atlas.key);
    if (entry) entry.refs = Math.max(0, entry.refs - 1);
  };
  const clearAtlases = () => {
    for (const entry of atlases.values()) entry.atlas.destroy();
    atlases.clear();
  };

  // ---------------------------------------------------------------- building a shot

  /* Builds a shot step by step (a generator): the scheduler runs a few milliseconds of it per frame.
   * `job` collects what to clean up if the build is abandoned half way. */
  const buildShotSteps = function* (shot, shotIndexInParagraph, job) {
    const { W, H, fs, dpr } = env.metrics();
    const colors = env.colors();
    const pools = TEMPERAMENTS[shot.temperament] ?? TEMPERAMENTS.lyrical;
    const lines = (shot.items ?? [shot.item]).map((index) => {
      const item = analysis.items[index];
      const chars = Array.from(String(item.line.fullText ?? ''));
      // Where each character starts in UTF-16, to match Folia's keyword colour ranges.
      const offsets = [];
      let offset = 0;
      for (const char of chars) {
        offsets.push(offset);
        offset += char.length;
      }
      return { item, chars, offsets, colorRanges: env.wordColors?.(item.line) ?? null, segments: env.segment(item.line), timings: charTimings(item.line) };
    });
    const mark = globalThis.__HUAJIAN_DEBUG__ ? [['start', performance.now()]] : null;
    const lap = (name) => {
      mark?.push([name, performance.now()]);
      job.label = `after ${name}`;
    };
    // A sad song keeps the regular weight; a loud passage sets its words bold.
    const bold = !shot.calm && (shot.temperament === 'punchy' || (shot.temperament === 'dramatic' && shot.layout !== 'vertical'));
    const weight = bold ? Math.max(fonts().weight, 700) : fonts().weight;
    // Vertical columns are set in the book face (Song), as a scroll would be.
    const family = shot.layout === 'vertical' ? fonts().display : fonts().family;
    const font = (size) => `${weight} ${Math.max(1, size).toFixed(2)}px ${family}`;
    const { glyphs: placed, pieces } = layoutShot({ lines, layout: shot.layout, m: { W, H, fs }, font, keyword: shot.keyword, variant: shot.variant, mirror: shot.mirror, calm: shot.calm });

    lap('layout');
    yield;
    const root = new PIXI.Container();
    job.root = root;
    const back = new PIXI.Container();
    const shadowLayer = new PIXI.Container();
    const glowLayer = new PIXI.Container();
    const rgbLayer = new PIXI.Container();
    const sharpLayer = new PIXI.Container();
    const front = new PIXI.Container();
    glowLayer.blendMode = colors.daylight ? 'normal' : 'add';
    rgbLayer.blendMode = colors.daylight ? 'normal' : 'add';
    root.addChild(back, shadowLayer, glowLayer, rgbLayer, sharpLayer, front);
    // Set type (凝彩) carries a print shadow.
    const printed = shot.layout === 'type';

    // Two glyph sheets: the large words drawn at their own size (sharp even at 340 px), the rest at
    // theirs, so a word shot's few huge characters do not make every small one a huge texture.
    const largest = Math.max(fs, ...placed.map((g) => g.size));
    const bigCut = largest * 0.6;
    const bigSize = Math.min(340, largest);
    const smallSize = Math.min(200, Math.max(fs * 0.5, ...placed.filter((g) => g.size <= bigCut).map((g) => g.size)));
    const extra = shot.enter === 'scramble' ? SCRAMBLE : [];
    const bigChars = placed.filter((g) => g.size > bigCut).map((g) => g.char);
    const smallChars = placed.filter((g) => g.size <= bigCut).map((g) => g.char);
    const disposables = [];
    job.disposables = disposables;
    const bigAtlas = bigChars.length ? yield* acquireAtlas(bigChars.concat(extra), font, bigSize, dpr) : null;
    if (bigAtlas) disposables.push({ destroy: () => releaseAtlas(bigAtlas) });
    const smallAtlas = smallChars.length ? yield* acquireAtlas(smallChars.concat(extra), font, smallSize, dpr) : null;
    if (smallAtlas) disposables.push({ destroy: () => releaseAtlas(smallAtlas) });
    lap('atlas');

    // Each line comes in on its own time (a page holds several): its order, stagger and lead.
    const byLine = lines.map(() => []);
    placed.forEach((g, i) => byLine[g.line].push(i));
    const lineShow = lines.map(({ item }) => Math.max(shot.show, item.start - pools.lead));
    const rankOf = new Array(placed.length).fill(0);
    const staggerOf = lines.map((line, li) => {
      const order = ranks(shot.order, byLine[li].length, hashString(shot.id) + li);
      byLine[li].forEach((index, k) => {
        rankOf[index] = order[k];
      });
      return fitStagger(shot.enter, Math.max(0, ...order), pools.stagger, line.item.start - lineShow[li] + 0.35).stagger;
    });
    const enterDuration = ENTER[shot.enter]?.dur ?? 0.6;
    // On a page, a line steps back once the next one starts.
    const pastAt = lines.map((_, li) => (li < lines.length - 1 ? lines[li + 1].item.start - 0.15 : Infinity));
    const exitRank = lines.length > 1 ? placed.map((_, i) => i) : rankOf;
    const maxExitRank = Math.max(0, ...exitRank);
    const exitSpec = EXIT[shot.exit] ?? EXIT.dissolve;
    const exitStagger = Math.min(0.035, 0.4 / Math.max(1, maxExitRank));
    const useRgb = shot.enter === 'glitch' || shot.enter === 'scramble';
    const useGhost = shot.enter === 'slide' || shot.enter === 'stretch' || shot.exit === 'slide';

    const glyphs = placed.map((g, i) => {
      const line = lines[g.line];
      const big = g.size > bigCut;
      const atlas = big ? bigAtlas : smallAtlas;
      const entry = atlas.get(g.char);
      const glow = centered(glowLayer, entry.glow);
      const sharp = centered(sharpLayer, entry.sharp);
      // Keyword colour: Folia's own (the theme's wordColors) when the theme has them, as every
      // builtin mode shows them; otherwise the director's keyword in the accent colour.
      const ranged = line.colorRanges?.find((range) => line.offsets[g.ci] >= range.start && line.offsets[g.ci] < range.end);
      const isKeyword = line.colorRanges ? Boolean(ranged) : shot.keyword && g.line === shot.keyword.line && g.ci >= shot.keyword.charIndex && g.ci < shot.keyword.charIndex + shot.keyword.length;
      const piece = pieces[g.piece];
      const timing = line.timings[g.ci] ?? { start: line.item.start, end: line.item.end };
      const glyph = {
        g,
        sharp,
        glow,
        timing,
        id: (hashString(shot.id) + i * 7919) | 0,
        r1: hash01(hashString(shot.id), i, 1),
        r2: hash01(hashString(shot.id), i, 2),
        r3: hash01(hashString(shot.id), i, 3),
        cx: (piece.x - g.x) / g.size,
        cy: (piece.y - g.y) / g.size,
        rank: rankOf[i],
        baseTint: ranged ? ranged.color : isKeyword ? colors.accentNumber : colors.ink,
        glowTint: colors.glow,
        dim: pools.dim,
        glowScale: isKeyword ? 1.1 : 0.85,
        scaleBase: g.size / (big ? bigSize : smallSize),
        pastAt: pastAt[g.line],
        pastFade: shot.pastFade,
      };
      // A word shot's word travels in from its own side as it settles (商籁).
      glyph.offX = piece.enterX ?? 0;
      glyph.offY = piece.enterY ?? 0;
      if (printed) {
        glyph.shadow = centered(shadowLayer, entry.sharp);
        glyph.shadow.tint = colors.daylight ? colors.ink : 0x000000;
      }
      glyph.enterAt = shot.mode === 'sung' ? Math.max(lineShow[g.line], timing.start - enterDuration * 0.55) : lineShow[g.line] + glyph.rank * staggerOf[g.line];
      glyph.exitAt = shot.exitStart + exitRank[i] * exitStagger;
      glow.tint = colors.glow;
      sharp.tint = glyph.baseTint;
      if (useRgb) {
        glyph.red = centered(rgbLayer, entry.sharp);
        glyph.blue = centered(rgbLayer, entry.sharp);
        glyph.red.tint = 0xff3355;
        glyph.blue.tint = 0x33d0ff;
      }
      if (useGhost) {
        glyph.ghosts = [centered(rgbLayer, entry.sharp), centered(rgbLayer, entry.sharp)];
        for (const ghost of glyph.ghosts) ghost.tint = glyph.baseTint;
      }
      glyph.scrambleTextures = shot.enter === 'scramble' ? SCRAMBLE.map((c) => atlas.get(c)?.sharp).filter(Boolean) : null;
      glyph.sharpTexture = entry.sharp;
      return glyph;
    });

    lap('sprites');
    yield;
    const exitEnd = shot.exitStart + maxExitRank * exitStagger + exitSpec.dur;
    const heroPiece = pieces.find((p) => p.role === 'hero') ?? pieces[0];
    const mainPiece = pieces[0];
    // Per line: where it sits (the page camera follows it) and when it arrives and steps back.
    let last = { x: 0, y: 0 };
    const lineInfo = lines.map((line, li) => {
      const own = pieces.filter((p) => p.line === li);
      if (own.length) last = { x: own.reduce((sum, p) => sum + p.x, 0) / own.length, y: own[0].y };
      const enterAt = Math.min(Infinity, ...byLine[li].map((index) => glyphs[index].enterAt));
      return { ...last, at: line.item.start, enterAt: Number.isFinite(enterAt) ? enterAt : lineShow[li], pastAt: pastAt[li] };
    });
    for (const piece of pieces) {
      const own = piece.glyphs.map((index) => glyphs[index].timing);
      piece.first = Math.min(...own.map((timing) => timing.start));
      piece.last = Math.max(...own.map((timing) => timing.end));
    }
    // Each word's centre and the moment it is first sung, in order: the staff's notes use them.
    const wordInfo = pieces
      .map((p) => ({ x: p.x, y: p.y, at: Math.min(...p.glyphs.map((index) => glyphs[index].timing.start)) }))
      .sort((a, b) => a.at - b.at);
    const s = {
      shot,
      key: shot.id,
      wordInfo,
      root,
      back,
      front,
      glyphs,
      pieces,
      heroPiece,
      mainPiece,
      disposables,
      exitStart: shot.exitStart,
      exitEnd,
      enterDuration,
      lineInfo,
      shotIndexInParagraph,
      presence: (t) => smoothstep(shot.show, shot.show + 0.45, t) * (1 - smoothstep(shot.exitStart, shot.exitStart + 0.45, t)),
      decor: [],
    };
    if (env.settings().ornaments && heroPiece) {
      const ctx = { colors, fs, dpr, W, H };
      const kinds = [...shot.decor];
      if (shot.transIn === 'leak') kinds.push('leak');
      for (const kind of kinds) {
        const update = DECOR[kind]?.(s, ctx);
        if (update) s.decor.push(update);
        yield;
      }
    }
    lap('decor');
    env.layers.text.addChild(root);
    registerBursts(s);
    if (mark) (globalThis.__huajianLaps ??= []).push([shot.id, shot.layout, ...mark.slice(1).map(([n, at], i) => `${n} ${(at - mark[i][1]).toFixed(1)}`)]);
    return s;
  };

  /* Where a transition moves the frame along: its angle as a unit vector. */
  const along = (angle) => [Math.cos(angle ?? 0), Math.sin(angle ?? 0)];

  /* The wipe band (after 凝彩): a chevron of solid colour wider than the frame's diagonal sweeps
   * across, covering the old paragraph and uncovering the new one, a thin stripe of a second
   * colour trailing it. */
  let band = null;
  const poseBand = (t) => {
    const wipe = plan.wipes?.find((w) => t > w.t - 0.36 && t < w.t + 0.36);
    if (!wipe) {
      if (band) band.root.visible = false;
      return;
    }
    const { W, H } = env.metrics();
    const colors = env.colors();
    const key = `${W}x${H}`;
    if (!band || band.key !== key) {
      band?.root.destroy({ children: true });
      const diagonal = Math.hypot(W, H);
      const point = diagonal * 0.08;
      const length = diagonal + point * 2;
      const e = -diagonal / 2 - point;
      const n = diagonal / 2;
      const chevron = (from, to) => [from, -n, to, -n, to + point, 0, to, n, from, n, from + point, 0];
      const root = new PIXI.Container();
      const main = new PIXI.Graphics().poly(chevron(e, e + length)).fill({ color: 0xffffff });
      const stripe = new PIXI.Graphics().poly(chevron(e - length * 0.1, e - length * 0.04)).fill({ color: 0xffffff });
      root.addChild(stripe, main);
      env.layers.overlay.addChild(root);
      band = { key, root, main, stripe, length };
    }
    const q = clamp((t - (wipe.t - 0.36)) / 0.72);
    const amount = q < 0.5 ? easeInCubic(q * 2) : 1 + easeOutCubic((q - 0.5) * 2);
    const u = (amount - 1) * band.length * 1.12;
    const [dx, dy] = along(wipe.angle);
    band.root.visible = true;
    band.root.position.set(W / 2 + dx * u, H / 2 + dy * u);
    band.root.rotation = wipe.angle;
    band.main.tint = colors.particle(wipe.tone);
    band.stripe.tint = colors.particle(wipe.tone + 1);
  };

  /* The light leaving a line's characters, registered with its exact time and places. */
  const registerBursts = (s) => {
    const style = s.shot.accentWeather === 'fireworks' ? 'sparks'
      : s.shot.accentWeather === 'sparkler' || s.shot.weather === 'embers' ? 'embers'
        : s.shot.weather === 'none' ? null : 'motes';
    if (!style || s.shot.transOut === 'cutOut') return;
    const { W, H } = env.metrics();
    const colors = env.colors();
    const main = s.glyphs;
    const step = Math.max(1, Math.ceil(main.length / 20));
    env.particles.addGlyphBurst(`shot:${s.key}`, {
      t0: s.exitStart + 0.08,
      points: main.filter((_, i) => i % step === 0).map((glyph) => ({ x: W / 2 + glyph.g.x, y: H / 2 + glyph.g.y })),
      style,
      tint: style === 'sparks' ? colors.particle(s.shot.paragraph) : colors.accentNumber,
      seed: hashString(s.key),
    });
  };

  // ---------------------------------------------------------------- posing

  /*
   * How a piece of a 流光, 云阶 or 心象 shot moves as a whole (after Folia's classic, partita and
   * cadenza): a turn, a scale, a shift and an alpha, around the piece's centre. A sad song keeps a
   * third of each motion.
   */
  const pieceMotion = (shot, piece, t, out) => {
    const k = (shot.calm ? 0.3 : 1);
    const size = piece.size;
    const i = piece.order ?? piece.index;
    const sung = smoothstep(piece.first - 0.05, piece.first + 0.15, t);
    const passed = smoothstep(piece.last, piece.last + 0.6, t);
    out.rot = 0;
    out.scale = 1;
    out.dx = 0;
    out.dy = 0;
    out.alpha = 1;
    if (shot.layout === 'lyric') {
      // 流光: the line breathes; a unit lights up a little as it is sung and turns once it has been.
      out.dy = Math.sin(t * 1.1 + i * 1.7) * size * 0.035 * k;
      out.scale = 1 + 0.07 * k * bump(progress(t, piece.first - 0.05, Math.max(0.3, piece.last - piece.first + 0.3)));
      out.rot = (i % 2 === 0 ? 1 : -1) * 0.2 * k * passed;
    } else if (shot.layout === 'cloud') {
      // 云阶: a block waits small and faint, grows to full when sung, then tilts aside, odd and even in turn.
      const grow = shot.calm ? easeOutCubic(sung) : easeOutBack(sung, 1.4);
      out.scale = 0.85 + 0.15 * grow;
      out.alpha = 0.55 + 0.45 * sung;
      out.rot = (i % 2 === 0 ? 1 : -1) * 0.1 * k * passed;
    } else if (shot.layout === 'shards') {
      // 心象: a fragment waits turned aside, swells as it is sung, then drifts off; all of them swim.
      // Drifting off upward, a little to either side, so a fragment does not run into its neighbour.
      const angle = -Math.PI / 2 + ((i * 0.61) % 1.2 - 0.6);
      out.rot = 0.35 * k * (1 - sung);
      out.scale = (0.9 + 0.1 * sung) * (1 + 0.3 * k * bump(progress(t, piece.first - 0.05, Math.max(0.35, piece.last - piece.first + 0.3))));
      out.dx = Math.cos(angle) * size * 0.25 * passed * k + Math.sin(t * 1.2 + i) * size * 0.05 * k;
      out.dy = Math.sin(angle) * size * 0.25 * passed * k + Math.cos(t * 1.5 + i * 1.3) * size * 0.05 * k;
      out.alpha = 1 - 0.3 * passed;
    }
    return out;
  };
  const motionOut = { rot: 0, scale: 1, dx: 0, dy: 0, alpha: 1 };

  const hideGlyph = (glyph) => {
    glyph.sharp.visible = false;
    glyph.glow.visible = false;
    if (glyph.shadow) glyph.shadow.visible = false;
    if (glyph.red) glyph.red.visible = glyph.blue.visible = false;
    if (glyph.ghosts) glyph.ghosts[0].visible = glyph.ghosts[1].visible = false;
  };

  const placeSprite = (sprite, alpha, x, y, sx, sy, rotation, skew) => {
    sprite.visible = alpha > 0.003;
    if (!sprite.visible) return;
    sprite.position.set(x, y);
    sprite.scale.set(sx, sy);
    sprite.rotation = rotation;
    sprite.skew.x = skew;
    sprite.alpha = Math.min(1, alpha);
  };

  const poseCamera = (s, t, W, H) => {
    const { shot } = s;
    const life = progress(t, shot.show, Math.max(0.6, s.exitEnd - shot.show));
    const side = shot.mirror ? -1 : 1;
    s.transBlur = 0;
    let x = W / 2;
    let y = H / 2;
    let scale = 1;
    let rotation = 0;
    let alpha = 1;
    switch (shot.camera) {
      case 'drift': x += lerp(-1, 1, life) * W * 0.014 * side; y += lerp(1, -1, life) * H * 0.008; break;
      case 'push': scale *= 1 + 0.08 * easeInOutCubic(life); break;
      case 'pull': scale *= 1.1 - 0.1 * easeOutCubic(life); break;
      case 'pan': x += lerp(1, -1, easeInOutCubic(life)) * W * 0.035 * side; break;
      case 'rise': y += lerp(1, -1, easeInOutCubic(life)) * H * 0.035; break;
      case 'roll': rotation = lerp(-1, 1, easeInOutCubic(life)) * 0.035 * side; scale *= 1.03; break;
      case 'punch': {
        const hit = t >= shot.start - 0.03 ? 1 - easeOutExpo(progress(t, shot.start - 0.03, 0.5)) : 0;
        scale *= 1 + 0.13 * hit + 0.04 * life;
        break;
      }
      case 'focus':
        // A word shot: the camera sits a little close and pushes in slowly; it does not chase words.
        scale *= (shot.zoom ?? 1.04) + 0.03 * easeInOutCubic(life);
        x += lerp(-1, 1, life) * W * 0.006 * side;
        rotation += (shot.tilt ?? 0) * (1 - 0.5 * life);
        break;
      case 'fly': {
        // 浮名: the sheet is larger than the frame; the camera flies to each line as it is sung.
        const lines = s.lineInfo;
        let fx = lines[0].x;
        let fy = lines[0].y;
        for (let k = 1; k < lines.length; k += 1) {
          const e = easeInOutCubic(progress(t, lines[k].at - 0.45, 0.6));
          fx += (lines[k].x - fx) * e;
          fy += (lines[k].y - fy) * e;
        }
        scale *= 1.08;
        x -= fx * scale;
        y -= fy * scale;
        rotation += (shot.mirror ? -1 : 1) * 0.015 * Math.sin(life * Math.PI);
        break;
      }
      case 'track': {
        // A page: the view eases toward the line being sung and closes in slowly over the page.
        const lines = s.lineInfo;
        let fx = lines[0].x;
        let fy = lines[0].y;
        for (let k = 1; k < lines.length; k += 1) {
          const e = easeInOutCubic(progress(t, lines[k].at - 1, 1.8));
          fx += (lines[k].x - fx) * e;
          fy += (lines[k].y - fy) * e;
        }
        const vertical = shot.layout === 'vertical';
        // Only a drift toward the line being sung, slow enough not to read as the frame moving.
        x -= fx * (vertical ? 0.08 : 0.03);
        y -= fy * (vertical ? 0.02 : 0.08);
        scale *= 1 + 0.045 * easeInOutCubic(life);
        break;
      }
      default: break;
    }
    const enterP = progress(t, shot.show, 0.6);
    switch (shot.transIn) {
      case 'pushIn': scale *= 0.86 + 0.14 * easeOutCubic(enterP); break;
      case 'zoomIn': scale *= 1.4 - 0.4 * easeOutExpo(enterP); break;
      case 'whipIn': {
        const k = 1 - easeOutQuart(progress(t, shot.show, 0.42));
        x += shot.dir.x * W * 0.45 * k;
        y += shot.dir.y * H * 0.45 * k;
        break;
      }
      case 'drift': x += side * W * 0.06 * (1 - easeOutCubic(enterP)); break;
      case 'panIn': {
        // The whole frame pans: the new paragraph slides in from where the old one slid away.
        const k = 1 - easeInOutCubic(progress(t, shot.show, 0.7));
        const [ax, ay] = along(shot.angle);
        x += ax * W * k;
        y += ay * H * k;
        alpha *= smoothstep(0, 0.15, 1 - k);
        break;
      }
      case 'blurIn': {
        const e = easeOutCubic(progress(t, shot.show, 0.6));
        const [ax, ay] = along(shot.angle);
        x -= ax * W * 0.04 * (1 - e);
        y -= ay * H * 0.04 * (1 - e);
        scale *= 1 + 0.06 * (1 - e);
        s.transBlur = Math.max(s.transBlur, 1 - e);
        break;
      }
      case 'wipeIn': if (t < shot.wipeAt) alpha = 0; break;
      case 'flick': {
        // 商籁's quick blur: a fifth of a second from soft to sharp.
        const e = easeOutCubic(progress(t, shot.show, 0.22));
        s.transBlur = Math.max(s.transBlur, 1 - e);
        scale *= 1 + 0.05 * (1 - e);
        alpha *= 0.25 + 0.75 * e;
        break;
      }
      default: break;
    }
    const outP = progress(t, shot.exitStart, 0.5);
    switch (shot.transOut) {
      case 'pushOut': scale *= 1 + 0.4 * easeInCubic(outP); alpha *= 1 - easeInCubic(outP); break;
      case 'whipOut': {
        const k = easeInQuart(progress(t, shot.exitStart, 0.38));
        x -= shot.nextDir.x * W * 0.45 * k;
        y -= shot.nextDir.y * H * 0.45 * k;
        break;
      }
      case 'cutOut': if (t > shot.exitStart + 0.03) alpha = 0; break;
      case 'panOut': {
        const k = easeInOutCubic(progress(t, shot.exitStart, 0.7));
        const [ax, ay] = along(shot.angle);
        x -= ax * W * k;
        y -= ay * H * k;
        alpha *= 1 - smoothstep(0.85, 1, k);
        break;
      }
      case 'blurOut': {
        const e = easeInCubic(progress(t, shot.exitStart, 0.5));
        const [ax, ay] = along(shot.angle);
        x += ax * W * 0.04 * e;
        y += ay * H * 0.04 * e;
        scale *= 1 + 0.06 * e;
        alpha *= 1 - smoothstep(0.55, 1, e);
        s.transBlur = Math.max(s.transBlur, e);
        break;
      }
      case 'wipeOut': if (t >= shot.wipeAt) alpha = 0; break;
      case 'flickOut': {
        const e = easeInCubic(progress(t, shot.exitStart, 0.22));
        s.transBlur = Math.max(s.transBlur, e);
        alpha *= 1 - e;
        break;
      }
      default: break;
    }
    s.root.position.set(x, y);
    s.root.scale.set(scale);
    s.root.rotation = rotation;
    s.root.alpha = alpha;
    s.root.visible = alpha > 0.003;
  };

  const poseShot = (s, t, frame) => {
    const { W, H } = env.metrics();
    if (t < s.shot.show - 0.05) {
      s.root.visible = false;
      return;
    }
    poseCamera(s, t, W, H);
    if (!s.root.visible) return;
    const { shot } = s;
    const enterSpec = ENTER[shot.enter] ?? ENTER.rise;
    const exitSpec = EXIT[shot.exit] ?? EXIT.dissolve;
    const sing = SING[shot.sing] ?? SING.glow;
    const daylight = env.colors().daylight;
    const glowScale = daylight ? 0.3 : 1;
    const motion = frame.motion;
    const g = { t, id: 0, r1: 0, r2: 0, r3: 0, cx: 0, cy: 0, dirX: shot.dir.x, dirY: shot.dir.y };
    const moving = MOVING_KINDS.includes(shot.layout);
    for (const glyph of s.glyphs) {
      const o = resetTransform(tmp);
      g.id = glyph.id;
      g.r1 = glyph.r1;
      g.r2 = glyph.r2;
      g.r3 = glyph.r3;
      g.cx = glyph.cx;
      g.cy = glyph.cy;
      let sungness = 0;
      const enterP = (t - glyph.enterAt) / s.enterDuration;
      if (enterP < 0) {
        hideGlyph(glyph);
        continue;
      }
      if (enterP < 1) enterSpec.fn(enterP, g, o);
      const since = t - glyph.timing.start;
      const duration = Math.max(0.12, glyph.timing.end - glyph.timing.start);
      if (since >= 0) {
        sing(since, duration, o, g);
        sungness = easeOutCubic(clamp(since / Math.min(0.5, Math.max(0.16, duration))));
      }
      // A page line that has been sung steps back so the current one leads.
      const past = t > glyph.pastAt ? smoothstep(glyph.pastAt, glyph.pastAt + 0.7, t) : 0;
      const exitP = (t - glyph.exitAt) / exitSpec.dur;
      if (exitP >= 1) {
        hideGlyph(glyph);
        continue;
      }
      if (exitP > 0) exitSpec.fn(exitP, g, o);
      if (s.transBlur > 0) o.blur = Math.max(o.blur, s.transBlur);

      // Motion strength: the user's setting scales displacement, never the timing.
      const size = glyph.g.size;
      const dx = o.dx * size * motion;
      const dy = o.dy * size * motion;
      const pulse = sungness > 0 ? 1 + 0.06 * frame.pulse : 1;
      let sx = glyph.scaleBase * (1 + (o.sx - 1) * motion) * pulse;
      let sy = glyph.scaleBase * (1 + (o.sy - 1) * motion) * pulse;
      let rotation = glyph.g.rotation + o.rot * motion;
      const travel = enterP < 1 ? (1 - easeOutCubic(enterP)) * motion : 0;
      let x = glyph.g.x + dx + glyph.offX * travel;
      let y = glyph.g.y + dy + glyph.offY * travel;
      let pieceAlpha = 1;
      if (moving) {
        // The piece moves as one: the glyph turns and scales about the piece's centre.
        const piece = s.pieces[glyph.g.piece];
        const m = pieceMotion(shot, piece, t, motionOut);
        const c = Math.cos(m.rot * motion);
        const n = Math.sin(m.rot * motion);
        const px = x - piece.x;
        const py = y - piece.y;
        x = piece.x + m.dx * motion + (px * c - py * n) * m.scale;
        y = piece.y + m.dy * motion + (px * n + py * c) * m.scale;
        rotation += m.rot * motion;
        sx *= m.scale;
        sy *= m.scale;
        pieceAlpha = m.alpha;
      }
      const dim = glyph.dim;
      const blur = clamp(o.blur);
      const visibility = o.alpha * pieceAlpha * (dim + (1 - dim) * sungness) * (1 - (glyph.pastFade ?? 0.6) * past);
      placeSprite(glyph.sharp, visibility * (1 - 0.4 * blur), x, y, sx, sy, rotation, o.skew);
      if (glyph.shadow) placeSprite(glyph.shadow, visibility * (1 - blur) * (daylight ? 0.18 : 0.34), x + size * 0.06, y + size * 0.08, sx, sy, rotation, o.skew);
      const glowAlpha = o.alpha * (o.glow + blur * 0.5 + (sungness > 0 ? 0.1 + 0.1 * frame.level : 0)) * glyph.glowScale * glowScale * (1 - past);
      const glowScaleUp = (1 + 0.15 * blur) / GLOW_RES;
      placeSprite(glyph.glow, glowAlpha, x, y, sx * glowScaleUp, sy * glowScaleUp, rotation, o.skew);
      glyph.sharp.tint = o.tint > 0 ? mixNumber(glyph.baseTint, env.colors().accentNumber, o.tint) : glyph.baseTint;
      if (o.scramble && glyph.scrambleTextures?.length) {
        glyph.sharp.texture = glyph.scrambleTextures[o.scramble % glyph.scrambleTextures.length];
      } else if (glyph.sharp.texture !== glyph.sharpTexture) {
        glyph.sharp.texture = glyph.sharpTexture;
      }
      if (glyph.red) {
        const split = o.rgb * size * 0.12;
        placeSprite(glyph.red, visibility * o.rgb * 0.8, x + split, y, sx, sy, rotation, o.skew);
        placeSprite(glyph.blue, visibility * o.rgb * 0.8, x - split, y, sx, sy, rotation, o.skew);
      }
      if (glyph.ghosts) {
        // Motion trail: copies behind the direction of travel.
        const trailX = -Math.sign(o.dx || shot.dir.x) * size * 0.55 * o.ghost;
        const trailY = -Math.sign(o.dy || shot.dir.y) * size * 0.55 * o.ghost * (shot.dir.y ? 1 : 0);
        placeSprite(glyph.ghosts[0], visibility * 0.22 * o.ghost, x + trailX, y + trailY, sx, sy, rotation, o.skew);
        placeSprite(glyph.ghosts[1], visibility * 0.1 * o.ghost, x + trailX * 2, y + trailY * 2, sx, sy, rotation, o.skew);
      }
    }
    for (const update of s.decor) update(t, s);
  };

  /* Screen effects the shots on stage ask for at time t (deterministic: from their own times). */
  const effectsAt = (t) => {
    let flash = 0;
    let rgb = 0;
    let distort = 0;
    for (const s of live.values()) {
      const { shot } = s;
      if (!shot) continue;
      if (shot.transIn === 'flash' && t >= shot.start - 0.06) flash = Math.max(flash, 0.5 * Math.exp(-(t - shot.start + 0.06) / 0.11));
      if (shot.transIn === 'glitch' && t >= shot.show) rgb = Math.max(rgb, 0.03 * Math.exp(-(t - shot.show) / 0.16));
      if (shot.transIn === 'whipIn') rgb = Math.max(rgb, 0.012 * bump(progress(t, shot.show, 0.42)));
      if (shot.transIn === 'zoomIn') distort = Math.max(distort, 0.35 * (1 - easeOutExpo(progress(t, shot.show, 0.6))) * (t >= shot.show ? 1 : 0));
      if (shot.transOut === 'pushOut') distort = Math.max(distort, 0.3 * easeInCubic(progress(t, shot.exitStart, 0.5)) * (t < shot.exitStart + 0.5 ? 1 : 0));
      if (shot.enter === 'glitch' && t >= shot.show) rgb = Math.max(rgb, 0.008 * Math.exp(-(t - shot.show) / 0.3));
    }
    return { flash, rgb, distort };
  };

  // ---------------------------------------------------------------- title card

  const buildTitle = () => {
    const title = plan.title;
    const { W, H, fs, dpr } = env.metrics();
    const colors = env.colors();
    const root = new PIXI.Container();
    const front = new PIXI.Container();
    root.addChild(front);
    env.layers.text.addChild(root);
    const disposables = [];
    const entries = [];
    const add = (text, size, fontCss, y, delay, alpha, spacing) => {
      if (!text) return;
      const texture = createLabelTexture(text, { font: fontCss, size, dpr, letterSpacing: size * spacing });
      disposables.push(texture);
      env.upload(texture.source);
      const sprite = centered(front, texture);
      sprite.tint = colors.ink;
      entries.push({ sprite, y, delay, alpha, size, chars: Array.from(text).length });
    };
    const name = String(song?.title ?? '').trim();
    const nameSize = fs * 0.66;
    add(name, nameSize, `500 ${nameSize.toFixed(2)}px ${fonts().display}`, H * 0.44, 0, 0.95, 0.34);
    add(String(song?.artist ?? '').trim(), fs * 0.3, fontAt(400)(fs * 0.3), H * 0.44 + fs * 0.98, 0.45, 0.6, 0.3);
    title.credits.slice(0, 4).forEach((index, i) => add(analysis.items[index]?.text ?? '', fs * 0.24, fontAt(400)(fs * 0.24), H * 0.64 + i * fs * 0.46, 0.9 + i * 0.15, 0.42, 0.12));
    const rule = whiteSprite(front);
    const update = (t) => {
      for (const entry of entries) {
        const p = progress(t, title.show + entry.delay, 1.6);
        const a = smoothstep(title.show + entry.delay, title.show + entry.delay + 1, t) * (1 - smoothstep(title.end - 0.9, title.end, t));
        entry.sprite.visible = a > 0.003;
        entry.sprite.position.set(W / 2, entry.y + (1 - easeOutCubic(p)) * fs * 0.3);
        // Tracking closes in as the title settles.
        entry.sprite.scale.set(1.12 - 0.12 * easeOutExpo(p), 1);
        entry.sprite.alpha = entry.alpha * a;
      }
      const draw = easeOutExpo(progress(t, title.show + 0.3, 1.8));
      poseBar(rule, W / 2, H * 0.44 + fs * 0.56, fs * 3.2 * draw, 1, 0.38 * (1 - smoothstep(title.end - 0.9, title.end, t)) * smoothstep(title.show, title.show + 0.5, t), colors.ink);
    };
    return { key: 'title', root, disposables, update, exitEnd: title.end + 0.1 };
  };

  const jobs = new Map();
  const failed = new Set();
  const SLICE_MS = 3;
  /* Drops a half-built shot (a seek, a resize): whatever it already made is released. */
  const abandon = (key, job) => {
    job.steps.return?.();
    job.root?.destroy({ children: true });
    for (const item of job.disposables) item.destroy?.(true);
    jobs.delete(key);
  };

  const destroy = (s) => {
    s.root.destroy({ children: true });
    for (const item of s.disposables) item.destroy?.(true);
  };

  // ---------------------------------------------------------------- public

  return {
    setPlan(nextPlan, nextAnalysis, nextSong, now = -Infinity) {
      // Shots already on screen keep their recipe; the ones not yet shown are rebuilt.
      for (const [key, s] of live) {
        if (key === 'title') continue;
        if (now < (s.shot?.show ?? s.show)) {
          destroy(s);
          live.delete(key);
        }
      }
      for (const [key, job] of jobs) abandon(key, job);
      failed.clear();
      plan = nextPlan;
      analysis = nextAnalysis;
      song = nextSong;
    },

    rebuild() {
      for (const s of live.values()) destroy(s);
      live.clear();
      for (const [key, job] of jobs) abandon(key, job);
      clearAtlases();
      band?.root.destroy({ children: true });
      band = null;
    },

    onSeek() {
      for (const s of live.values()) if (s.shot) registerBursts(s);
    },

    /** Poses every shot on stage at time t; returns the screen effects they ask for. */
    update(t, frame) {
      if (!plan) return { flash: 0, rgb: 0, distort: 0 };
      const wanted = new Map();
      if (plan.title && t >= plan.title.show - BUILD_AHEAD && t <= plan.title.end + 0.2) wanted.set('title', null);
      const counts = new Map();
      for (const shot of plan.shots) {
        const k = counts.get(shot.paragraph) ?? 0;
        counts.set(shot.paragraph, k + 1);
        if (shot.show - BUILD_AHEAD > t) break;
        // The same bound decides "still needed" whether or not the shot is built (a shot's exit
        // staggers at most 0.4 s), so a finished shot is never rebuilt and dropped again.
        if (t <= endOf(shot)) wanted.set(shot.id, { shot, k, show: shot.show });
      }
      for (const [key, s] of live) {
        if (!wanted.has(key)) {
          destroy(s);
          live.delete(key);
        }
      }
      for (const [key, job] of jobs) {
        if (!wanted.has(key)) abandon(key, job);
      }
      // Builds run a few milliseconds per frame, the earliest shot first; a shot that is due now is
      // finished at once (that only happens after a seek or a very short gap).
      let started = false;
      for (const [key, value] of wanted) {
        if (live.has(key) || failed.has(key)) continue;
        if (key === 'title') {
          live.set(key, buildTitle());
          continue;
        }
        const due = t >= value.show - 0.3;
        if (!due && started) continue;
        started = true;
        let job = jobs.get(key);
        if (!job) {
          job = { root: null, disposables: [], spent: 0 };
          job.steps = buildShotSteps(value.shot, value.k, job);
          jobs.set(key, job);
        }
        const sliceStart = performance.now();
        const until = due ? Infinity : sliceStart + SLICE_MS;
        let step;
        try {
          do {
            const stepAt = globalThis.__HUAJIAN_DEBUG__ ? performance.now() : 0;
            step = job.steps.next();
            if (stepAt && performance.now() - stepAt > 4) (globalThis.__huajianHeavySteps ??= []).push([key, +(performance.now() - stepAt).toFixed(1), job.label ?? ""]);
          } while (!step.done && performance.now() < until);
        } catch (error) {
          // A shot that cannot be built is skipped (its line simply does not appear) rather than
          // leaving a broken job that would fail again every frame.
          abandon(key, job);
          failed.add(key);
          env.onError?.(error);
          continue;
        }
        job.spent += performance.now() - sliceStart;
        if (step.done) {
          jobs.delete(key);
          live.set(key, step.value);
          if (globalThis.__HUAJIAN_DEBUG__) (globalThis.__huajianBuilds ??= []).push([key, +job.spent.toFixed(1), +t.toFixed(2)]);
        }
      }
      for (const s of live.values()) {
        if (s.shot) poseShot(s, t, frame);
        else s.update(t);
      }
      poseBand(t);
      return effectsAt(t);
    },

    /** What is built and being built, for the diagnostic record. */
    debugState() {
      return { live: [...live.keys()], building: [...jobs.keys()], atlases: atlases.size };
    },

    /** The shot whose words are on screen now (for the director overlay). */
    current(t) {
      let found = null;
      for (const s of live.values()) if (s.shot && t >= s.shot.show && t < s.exitStart) found = s.shot;
      return found;
    },

    destroy() {
      this.rebuild();
    },
  };
};
return { createShots };
})();

// ---- src/post.mjs
const __post = (() => {
// One full-screen pass over the camera layer: radial chromatic aberration, a
// flash and a touch of barrel distortion. It is switched off whenever all three
// are at rest, so calm passages pay nothing for it.


const vertex = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const fragment = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uInputClamp;
uniform float uRgb;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDistort;

vec4 sampleAt(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    // Screen-space uv (0..1 over the filtered area) and back to texture space.
    vec2 toTexture = uOutputFrame.zw * uInputSize.zw;
    vec2 screen = vTextureCoord / toTexture;
    vec2 d = screen - 0.5;
    float r2 = dot(d, d);
    vec2 warped = 0.5 + d * (1.0 - uDistort * r2);
    vec2 base = warped * toTexture;
    vec2 offset = d * uRgb * toTexture;
    vec4 c = sampleAt(base);
    vec4 red = sampleAt(base + offset);
    vec4 blue = sampleAt(base - offset);
    vec4 color = vec4(red.r, c.g, blue.b, max(c.a, max(red.a, blue.a)));
    // Premultiplied: a flash adds light and opacity together.
    color.rgb += uFlashColor * uFlash;
    color.a = max(color.a, uFlash);
    finalColor = color;
}
`;

const createPost = () => {
  const uniforms = new PIXI.UniformGroup({
    uRgb: { value: 0, type: 'f32' },
    uFlash: { value: 0, type: 'f32' },
    uFlashColor: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
    uDistort: { value: 0, type: 'f32' },
  });
  const filter = new PIXI.Filter({
    glProgram: PIXI.GlProgram.from({ vertex, fragment, name: 'huajian-post' }),
    resources: { postUniforms: uniforms },
    // PixiJS filters render at resolution 1 by default: on a high-DPI screen every transition and
    // beat would blur the whole text layer for a moment. Render at the screen's own resolution.
    resolution: 'inherit',
    antialias: 'inherit',
  });
  filter.enabled = false;
  const values = uniforms.uniforms;
  return {
    filter,
    /** `rgb` is a fraction of the screen, `flash` 0..1, `distort` about 0..0.4. */
    set({ rgb = 0, flash = 0, distort = 0, flashColor }) {
      values.uRgb = rgb;
      values.uFlash = Math.min(1, flash);
      values.uDistort = distort;
      if (flashColor) values.uFlashColor.set(flashColor);
      filter.enabled = rgb > 0.0004 || flash > 0.004 || Math.abs(distort) > 0.004;
    },
    destroy() {
      filter.destroy();
    },
  };
};
return { createPost };
})();

// ---- src/audio.mjs
const __audio = (() => {
// The live ear: loudness normalized to the song (Folia's getPower has a narrow
// range, so absolute values say little) and onsets from low-end spectral flux.
// The plan already knows the song's shape; this only adds the moment-to-moment
// swell and the hits that a planned schedule cannot know.

const { clamp } = __motion;

const LOW_BIN_START = 1;   // ~21 Hz per bin at the host's FFT size
const LOW_BIN_END = 12;    // up to ~260 Hz: kick and bass
const TRACK_SEC = 1.2;     // how fast the onset threshold follows the music
const MIN_GAP_SEC = 0.22;  // fastest onset cadence
const FLOOR = 0.012;       // flux below this is never an onset

const createEar = () => {
  let previousBins = null;
  let previousLow = 0;
  let mean = 0;
  let variance = 0;
  let lastOnset = -Infinity;
  let peak = 0.3;
  let valley = 0.2;
  let level = 0.5;
  const reading = { level: 0.5, onset: 0, bass: 0, treble: 0, active: false };

  const lowFlux = (audio) => {
    const spectrum = audio.getSpectrum?.();
    if (spectrum && spectrum.length > LOW_BIN_END) {
      const count = LOW_BIN_END - LOW_BIN_START + 1;
      if (!previousBins) previousBins = new Float32Array(count);
      let flux = 0;
      for (let i = 0; i < count; i += 1) {
        const value = spectrum[LOW_BIN_START + i] / 255;
        flux += Math.max(0, value - previousBins[i]);
        previousBins[i] = value;
      }
      return flux / count;
    }
    const bands = audio.getBands();
    const low = 0.7 * bands.bass + 0.3 * bands.lowMid;
    const flux = Math.max(0, low - previousLow);
    previousLow = low;
    return flux;
  };

  return {
    reset() {
      previousBins = null;
      previousLow = 0;
      mean = 0;
      variance = 0;
      lastOnset = -Infinity;
    },

    /** Reads the analyser at song time `time`, `dt` seconds after the previous reading. */
    step(audio, time, dt) {
      reading.onset = 0;
      if (!audio || dt <= 0) return reading;
      const bands = audio.getBands();
      const raw = 0.55 * audio.getPower() + 0.25 * bands.vocal + 0.2 * bands.bass;
      // Song-relative loudness: where `raw` sits between a slow peak and a slow valley.
      peak = Math.max(raw, peak - dt * 0.02, valley + 0.05);
      valley = Math.min(raw, valley + dt * 0.015);
      const target = clamp((raw - valley) / Math.max(0.05, peak - valley));
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.08 : 0.6)));
      reading.level = level;
      reading.bass = bands.bass;
      reading.treble = bands.treble;
      reading.active = raw > 0.01;

      const flux = lowFlux(audio);
      const alpha = 1 - Math.exp(-dt / TRACK_SEC);
      const deviation = Math.sqrt(Math.max(variance, 0));
      const threshold = Math.max(FLOOR, mean + 1.8 * deviation);
      if (flux > threshold && time - lastOnset >= MIN_GAP_SEC) {
        reading.onset = clamp((flux - threshold) / Math.max(1e-3, 3 * deviation + 0.01));
        lastOnset = time;
      }
      mean += alpha * (flux - mean);
      variance += alpha * ((flux - mean) ** 2 - variance);
      return reading;
    },

    /** A neutral reading for previews and hosts without audio. */
    idle() {
      reading.onset = 0;
      reading.level = 0.5;
      reading.active = false;
      return reading;
    },
  };
};
return { createEar };
})();

// ---- src/rhythm.mjs
const __rhythm = (() => {
// Listens to the whole song while it plays and works out its tempo (BPM, with
// the beat grid's phase) and its key (tonic and major/minor). Everything comes
// from the host's public analyser (ctx.audio), so it works for local and online
// songs alike, with no download.
//
// Tempo: the spectral flux of each frame is laid on a 50 Hz grid indexed by
// song time (so seeking and replays add to the same record), then the grid is
// autocorrelated. The estimator follows bpm-style-director's (MIT, LingShiQwQ):
// detrend, compress, autocorrelate, and prefer a faster harmonic only when it
// is nearly as periodic.
// Key: the analyser's bins from ~500 Hz to ~4 kHz are folded into 12 pitch
// classes over the whole song and correlated with the Krumhansl–Kessler key
// profiles. Both are estimates; each comes with a confidence.

const GRID_HZ = 50;
const MAX_CELLS = GRID_HZ * 900;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const correlate = (a, b) => {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.max(1e-12, Math.sqrt(da * db));
};

/** The key a 12-bin chroma vector correlates best with. */
const keyOf = (chroma) => {
  const scores = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = Array.from({ length: 12 }, (_, pc) => chroma[(pc + tonic) % 12]);
    scores.push({ tonic, mode: 'major', r: correlate(rotated, MAJOR) });
    scores.push({ tonic, mode: 'minor', r: correlate(rotated, MINOR) });
  }
  scores.sort((a, b) => b.r - a.r);
  const [best, second] = scores;
  // The relative key (C major / A minor) shares its notes: a close call between those two
  // still knows the key's notes, it is only the mode that is unsure.
  const relative = (best.mode === 'major' ? (best.tonic + 9) % 12 : (best.tonic + 3) % 12) === second.tonic && best.mode !== second.mode;
  // A flat chroma (noise, drums, no clear notes) still correlates with some key: confidence also
  // needs the pitch classes to stand apart (their coefficient of variation).
  const mean = chroma.reduce((s, v) => s + v, 0) / 12;
  const spread = Math.sqrt(chroma.reduce((s, v) => s + (v - mean) ** 2, 0) / 12) / Math.max(1e-9, mean);
  const tonal = Math.max(0, Math.min(1, (spread - 0.08) / 0.2));
  return {
    key: NAMES[best.tonic],
    mode: best.mode,
    keyConfidence: Math.max(0, Math.min(1, best.r * 1.2)) * tonal,
    modeConfidence: Math.max(0, Math.min(1, (relative ? best.r - second.r : best.r - scores.find((s) => s.mode !== best.mode).r) * 6)) * tonal,
  };
};

/**
 * Tempo from a novelty curve sampled at `rate` Hz (`mask` marks the cells that were heard).
 * Returns `{ bpm, confidence, phase, downbeat }` (phase and downbeat in seconds) or null.
 */
const tempoOf = (novelty, mask, rate) => {
  const n = novelty.length;
  const heard = mask.reduce((s, v) => s + (v ? 1 : 0), 0);
  if (heard < rate * 12) return null;
  // Detrend against a ±0.35 s mean and compress big transients.
  const env = new Float64Array(n);
  const radius = Math.ceil(rate * 0.35);
  let window = 0;
  let count = 0;
  for (let i = 0; i < Math.min(n, radius); i += 1) {
    window += novelty[i];
    count += 1;
  }
  for (let i = 0; i < n; i += 1) {
    const add = i + radius;
    const drop = i - radius - 1;
    if (add < n) {
      window += novelty[add];
      count += 1;
    }
    if (drop >= 0) {
      window -= novelty[drop];
      count -= 1;
    }
    env[i] = mask[i] ? Math.sqrt(Math.max(0, novelty[i] - (0.7 * window) / count)) : 0;
  }
  let mean = 0;
  for (let i = 0; i < n; i += 1) if (mask[i]) mean += env[i];
  mean /= heard;
  for (let i = 0; i < n; i += 1) env[i] = mask[i] ? env[i] - mean : 0;
  // A light [1 2 1] blur: a period that is not a whole number of cells splits each pulse
  // between two cells, which otherwise makes twice the period correlate better.
  const raw = Float64Array.from(env);
  for (let i = 1; i < n - 1; i += 1) env[i] = mask[i] ? 0.25 * raw[i - 1] + 0.5 * raw[i] + 0.25 * raw[i + 1] : 0;

  const minLag = Math.floor((60 * rate) / 220);
  const maxLag = Math.ceil((60 * rate) / 45);
  const corr = new Float64Array(maxLag + 2);
  for (let lag = Math.max(2, minLag - 1); lag <= maxLag + 1; lag += 1) {
    let cross = 0;
    let a = 0;
    let b = 0;
    for (let i = lag; i < n; i += 1) {
      if (!mask[i] || !mask[i - lag]) continue;
      cross += env[i] * env[i - lag];
      a += env[i] * env[i];
      b += env[i - lag] * env[i - lag];
    }
    corr[lag] = cross / Math.max(1e-10, Math.sqrt(a * b));
  }
  const peaks = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (corr[lag] <= corr[lag - 1] || corr[lag] < corr[lag + 1] || corr[lag] < 0.1) continue;
    const a = corr[lag - 1];
    const b = corr[lag];
    const c = corr[lag + 1];
    const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c || 1)));
    const bpm = (60 * rate) / (lag + delta);
    if (bpm >= 45 && bpm <= 220) peaks.push({ bpm, lag: lag + delta, strength: b });
  }
  if (!peaks.length) return null;
  peaks.sort((x, y) => y.strength - x.strength);
  const strong = peaks.filter((p) => p.strength >= peaks[0].strength * 0.88 && p.bpm >= 65 && p.bpm <= 200);
  let best = strong.length ? strong.sort((x, y) => y.bpm - x.bpm)[0] : peaks[0];
  // Below 70 BPM, a well-supported double tempo is the beat people tap.
  if (best.bpm < 70) {
    const double = peaks.find((p) => Math.abs(p.bpm / 2 - best.bpm) / best.bpm < 0.04 && p.strength >= best.strength * 0.6);
    if (double) best = double;
  }
  const rival = peaks.find((p) => Math.abs(p.bpm - best.bpm) / best.bpm > 0.08
    && Math.abs(p.bpm * 2 - best.bpm) / best.bpm > 0.08 && Math.abs(p.bpm / 2 - best.bpm) / best.bpm > 0.08);
  const contrast = rival ? Math.max(0, best.strength - rival.strength) : best.strength;
  const confidence = Math.min(1, Math.max(0, best.strength * 0.8 + Math.min(0.2, contrast)));

  // Refine: the period within ±1.5 % whose beat comb lines up best with every accent heard
  // (the magnitude of the accents' Fourier component at that rate). Over a whole song this
  // pins the tempo far finer than one grid cell, and its angle gives the beat phase.
  const accents = [];
  for (let i = 0; i < n; i += 1) if (mask[i] && env[i] > 0) accents.push(i, env[i]);
  let period = best.lag;
  let phaseCells = 0;
  let bestPower = -1;
  for (let step = -50; step <= 50; step += 1) {
    const candidate = best.lag * (1 + step * 0.0003);
    let re = 0;
    let im = 0;
    for (let k = 0; k < accents.length; k += 2) {
      const angle = (2 * Math.PI * accents[k]) / candidate;
      re += accents[k + 1] * Math.cos(angle);
      im += accents[k + 1] * Math.sin(angle);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      period = candidate;
      phaseCells = ((((Math.atan2(im, re) / (2 * Math.PI)) * candidate) % candidate) + candidate) % candidate;
    }
  }
  const bars = new Float64Array(4);
  // Downbeat: which beat of four carries the most weight.
  for (let i = 0; i < n; i += 1) {
    if (!mask[i] || env[i] <= 0) continue;
    const beat = Math.round((i - phaseCells) / period);
    if (Math.abs(i - phaseCells - beat * period) < period * 0.15) bars[((beat % 4) + 4) % 4] += env[i];
  }
  const downbeatIndex = bars.indexOf(Math.max(...bars));
  return {
    bpm: Math.round(((60 * rate) / period) * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    phase: phaseCells / rate,
    downbeat: (phaseCells + downbeatIndex * period) / rate,
    alternatives: peaks.slice(0, 4).map((p) => [Math.round(p.bpm * 10) / 10, Math.round(p.strength * 100) / 100]),
  };
};

let deviceRate = null;
const sampleRate = () => {
  if (deviceRate) return deviceRate;
  try {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    const context = new Context();
    deviceRate = context.sampleRate;
    context.close?.();
  } catch {
    deviceRate = 44100;
  }
  return deviceRate;
};

/**
 * One song's listener. `feed` on every played frame; `estimate` whenever a
 * reading is wanted; `snapshot` / `restore` keep what was learned across plays.
 */
const createRhythm = ({ rate = null } = {}) => {
  let novelty = new Float32Array(GRID_HZ * 240);
  let mask = new Uint8Array(novelty.length);
  let previous = null;
  const chroma = new Float64Array(12);
  let chromaFrames = 0;
  let powerSum = 0;
  let powerFrames = 0;
  let pitchBins = null;
  let fluxEnd = 0;
  let linear = new Float64Array(0);
  const frame = new Float64Array(12);

  const grow = (cells) => {
    if (cells <= novelty.length || cells > MAX_CELLS) return cells <= novelty.length;
    const size = Math.min(MAX_CELLS, Math.max(cells, novelty.length * 2));
    const next = new Float32Array(size);
    next.set(novelty);
    novelty = next;
    const nextMask = new Uint8Array(size);
    nextMask.set(mask);
    mask = nextMask;
    return true;
  };

  /* For every note from C5 to B7 (~520 Hz–4 kHz; coarser bins below blur semitones), the one bin
   * nearest its pitch. One bin per note keeps the twelve pitch classes equally sampled, so noise
   * does not lean toward whichever classes own more bins. */
  const mapBins = (length) => {
    const binHz = (rate ?? sampleRate()) / 2 / length;
    pitchBins = [];
    for (let midi = 72; midi <= 107; midi += 1) {
      const bin = Math.round((440 * 2 ** ((midi - 69) / 12)) / binHz);
      if (bin >= 5 && bin < length - 5) pitchBins.push([bin, midi % 12]);
    }
    fluxEnd = Math.min(length, Math.round(5000 / binHz));
    linear = new Float64Array(length);
  };

  return {
    /** One frame at song time `time` (`dt` since the previous played frame; 0 or a jump breaks the line). */
    feed(time, spectrum, power, dt) {
      if (!spectrum || !(dt > 0) || dt > 0.25) {
        previous = null;
        return;
      }
      if (!pitchBins || previous && previous.length !== spectrum.length) mapBins(spectrum.length);
      if (!previous) {
        previous = Float32Array.from(spectrum);
        return;
      }
      // Positive flux of the log magnitudes (the bytes are already in dB), low end weighted up.
      let flux = 0;
      const lowEnd = Math.round(fluxEnd * 0.05);
      for (let i = 1; i < fluxEnd; i += 1) {
        const rise = spectrum[i] - previous[i];
        if (rise > 0) flux += rise * (i < lowEnd ? 1.5 : 1);
        previous[i] = spectrum[i];
      }
      // Per cell, the mean flux of the frames that fell in it: frames and cells do not line up
      // (60 frames a second on a 50 Hz grid), and summing would add a false rhythm of its own.
      const cell = Math.floor(time * GRID_HZ);
      if (cell >= 0 && grow(cell + 1)) {
        mask[cell] = Math.min(255, mask[cell] + 1);
        novelty[cell] += (flux / 255 - novelty[cell]) / mask[cell];
      }
      // Chroma from spectral peaks only: a note's bin counts by how far it stands above the bins
      // 2–4 away on either side (the next ones share its leakage).
      let total = 0;
      frame.fill(0);
      const first = pitchBins[0][0] - 4;
      const last = pitchBins[pitchBins.length - 1][0] + 4;
      for (let i = Math.max(0, first); i <= Math.min(spectrum.length - 1, last); i += 1) linear[i] = 10 ** (spectrum[i] * 0.02745); // 70 dB over 255 steps
      for (const [bin, pc] of pitchBins) {
        let around = 0;
        for (let k = 2; k <= 4; k += 1) around += linear[bin - k] + linear[bin + k];
        const peak = Math.max(linear[bin], linear[bin - 1] * 0.7, linear[bin + 1] * 0.7);
        const salience = Math.max(0, peak / (around / 6) - 1.3);
        frame[pc] += salience;
        total += salience;
      }
      if (total > 0.5 && power > 0.02) {
        for (let pc = 0; pc < 12; pc += 1) chroma[pc] += frame[pc] / total;
        chromaFrames += 1;
      }
      powerSum += power;
      powerFrames += 1;
    },

    /** Seconds of song heard so far (grid cells with data). */
    get heard() {
      return mask.reduce((s, v) => s + (v ? 1 : 0), 0) / GRID_HZ;
    },

    estimate() {
      const tempo = tempoOf(novelty, mask, GRID_HZ);
      const key = chromaFrames > GRID_HZ * 10 ? keyOf(Array.from(chroma)) : null;
      return {
        heard: Math.round(this.heard),
        bpm: tempo?.bpm ?? null,
        confidence: tempo?.confidence ?? 0,
        phase: tempo?.phase ?? null,
        downbeat: tempo?.downbeat ?? null,
        key: key?.key ?? null,
        mode: key?.mode ?? null,
        keyConfidence: key?.keyConfidence ?? 0,
        modeConfidence: key?.modeConfidence ?? 0,
        loudness: powerFrames ? Math.round((powerSum / powerFrames) * 100) / 100 : null,
      };
    },

    /** What is worth keeping across plays: the chroma totals (the tempo is re-learned each play). */
    snapshot() {
      return { chroma: Array.from(chroma, (v) => Math.round(v * 10) / 10), chromaFrames, powerSum: Math.round(powerSum * 10) / 10, powerFrames };
    },
    restore(saved) {
      if (!saved?.chroma || saved.chroma.length !== 12) return;
      saved.chroma.forEach((v, i) => {
        chroma[i] += v;
      });
      chromaFrames += saved.chromaFrames ?? 0;
      powerSum += saved.powerSum ?? 0;
      powerFrames += saved.powerFrames ?? 0;
    },
  };
};

/** The key as people say it: "C 大调", "A 小调". */
const keyName = (features) => (features?.key ? `${features.key} ${features.mode === 'minor' ? '小调' : '大调'}` : '');
return { keyOf, tempoOf, createRhythm, keyName };
})();

// ---- src/color.mjs
const __color = (() => {
// Colors as { r, g, b } in 0..1. CSS strings are parsed by the browser's own
// canvas so any theme color (named, rgb(), hsl(), #rgb) works.

const { clamp, lerp } = __motion;

let probe = null;
const probeContext = () => {
  if (!probe) probe = document.createElement('canvas').getContext('2d');
  return probe;
};

const parseColor = (css, fallback = '#ffffff') => {
  const context = probeContext();
  context.fillStyle = fallback;
  context.fillStyle = css || fallback;
  const value = String(context.fillStyle);
  if (value.startsWith('#')) {
    const n = parseInt(value.slice(1, 7), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
  return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
};

const byte = (v) => Math.round(clamp(v) * 255);
const toNumber = ({ r, g, b }) => (byte(r) << 16) | (byte(g) << 8) | byte(b);
const toCss = ({ r, g, b }, alpha = 1) => `rgba(${byte(r)},${byte(g)},${byte(b)},${alpha})`;
const mix = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
/** Perceived lightness, 0..1 (Rec. 709 weights on gamma-encoded values: good enough for contrast picks). */
const luminance = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Pulls a color toward its own grey by `amount` (0..1). */
const desaturate = (color, amount) => {
  const grey = luminance(color);
  return mix(color, { r: grey, g: grey, b: grey }, amount);
};

const WHITE = { r: 1, g: 1, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };
return { parseColor, toNumber, toCss, mix, luminance, desaturate, WHITE, BLACK };
})();

// ---- src/stage.mjs
const __stage = (() => {
// The 花笺 stage: one PixiJS canvas, drawn on the host's frame loop only when
// the song clock moved (or something changed), with a frame-cost governor that
// thins particles before the picture ever stutters.
//
// Layers, back to front: a colour field (soft palette lights), the camera (particles behind, the
// shots, particles in front, all through one post pass), a vignette and grain.

const { buildPlan, fallbackSegment, paragraphAt } = __plan;
const { createParticles } = __particles;
const { createShots } = __shots;
const { createPost } = __post;
const { createEar } = __audio;
const { createRhythm, keyName } = __rhythm;
const { createGrainTexture, createParticleAtlas, createRadialTexture } = __textures;
const { WHITE, desaturate, mix, parseColor, toNumber } = __color;
const { clamp, damp } = __motion;
const { hash01, hashString } = __random;
const { STATUS_TEXT } = __director;

// Song-time math in shaders and long-lived sprites wants full precision.
PIXI.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';

const SERIF = '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "Songti SC", "STSong", "SimSun", serif';
const SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif';
const SEEK_JUMP_SEC = 0.6;

const numberSetting = (values, key, fallback) => (Number.isFinite(Number(values[key])) ? Number(values[key]) : fallback);

/*
 * Destroys one mount's PixiJS app WITHOUT releasing PixiJS's global resources. `app.destroy(true)`
 * would also empty the global batch pool that every mount shares, destroying batches the other
 * mounts are still drawing with (Folia keeps two mounts alive across a song change, plus the
 * mode picker's preview): their next rebuild then fails ("reading 'clear'", "reading 'geometry'"),
 * and every frame after it fails on the half-reset update queue ("reading 'renderPipeId'").
 */
const destroyApp = (app) => {
  app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true, texture: true });
};

const mountStage = ({ folium, container, ctx, director }) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
  container.appendChild(host);
  let disposed = false;
  let cleanup = () => {};

  const start = async () => {
    const app = new PIXI.Application();
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      backgroundAlpha: 0,
      antialias: false,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
      // Only the dev harness keeps the buffer, so screenshots of a still frame are not blank.
      preserveDrawingBuffer: Boolean(globalThis.__HUAJIAN_DEBUG__),
      ...(globalThis.__HUAJIAN_GC_TEST__ ? { gcMaxUnusedTime: 300, gcFrequency: 150 } : {}),
    });
    if (disposed) {
      destroyApp(app);
      return;
    }
    app.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    host.appendChild(app.canvas);

    // ------------------------------------------------------------ state

    let W = Math.max(1, host.clientWidth);
    let H = Math.max(1, host.clientHeight);
    const settings = () => ctx.getSettings();
    const quality = () => String(settings().quality ?? 'auto');
    const live = !ctx.isPreview && !ctx.staticMode && folium.env?.context === 'main';
    const handle = director.attach({ song: ctx.song, lines: ctx.lines, theme: ctx.getTheme(), duration: ctx.getDuration(), live });
    const seed = hashString(ctx.seed ?? `${ctx.song?.title ?? ''}|${ctx.song?.artist ?? ''}`);
    const segment = (line) => {
      try {
        if (typeof folium.lyrics?.segmentWords === 'function') return folium.lyrics.segmentWords(line);
      } catch {
        // The host's segmenter is optional; Intl.Segmenter is close enough.
      }
      return fallbackSegment(line);
    };

    /*
     * Folia's own keyword colours for a line: the theme's wordColors, matched by the host the way its
     * builtin modes match them. Null when the theme has none (the mod's keyword and accent apply).
     */
    const wordColors = (line) => {
      const list = ctx.getTheme().wordColors;
      if (!Array.isArray(list) || !list.length || typeof folium.lyrics?.buildWordColorRanges !== 'function') return null;
      try {
        return folium.lyrics.buildWordColorRanges(String(line?.fullText ?? ''), list)
          .map((range) => ({ start: range.startOffset, end: range.endOffset, color: toNumber(parseColor(range.color)) }));
      } catch {
        return null;
      }
    };

    let plan = null;
    const atlas = createParticleAtlas();
    const particles = createParticles(atlas);
    const ear = createEar();
    // Tempo and key of the whole song, learned while it plays (and remembered across plays).
    const rhythm = createRhythm();
    let grid = null; // { period, phase, downbeat } in song seconds, once the tempo is trusted
    const useGrid = (features) => {
      grid = features?.bpm && features.confidence >= 0.45 && Number.isFinite(features.phase)
        ? { period: 60 / features.bpm, phase: features.phase, downbeat: features.downbeat ?? features.phase }
        : grid;
    };
    if (live) {
      handle.loadAudio().then((record) => {
        if (disposed || !record) return;
        rhythm.restore(record.s);
        useGrid(record.f);
      });
    }
    let estimating = false;
    let lastEstimate = 0;
    /* Estimates in idle time (a whole song's record takes a few to ~20 ms), every 5 s while playing. */
    const estimateSoon = () => {
      if (estimating || performance.now() - lastEstimate < 5000) return;
      estimating = true;
      const run = () => {
        estimating = false;
        lastEstimate = performance.now();
        if (disposed) return;
        const features = rhythm.estimate();
        useGrid(features);
        handle.setAudio(features, rhythm.snapshot());
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 0);
    };
    /* A beat of the grid between the last frame and this one: 1 on a downbeat, 0.65 on the others. */
    const gridBeat = (from, to) => {
      if (!grid || !(to > from) || to - from > 0.25) return 0;
      const k = Math.floor((to - grid.phase) / grid.period);
      if (k <= Math.floor((from - grid.phase) / grid.period)) return 0;
      const bar = Math.round((grid.phase + k * grid.period - grid.downbeat) / grid.period);
      return ((bar % 4) + 4) % 4 === 0 ? 1 : 0.65;
    };

    // ------------------------------------------------------------ layers

    const washTexture = createRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const vignetteTexture = createRadialTexture('rgba(0,0,0,0)', 'rgba(0,0,0,1)');
    const grainTexture = createGrainTexture();
    // The colour field: three soft lights in the song's palette, wandering slowly.
    const field = [0, 1, 2].map(() => {
      const light = new PIXI.Sprite(washTexture);
      light.anchor.set(0.5);
      return light;
    });
    const camera = new PIXI.Container();
    const textLayer = new PIXI.Container();
    // The wipe band passes over everything.
    const overlayLayer = new PIXI.Container();
    camera.addChild(particles.back, textLayer, particles.front, overlayLayer);
    const post = createPost();
    camera.filters = [post.filter];
    const vignette = new PIXI.Sprite(vignetteTexture);
    vignette.anchor.set(0.5);
    const grain = new PIXI.TilingSprite({ texture: grainTexture, width: W, height: H });
    app.stage.addChild(...field, camera, vignette, grain);

    // ------------------------------------------------------------ look: fonts, colors, metrics

    const fonts = () => {
      const face = String(settings().typeface ?? 'theme');
      const theme = ctx.getTheme();
      if (face === 'serif') return { family: SERIF, weight: 500, display: SERIF };
      if (face === 'sans') return { family: SANS, weight: 500, display: SERIF };
      const family = typeof folium.theme?.resolveFontStack === 'function' ? folium.theme.resolveFontStack(theme) : SANS;
      const weight = typeof folium.theme?.resolveFontWeight === 'function' ? folium.theme.resolveFontWeight(theme, 500) : 500;
      return { family, weight, display: SERIF };
    };

    let colors = null;
    const computeColors = () => {
      const theme = ctx.getTheme();
      const daylight = Boolean(theme.isDaylight);
      const ink = parseColor(theme.primaryColor, daylight ? '#1b1b1f' : '#f4f1ea');
      const accent = parseColor(theme.accentColor, daylight ? '#8a5a2b' : '#e8c48a');
      const palette = (plan?.palette ?? ['#ffffff']).map((css) => {
        const c = parseColor(css);
        return daylight ? mix(desaturate(c, 0.2), ink, 0.55) : mix(c, accent, 0.22);
      });
      const warm = daylight ? mix(parseColor('#c77a2c'), ink, 0.25) : mix(parseColor('#ffbd6e'), palette[0], 0.2);
      colors = {
        daylight,
        ink: toNumber(ink),
        inkColor: ink,
        accent,
        accentNumber: toNumber(accent),
        glow: toNumber(daylight ? mix(accent, ink, 0.3) : mix(accent, WHITE, 0.25)),
        palette,
        particle: (k) => toNumber(palette[k % palette.length]),
        warm: toNumber(warm),
        hot: toNumber(daylight ? mix(parseColor('#a84f12'), ink, 0.2) : parseColor('#fff2da')),
      };
      particles.setColors({
        palette: palette.map(toNumber),
        warmTint: colors.warm,
        hotTint: colors.hot,
        rain: toNumber(daylight ? mix(parseColor('#5d6f86'), ink, 0.3) : mix(parseColor('#c4d3e6'), ink, 0.15)),
      });
      particles.setDaylight(daylight);
      const surface = ctx.getSurface?.() ?? { transparent: false };
      field.forEach((light, i) => {
        light.visible = !surface.transparent;
        light.tint = toNumber(daylight ? mix(palette[i % palette.length], WHITE, 0.5) : palette[i % palette.length]);
      });
      vignette.visible = !surface.transparent;
      vignette.tint = daylight ? toNumber(mix(ink, WHITE, 0.6)) : 0x000000;
    };

    const metrics = () => {
      const u = Math.min(W, H);
      const scale = numberSetting(settings(), 'fontScale', 1) * (ctx.getDisplay?.().lyricsFontScale ?? 1);
      return { W, H, u, fs: clamp(u * 0.066, 18, 124) * scale, dpr: app.renderer.resolution };
    };

    const scenes = createShots({
      layers: { text: textLayer, overlay: overlayLayer },
      radial: washTexture,
      // Upload a texture now (in the frame that built it) rather than in the frame that first draws it.
      upload: (source) => {
        try {
          app.renderer.texture.initSource(source);
        } catch {
          // Not fatal: the texture uploads on first draw instead.
        }
      },
      particles,
      metrics,
      fonts,
      colors: () => colors,
      settings: () => ({ ornaments: settings().ornaments !== false, motion: numberSetting(settings(), 'motion', 1) * intensityOf() }),
      onError: (error) => onFrameError?.(error),
      segment,
      wordColors,
    });

    const intensityOf = () => ({ calm: 0.8, chaotic: 1.2 }[ctx.getTheme().animationIntensity] ?? 1);

    const applyPlan = () => {
      note(`plan ${handle.entry?.status ?? ''}`);
      plan = buildPlan({ analysis: handle.analysis, direction: handle.direction, seed, segment, song: ctx.song, tempo: handle.entry?.audio ?? null });
      scenes.setPlan(plan, handle.analysis, ctx.song, lastTime ?? (ctx.staticMode ? Infinity : ctx.lyricTime.get()));
      particles.setPlan(plan);
      computeColors();
      dirty = true;
    };

    // ------------------------------------------------------------ geometry

    const layout = () => {
      note(`layout ${host.clientWidth}x${host.clientHeight}`);
      W = Math.max(1, host.clientWidth);
      H = Math.max(1, host.clientHeight);
      app.renderer.resize(W, H);
      vignette.position.set(W / 2, H / 2);
      vignette.width = Math.hypot(W, H) * 1.05;
      vignette.height = Math.hypot(W, H) * 1.05 * (H / W) * 1.15;
      grain.width = W;
      grain.height = H;
      camera.pivot.set(W / 2, H / 2);
      camera.filterArea = new PIXI.Rectangle(0, 0, W, H);
      scenes.rebuild();
      dirty = true;
    };

    // ------------------------------------------------------------ frame loop

    let dirty = true;
    let lastTime = null;
    let lastWall = null;
    let energy = 0.4;
    let punch = 0;
    let pulse = 0;
    let rgbKick = 0;
    const hits = []; // recent strong onsets (song time, strength) for the camera shake
    let lastLiveShell = -Infinity;
    let currentShot = null;
    let autoBudget = 1;
    let cost = 2;
    let peak = 0;
    let rendered = 0;
    let frameCount = 0;
    let particleCount = 0;
    let current = null;

    const staticTime = () => {
      const line = ctx.lines[ctx.staticLineIndex ?? -1] ?? ctx.lines.find((l) => l.fullText?.trim());
      if (!line) return 1;
      return line.startTime + (line.endTime - line.startTime) * 0.62;
    };

    const ambientTargets = (paragraph, level) => {
      const density = numberSetting(settings(), 'particles', 1);
      const name = paragraph?.weather ?? plan.weather;
      const e = paragraph?.energy ?? plan.mood.energy * 0.8;
      const quiet = paragraph?.accent === 'sparkler' ? 0.75 : 1;
      const amount = clamp((0.42 + 0.45 * e) * (0.85 + 0.3 * level) * quiet * Math.min(1.2, density + 0.1));
      return name && name !== 'none' ? { [name]: amount } : {};
    };

    /*
     * The host's lyric clock follows the audio element, which advances in uneven steps. Animating
     * straight off it makes motion judder even at a steady frame rate. This clock advances by the
     * wall time of each frame and leans gently (≈0.2 s) toward the host's time; a jump of more than
     * 0.3 s (a seek) is taken at once, and if the host time stops moving (buffering) it holds.
     */
    let clock = null;
    let hostLast = null;
    let hostStill = 0;
    const smoothClock = (host, wallDt, paused) => {
      if (host !== hostLast) hostStill = 0;
      else hostStill += wallDt;
      hostLast = host;
      if (clock === null || paused || wallDt <= 0 || wallDt > 0.25) {
        clock = host;
        return clock;
      }
      // Where the song really is: the host's last value plus the time since it last changed
      // (a stepped clock is exact at the moment it steps). Past 0.35 s without a step the host
      // has stalled (buffering): hold.
      if (hostStill > 0.35) return clock;
      const estimate = host + hostStill;
      const predicted = clock + wallDt;
      const error = estimate - predicted;
      if (Math.abs(error) > 0.3) {
        clock = estimate;
        return clock;
      }
      // Lean toward the estimate over ~0.4 s; never backwards.
      clock = Math.max(clock, predicted + error * Math.min(1, wallDt / 0.4));
      return clock;
    };

    // ------------------------------------------------------------ diagnostics
    // A short trail of what happened, and the first errors of each mount with their stacks, kept in
    // the mod's data file ("diag") so a failure seen in Folia can be read back exactly.
    const trail = [];
    const note = (what) => {
      trail.push(`${(lastTime ?? 0).toFixed(2)} ${what}`);
      if (trail.length > 30) trail.shift();
    };
    let errorsThisMount = 0;
    const onFrameError = (error) => {
      errorsThisMount += 1;
      const message = String(error?.message ?? error);
      if (errorsThisMount <= 3) {
        const record = {
          at: new Date().toISOString(),
          message,
          stack: String(error?.stack ?? '').slice(0, 2400),
          song: ctx.song?.title ?? '',
          t: lastTime,
          dpr: app.renderer.resolution,
          size: [W, H],
          scene: scenes.debugState?.(),
          trail: [...trail],
        };
        folium.log.error('花笺渲染出错（已自动恢复）', { message, first: record.stack.split('\n').slice(0, 3).join(' | ') });
        Promise.resolve(folium.storage.get('diag')).then((old) => {
          const list = Array.isArray(old) ? old : [];
          list.push(record);
          return folium.storage.set('diag', list.slice(-8));
        }).catch(() => {});
      }
      // An exception inside a render leaves PixiJS's queue of pending updates half processed;
      // left alone, every later frame fails on it. Force a clean rebuild of the instructions.
      const group = app.stage.renderGroup;
      if (group) {
        group.structureDidChange = true;
        if (group.childrenRenderablesToUpdate) {
          group.childrenRenderablesToUpdate.list.length = 0;
          group.childrenRenderablesToUpdate.index = 0;
        }
      }
      dirty = true;
    };

    const frame = () => {
      try {
        renderFrame();
      } catch (error) {
        onFrameError(error);
      }
    };

    const renderFrame = () => {
      if (disposed || !plan) return;
      if (quality() === 'eco' && (frameCount++ & 1)) return;
      const wall = performance.now();
      const wallDt = lastWall === null ? 0 : (wall - lastWall) / 1000;
      const t = ctx.staticMode ? staticTime() : smoothClock(ctx.lyricTime.get(), wallDt, ctx.isPaused());
      const songDt = lastTime === null ? 0 : t - lastTime;
      const seeked = lastTime !== null && (songDt < -0.05 || Math.abs(songDt - wallDt) > SEEK_JUMP_SEC);
      lastTime = t;
      lastWall = wall;
      if (seeked) {
        note(`seek to ${t.toFixed(2)}`);
        particles.onSeek(t);
        scenes.onSeek();
        ear.reset();
      }
      const dt = seeked ? 0 : clamp(songDt, 0, 0.1);
      // Nothing moves while the clock stands still, unless something changed or the user seeked (paused or not).
      if (dt === 0 && !dirty && !seeked) return;

      const begin = performance.now();
      const playing = live && dt > 0 && !ctx.isPaused();
      const reading = playing ? ear.step(ctx.audio, t, dt) : ear.idle();
      if (playing) {
        rhythm.feed(t, ctx.audio.getSpectrum?.() ?? null, ctx.audio.getPower(), dt);
        estimateSoon();
      }
      const paragraph = paragraphAt(plan, t, 1.5) ?? (plan.paragraphs.length === 0 ? { weather: plan.weather, energy: plan.mood.energy, burst: 0.5, accent: plan.mood.valence > 0.6 && plan.mood.energy > 0.6 ? 'fireworks' : null } : null);
      current = paragraph;
      const motion = numberSetting(settings(), 'motion', 1) * intensityOf();
      energy = damp(energy, paragraph?.energy ?? plan.mood.energy * 0.8, 1.5, dt);

      // Live hits: on the beat grid once the tempo is known (steady, and on the beat people feel),
      // otherwise on raw onsets. Silence plays no beats. Shells in fireworks paragraphs, a push of
      // the camera in loud ones.
      const beat = grid && reading.active ? gridBeat(t - dt, t) * (0.6 + 0.6 * reading.level) : 0;
      const onset = (grid ? beat : reading.onset) * motion;
      const shellCue = grid ? beat >= 0.6 * motion && gridBeat(t - dt, t) === 1 : onset > 0.35;
      if (onset > 0 && paragraph?.accent === 'fireworks' && shellCue && t - lastLiveShell > Math.max(0.45, 1.6 - paragraph.burst)) {
        lastLiveShell = t;
        const r = (slot) => hash01(Math.floor(t * 20), slot, seed);
        particles.addLiveShell({ t0: t, x: 0.15 + 0.7 * r(1), y: 0.12 + 0.3 * r(2), type: r(3) < 0.6 ? 'spark' : 'peony', color: Math.floor(r(4) * 8), scale: 0.5 + 0.3 * onset, rise: false, seed: Math.floor(r(5) * 1e9) });
      }
      // How hard a beat lands depends on the passage: a ballad verse only breathes, a loud chorus punches.
      const temperament = paragraph?.temperament ?? 'lyrical';
      // A sad song does not move to the beat at all.
      const beatGain = plan.calm ? 0 : ({ gentle: 0, lyrical: 0.35, dramatic: 0.8, punchy: 1 }[temperament] ?? 0.35);
      if (onset > 0.3 && beatGain > 0) {
        pulse = Math.max(pulse, onset * beatGain);
        punch = Math.max(punch, 0.018 * onset * beatGain);
        if (beatGain >= 0.8) {
          rgbKick = Math.max(rgbKick, 0.006 * onset * beatGain);
          if (onset > 0.55) hits.push([t, onset * beatGain]);
        }
      }
      while (hits.length && t - hits[0][0] > 0.5) hits.shift();
      punch = damp(punch, 0, 0.2, dt);
      pulse = damp(pulse, 0, 0.18, dt);
      rgbKick = damp(rgbKick, 0, 0.12, dt);

      particles.setAmbient(ambientTargets(paragraph, reading.level));
      const showText = ctx.getDisplay?.().showText !== false;
      if (textLayer.visible !== showText) note(`text ${showText ? 'shown' : 'hidden'}`);
      textLayer.visible = showText;
      const effects = scenes.update(t, { level: reading.level, motion, pulse });
      currentShot = scenes.current(t);

      // The camera breathes with the music and drifts slowly; strong hits shake it (damped, ~0.4 s).
      let shakeX = 0;
      let shakeY = 0;
      hits.forEach(([at, strength], i) => {
        const age = t - at;
        const amount = strength * Math.exp(-age / 0.085) * Math.min(W, H) * 0.006 * motion;
        shakeX += amount * Math.sin(age * 96 + i * 1.7);
        shakeY += amount * 0.8 * Math.sin(age * 77 + i * 2.3 + 1);
      });
      const breathe = 0.008 * Math.sin(t * 0.55) * energy * motion;
      camera.position.set(W / 2 + Math.sin(t * 0.05 + (seed % 7)) * W * 0.008 * motion + shakeX, H / 2 + Math.cos(t * 0.043 + (seed % 5)) * H * 0.008 * motion + shakeY);
      camera.scale.set(1 + breathe + punch);
      post.set({
        rgb: (effects.rgb + rgbKick) * motion,
        flash: effects.flash,
        distort: effects.distort * motion,
        flashColor: colors.daylight ? [colors.accent.r, colors.accent.g, colors.accent.b] : [1, 0.97, 0.92],
      });
      // A pure function of song time, so a seek or an export shows the same light.
      const fieldAlpha = (colors.daylight ? 0.07 : 0.085) + 0.07 * energy + 0.04 * reading.level;
      field.forEach((light, i) => {
        const phase = (seed % 11) + i * 2.1;
        light.position.set(W * (0.5 + 0.34 * Math.sin(t * 0.021 + phase)), H * (0.48 + 0.26 * Math.cos(t * 0.017 + phase * 1.3)));
        light.width = W * (0.9 + 0.1 * i);
        light.height = H * (1.05 + 0.1 * i);
        light.alpha = fieldAlpha * (i === 0 ? 1 : 0.75);
      });
      vignette.alpha = colors.daylight ? 0.14 : 0.5;
      const grainOn = settings().grain !== false && autoBudget > 0.45;
      grain.visible = grainOn;
      if (grainOn) {
        const tick = Math.floor(t * 24);
        grain.alpha = colors.daylight ? 0.03 : 0.045;
        grain.tilePosition.set(hash01(tick, 1) * 160, hash01(tick, 2) * 160);
      }

      particleCount = particles.update(t, dt, { width: W, height: H, live: { onset, boost: onset * (paragraph?.burst ?? 0) }, snap: ctx.staticMode || seeked || dt === 0 });
      app.render();
      dirty = false;

      // Governor: the cost of this frame's work (JS + draw submission), averaged.
      // A frame that built a scene (atlases, sprites) is a one-off: capped so it cannot swing the average.
      const spent = performance.now() - begin;
      cost = cost * 0.94 + Math.min(spent, cost * 3 + 2) * 0.06;
      // The worst single frame of the last few seconds: what a stutter would show up as.
      peak = Math.max(spent, peak * Math.exp(-wallDt / 3));
      if (globalThis.__HUAJIAN_DEBUG__) {
        const frames = (globalThis.__huajianFrames ??= []);
        frames.push(+spent.toFixed(2));
        const steps = (globalThis.__huajianSteps ??= []);
        steps.push([+(songDt * 1000).toFixed(1), +(wallDt * 1000).toFixed(1)]);
        if (steps.length > 4000) steps.shift();
        if (spent > 6) (globalThis.__huajianSlow ??= []).push({ ms: +spent.toFixed(1), t: +t.toFixed(2), post: post.filter.enabled, particles: particleCount, built: (globalThis.__huajianBuilds ?? []).filter((b) => Math.abs(b[2] - t) < 0.01).map((b) => b[0]) });
        if (frames.length > 4000) frames.shift();
      }
      rendered += 1;
      if (rendered % 60 === 0 && quality() !== 'high') {
        if (cost > 7 && autoBudget > 0.35) autoBudget *= 0.8;
        else if (cost < 3 && autoBudget < 1) autoBudget = Math.min(1, autoBudget * 1.1);
      }
      const density = numberSetting(settings(), 'particles', 1);
      const qualityScale = quality() === 'eco' ? 0.6 : quality() === 'high' ? 1.25 : 1;
      particles.setBudget(density * qualityScale * autoBudget);
    };

    // ------------------------------------------------------------ director overlay (optional)

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:14px;bottom:12px;font:11px/1.5 system-ui,sans-serif;color:rgba(255,255,255,.6);text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:pre;';
    host.appendChild(overlay);
    const SCENE_NAMES = { center: '居中', whisper: '低语', stanza: '诗稿', vertical: '竖排', hero: '巨字', collage: '拼贴' };
    const audioLine = (f) => {
      if (!f?.heard) return '节奏与调性：还在听';
      const bpm = f.bpm ? `${Math.round(f.bpm)} BPM（${f.confidence >= 0.45 ? '已对拍' : '不确定'}）` : '节奏还没听出来';
      const key = f.key && f.keyConfidence >= 0.4 ? ` · ${keyName(f)}` : '';
      return `${bpm}${key} · 已听 ${f.heard} 秒`;
    };
    const TEMPERAMENT_NAMES = { gentle: '静', lyrical: '抒', dramatic: '烈', punchy: '燃' };
    const WEATHER_NAMES = { none: '无', dust: '浮尘', rain: '雨丝', snow: '飘雪', petals: '落花', fireflies: '萤火', embers: '余烬', stars: '星空', sparkler: '线香花火', fireworks: '烟花' };
    const updateOverlay = () => {
      const on = settings().showDirector === true && !ctx.isPreview;
      overlay.style.display = on ? 'block' : 'none';
      if (!on || !plan) return;
      const entry = handle.entry;
      const d = handle.direction;
      const p = current;
      const scene = p?.scene ? SCENE_NAMES[p.scene] : '—';
      const weather = WEATHER_NAMES[p?.weather ?? plan.weather] ?? '';
      const accent = p?.accent ? ` + ${WEATHER_NAMES[p.accent]}` : '';
      const shot = currentShot;
      const recipe = shot ? `${TEMPERAMENT_NAMES[shot.temperament] ?? ''} · ${shot.layout} · 进 ${shot.enter} · 唱 ${shot.sing} · 退 ${shot.exit} · 镜 ${shot.camera} · 转 ${shot.transIn}` : '';
      overlay.textContent = [
        `花笺 · ${STATUS_TEXT[entry.status] ?? entry.status}${d.summary ? ` · ${d.summary}` : ''}`,
        audioLine(entry.audio),
        `明暗 ${d.valence.toFixed(2)}  能量 ${d.energy.toFixed(2)}  冷暖 ${d.warmth.toFixed(2)}  ·  ${scene} / ${weather}${accent}`,
        recipe,
        `平均 ${cost.toFixed(1)} ms · 峰值 ${peak.toFixed(1)} ms · ${particleCount} 粒子 · 预算 ${(autoBudget * 100).toFixed(0)}%`,
      ].join('\n');
    };

    // ------------------------------------------------------------ wiring

    applyPlan();
    layout();
    // Compile the post pass now, while the song is changing anyway: a shader compiled at the first
    // transition would stall that frame.
    post.set({ rgb: 0.001 });
    app.render();
    post.set({});
    // The dev harness sets this flag to inspect the stage; Folia never does.
    if (globalThis.__HUAJIAN_DEBUG__) globalThis.__huajian = { app, camera, post, particles, shots: scenes, PIXI, rhythm, handle };

    const offUpdate = handle.onUpdate(() => applyPlan());
    let lookKey = '';
    const keyOfLook = () => {
      const theme = ctx.getTheme();
      const font = fonts();
      return [font.family, font.weight, theme.primaryColor, theme.accentColor, theme.isDaylight, JSON.stringify(theme.wordColors ?? null), settings().fontScale, settings().typeface, settings().ornaments, ctx.getDisplay?.().lyricsFontScale].join('|');
    };
    lookKey = keyOfLook();
    const offChange = ctx.onChange(() => {
      handle.updateTheme(ctx.getTheme());
      const next = keyOfLook();
      if (next !== lookKey) {
        lookKey = next;
        computeColors();
        note('rebuild');
        scenes.rebuild();
      }
      dirty = true;
    });
    const offResize = ctx.onResize(() => {
      if (host.clientWidth !== W || host.clientHeight !== H) layout();
    });
    const offFrame = ctx.onFrame(frame);
    const offOverlay = ctx.every(500, updateOverlay);
    // Fonts may still be loading on the first frame; redraw the glyphs once they are in.
    document.fonts?.ready?.then(() => {
      if (!disposed) {
        note('rebuild');
        scenes.rebuild();
        dirty = true;
      }
    });

    cleanup = () => {
      offUpdate();
      offChange();
      offResize();
      offFrame();
      offOverlay();
      handle.detach();
      scenes.destroy();
      particles.destroy();
      post.destroy();
      atlas.destroy();
      washTexture.destroy(true);
      vignetteTexture.destroy(true);
      grainTexture.destroy(true);
      destroyApp(app);
    };
  };

  start().catch((error) => {
    folium.log.error('花笺启动失败', { message: String(error?.message ?? error), stack: String(error?.stack ?? '').slice(0, 600) });
  });

  return () => {
    disposed = true;
    cleanup();
    host.remove();
  };
};
return { mountStage };
})();

// ---- src/evaluate.mjs
const __evaluate = (() => {
const createEvaluator = null;
return { createEvaluator };
})();

// ---- src/client.mjs (entry)
// 花笺 — a lyric animation mode for Folia. Editorial typography (outline
// keywords, hairlines, seals, poem-draft and vertical layouts) and a full set
// of light (rain, snow, petals, fireflies, embers, stars, the sparkler,
// fireworks), staged per paragraph by an AI director that reads each song once.
// The director is optional: without it a local reading of the lyric directs.
//
// This file wires settings, commands and the visualizer to the director
// (director.mjs) and the stage (stage.mjs).

const { createStore } = __store;
const { createDirector } = __director;
const { mountStage } = __stage;
const { createEvaluator } = __evaluate;
const { PROVIDERS } = __providers;

const T = (zh, en) => ({ 'zh-CN': zh, en });
const PROVIDER_OPTIONS = Object.entries(PROVIDERS).map(([value, provider]) => ({ value, label: T(provider.label, provider.label) }));

/** Settings > Mods > 花笺: the AI endpoint and the director's behaviour. */
const SECTION_SETTINGS = [
  { key: 'ai', type: 'boolean', group: T('AI 导演', 'AI director'), label: T('启用 AI 导演', 'Use the AI director'),
    description: T('每首歌调用一次 AI 读懂歌词，为每个段落安排版式、氛围和火花；结果会记住，同一首歌不再花钱。关掉则完全用本地规则', 'One call per song; remembered afterwards. Off: local rules only'), defaultValue: true },
  { key: 'prefetch', type: 'boolean', group: T('AI 导演', 'AI director'), label: T('提前分析下一首', 'Prepare the next song'),
    description: T('当前歌放着时，就先分析好队列里的下一首（只支持在线歌曲）', 'Analyse the next queued song in the background'), defaultValue: true },
  { key: 'provider', type: 'select', group: T('接口', 'API'), label: T('服务商', 'Provider'),
    description: T('任何兼容 OpenAI 接口的服务都能用；列表里没有的选“自定义”并填接口地址', 'Any OpenAI-compatible API works'), defaultValue: 'custom', options: PROVIDER_OPTIONS },
  { key: 'baseUrl', type: 'text', group: T('接口', 'API'), label: T('接口地址', 'API base URL'),
    description: T('选了服务商可以留空；填了就以这里为准', 'Leave empty to use the provider preset'), defaultValue: '', placeholder: 'https://api.example.com/v1' },
  { key: 'model', type: 'text', group: T('接口', 'API'), label: T('模型', 'Model'),
    description: T('推荐便宜、快、不带思考的模型。不确定就运行命令“花笺：测试 AI 连接”看可用列表', 'A fast model without reasoning'), defaultValue: '', placeholder: 'deepseek-chat / qwen-plus / gpt-4o-mini …' },
  { key: 'apiKey', type: 'secret', group: T('接口', 'API'), label: T('API 密钥', 'API key'),
    description: T('由 Folia 加密保存。本机模型（Ollama、LM Studio）可以不填', 'Stored encrypted by Folia') },
  { key: 'thinking', type: 'select', group: T('接口', 'API'), label: T('关闭“思考”', 'Turn reasoning off'),
    description: T('这个任务用不上思考，开着会慢很多、贵很多。“自动”按服务商选择关闭方式', 'Not needed here; "auto" picks the switch'), defaultValue: 'auto', options: [
      { value: 'auto', label: T('自动（推荐）', 'Auto (recommended)') },
      { value: 'thinking', label: T('thinking: disabled（DeepSeek、智谱、豆包）', 'thinking: disabled') },
      { value: 'enable_thinking', label: T('enable_thinking: false（通义千问、硅基流动）', 'enable_thinking: false') },
      { value: 'reasoning_effort', label: T('reasoning_effort: low（OpenAI、Gemini）', 'reasoning_effort: low') },
      { value: 'none', label: T('不发送（模型本身不思考时）', 'Send nothing') },
    ] },
  { key: 'temperature', type: 'number', group: T('接口', 'API'), label: T('温度', 'Temperature'),
    description: T('越低越稳定，越高越有变化', 'Lower is steadier'), defaultValue: 0.3, min: 0, max: 1, step: 0.05 },
];

/** Under the mode picker: how it looks. */
const VISUAL_SETTINGS = [
  { key: 'motion', type: 'number', label: T('动感', 'Motion'), description: T('字的起伏、镜头呼吸和鼓点反应的幅度', 'How much text and camera move'), defaultValue: 1, min: 0.3, max: 1.6, step: 0.05 },
  { key: 'particles', type: 'number', label: T('粒子密度', 'Particle density'), description: T('雨、雪、光点、火花的多少；0 为不显示', 'How many particles; 0 hides them'), defaultValue: 1, min: 0, max: 1.5, step: 0.05 },
  { key: 'fontScale', type: 'number', label: T('字号', 'Text size'), defaultValue: 1, min: 0.7, max: 1.5, step: 0.05 },
  { key: 'typeface', type: 'select', label: T('字体', 'Typeface'), defaultValue: 'theme', options: [
    { value: 'theme', label: T('跟随主题', 'Theme font') },
    { value: 'serif', label: T('宋体（衬线）', 'Serif') },
    { value: 'sans', label: T('黑体（无衬线）', 'Sans') },
  ] },
  { key: 'ornaments', type: 'boolean', label: T('版式装饰', 'Ornaments'), description: T('细线、边框、页码和印章', 'Hairlines, frames, numerals and seals'), defaultValue: true },
  { key: 'grain', type: 'boolean', label: T('胶片颗粒', 'Film grain'), defaultValue: true },
  { key: 'quality', type: 'select', label: T('画质', 'Quality'), description: T('“自动”在电脑吃力时自动减少粒子；“省电”限制在 30 帧', '"Auto" thins particles under load; "Eco" caps at 30 fps'), defaultValue: 'auto', options: [
    { value: 'auto', label: T('自动', 'Auto') },
    { value: 'high', label: T('高', 'High') },
    { value: 'eco', label: T('省电', 'Eco') },
  ] },
  { key: 'showDirector', type: 'boolean', label: T('显示导演信息', 'Show director info'), description: T('在左下角显示 AI 对这首歌的判断、当前版式和性能', 'Shows the reading, the scene and the frame cost'), defaultValue: false },
];

export default async function activate(folium) {
  if ((folium.host?.folium?.minor ?? 0) < 7) {
    folium.log.warn('花笺需要 Folium 1.7（Folia 0.7.22 起）才能使用 AI 导演；动画仍可用本地导演运行');
  }

  const section = folium.registries.settingsSections.register({
    id: 'main',
    label: T('花笺', 'Huajian'),
    description: T('AI 导演：选服务商、填模型名和 API 密钥，然后运行命令“花笺：测试 AI 连接”', 'Pick a provider, model and key, then run "Huajian: test AI connection"'),
    settings: SECTION_SETTINGS,
  });
  const config = () => {
    const values = section.settings.get();
    return {
      ai: values.ai !== false,
      prefetch: values.prefetch !== false,
      provider: String(values.provider ?? 'custom'),
      baseUrl: String(values.baseUrl ?? '').trim(),
      model: String(values.model ?? '').trim(),
      thinking: String(values.thinking ?? 'auto'),
      temperature: Number(values.temperature ?? 0.3),
    };
  };

  const store = createStore(folium.storage, folium.log);
  const director = createDirector({ folium, store, getConfig: config });
  section.settings.onChange(() => director.onSetupChanged());
  folium.secrets?.subscribe?.((key) => {
    if (key === 'apiKey') director.onSetupChanged();
  });

  folium.registries.visualizers.register({
    id: 'stage',
    label: T('花笺', 'Huajian'),
    order: 420,
    settings: VISUAL_SETTINGS,
    mount: (container, ctx) => mountStage({ folium, container, ctx, director }),
  });

  const command = (id, zh, en, run, keywords = []) => folium.registries.commands.register({
    id,
    label: T(zh, en),
    keywords: ['花笺', 'huajian', '歌词动画', ...keywords],
    run,
  });
  command('test', '花笺：测试 AI 连接', 'Huajian: test AI connection', async () => {
    const report = await director.testConnection();
    if (report.chatError) return `连接失败：${report.chatError}`;
    if (!report.chat) return report.modelsError ? `获取模型失败：${report.modelsError}` : `连接正常，可用模型 ${report.models?.length ?? 0} 个，请在设置里填模型名`;
    return `连接正常：${report.chat.ms} ms${report.chat.thought ? '，但模型在“思考”，建议在设置里换一种关闭思考的方式' : ''}`;
  }, ['测试', '连接']);
  command('reanalyze', '花笺：让 AI 重新分析这首歌', 'Huajian: re-analyse this song', () => director.reanalyze(), ['重新', '分析']);
  command('describe', '花笺：AI 怎么理解这首歌', 'Huajian: how the AI reads this song', () => director.describe(), ['理解', '情绪']);
  command('usage', '花笺：AI 用量', 'Huajian: AI usage', async () => {
    const usage = await director.usage();
    return `已分析 ${usage.calls} 次，记住 ${usage.songs} 首；累计 ${usage.input} 输入 / ${usage.output} 输出 token`;
  }, ['用量', '花费']);

  // Developer builds only (node dev/build.mjs --dev): the release has no evaluator.
  const evaluator = createEvaluator?.({ folium, store, director }) ?? null;
  if (evaluator) {
    command('evaluate', '花笺（开发）：运行评测集', 'Huajian (dev): run the evaluation set', () => evaluator.evaluate(), ['评测', 'eval']);
    command('evaluate-force', '花笺（开发）：重新问 AI 并运行评测集', 'Huajian (dev): re-ask the AI and evaluate', () => evaluator.evaluate({ force: true }), ['评测', 'eval']);
  }

  return () => director.dispose();
}
