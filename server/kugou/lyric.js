'use strict';

// 酷狗：歌词。
//
// 第 2 刀从 kugou-api.js 抽出。搜索 → 候选 → 按时长筛 → 下载解密，全程无状态。

const {
  KUGOU_HEADERS,
  KUGOU_LYRIC_DOWNLOAD,
  KUGOU_LYRIC_SEARCH,
} = require('./config');

const {
  requestJson,
} = require('./http');

const {
  decodeKugouLyricContent,
  decryptKrcContent,
  krcLanguageTranslationsToLrc,
} = require('./mapping');

function kugouLyricSearchUrl(fileHash, albumAudioId, durationMs) {
  const u = new URL(KUGOU_LYRIC_SEARCH);
  u.searchParams.set('ver', '1');
  u.searchParams.set('man', 'yes');
  u.searchParams.set('client', 'pc');
  u.searchParams.set('keyword', '');
  // krcs 的 duration 单位是毫秒，候选里的 duration 也是毫秒（如 226403）
  u.searchParams.set('duration', String(Math.max(0, Math.round(Number(durationMs) || 0))));
  u.searchParams.set('hash', fileHash);
  if (albumAudioId) u.searchParams.set('album_audio_id', String(albumAudioId));
  return u.toString();
}

// krcs 同时收到 hash 与 album_audio_id 时**只认 album_audio_id，hash 被完全忽略**（实测）：
//   hash=法语曲 + album_audio_id=别的曲子 → 返回那一首的歌词；album_audio_id 查不到 → 0 候选 → 无歌词。
// 而前端 song.albumAudioId 并不可靠（历史记录重建、「今天听过」回填、
// server.js mapKugouTrack 的 `... || raw.songid || raw.id` 兜底都会把外来 id 贴到歌上），
// 一旦透传就会整首歌词错位：表现为「歌词全变了 / 变成中文有声书」或「原本的歌词直接没有」。
// hash 是当前正在播放的音频哈希，最权威 —— 因此先用 hash 单查，查不到才用 album_audio_id 兜底。
async function fetchKugouLyricCandidates(fileHash, albumAudioId, durationMs) {
  const primary = await requestJson(kugouLyricSearchUrl(fileHash, '', durationMs), { headers: KUGOU_HEADERS }).catch(() => null);
  let candidates = (primary && Array.isArray(primary.candidates)) ? primary.candidates : [];
  if (!candidates.length && albumAudioId) {
    const fallback = await requestJson(kugouLyricSearchUrl(fileHash, albumAudioId, durationMs), { headers: KUGOU_HEADERS }).catch(() => null);
    candidates = (fallback && Array.isArray(fallback.candidates)) ? fallback.candidates : [];
  }
  return candidates.filter((c) => c && c.id);
}

// 时长守卫：album_audio_id 兜底可能命中别的曲子，用时长把明显对不上的候选剔掉。
// 只在有多个候选、且存在时长接近的候选时才过滤，避免误伤（最长 20s 容差）。
function filterKugouLyricCandidatesByDuration(candidates, durationMs) {
  const want = Number(durationMs) || 0;
  if (!(want > 5000) || candidates.length <= 1) return candidates;
  const near = candidates.filter((c) => {
    const d = Number(c.duration) || 0;
    return !d || Math.abs(d - want) <= 20000;
  });
  return near.length ? near : candidates;
}

// KRC 解密：base64 → 跳过 "krc1" 头 → XOR 16 字节 key → zlib inflate

// 酷狗翻译声明行（如"以下歌词翻译由文曲大模型提供"、"TME享有本翻译作品的著作权"），不应显示为译文

// 从 krctype=2 的 KRC 文本中提取 [language:base64JSON] 翻译，
// 按行序对齐主 LRC 正文行，生成带时间戳的译文 LRC

async function downloadKugouLyricCandidate(candidate, fmt) {
  const dl = new URL(KUGOU_LYRIC_DOWNLOAD);
  dl.searchParams.set('ver', '1');
  dl.searchParams.set('client', 'pc');
  dl.searchParams.set('id', String(candidate.id));
  dl.searchParams.set('accesskey', candidate.accesskey || '');
  dl.searchParams.set('fmt', fmt);
  dl.searchParams.set('charset', 'utf8');
  return requestJson(dl.toString(), { headers: KUGOU_HEADERS });
}

async function handleKugouLyric(hash, albumAudioId, durationSec) {
  const fileHash = String(hash || '').trim();
  if (!fileHash) return { provider: 'kugou', error: 'Missing Kugou hash', lyric: '' };
  // 前端传的是秒（playbackDurationFromSong），krcs 用毫秒
  const rawDuration = Math.max(0, Number(durationSec) || 0);
  const durationMs = rawDuration > 1000 ? Math.round(rawDuration) : Math.round(rawDuration * 1000);
  const candidates = filterKugouLyricCandidatesByDuration(
    await fetchKugouLyricCandidates(fileHash, albumAudioId, durationMs),
    durationMs,
  );
  if (!candidates.length) {
    return { provider: 'kugou', hash: fileHash, lyric: '', trans: '' };
  }
  // 主歌词：优先 krctype=1（原文歌词），否则第一个候选
  const mainCandidate = candidates.find((c) => c && c.id && String(c.krctype) === '1') || candidates[0];
  // 翻译候选：krctype=2；与主歌词并行下载，避免串行等待拖慢歌词首显
  const transCandidate = candidates.find((c) => c && c.id && String(c.krctype) === '2' && String(c.id) !== String(mainCandidate.id));
  const [lyricJson, transJson] = await Promise.all([
    downloadKugouLyricCandidate(mainCandidate, 'lrc').catch(() => null),
    transCandidate ? downloadKugouLyricCandidate(transCandidate, 'krc').catch(() => null) : Promise.resolve(null),
  ]);
  const lyric = decodeKugouLyricContent(lyricJson && lyricJson.content);

  // 翻译：优先主响应自带 trans；否则解密 krctype=2 的 KRC，从 [language:] 标签提取逐行译文
  let trans = '';
  if (lyricJson && lyricJson.trans) {
    trans = decodeKugouLyricContent(lyricJson.trans);
  }
  if (!trans && transJson) {
    const krcText = decryptKrcContent(transJson && transJson.content);
    trans = krcLanguageTranslationsToLrc(krcText, lyric);
  }
  return { provider: 'kugou', hash: fileHash, lyric, trans };
}

module.exports = {
  kugouLyricSearchUrl,
  fetchKugouLyricCandidates,
  filterKugouLyricCandidatesByDuration,
  downloadKugouLyricCandidate,
  handleKugouLyric,
};
