// ====================================================================
//  路由: AI 歌单推荐（云端 LLM 增强 / 9.15）
//  - GET  /api/ai/config        查询是否已配置（不回传密钥）
//  - POST /api/ai/config        保存 base URL / model / API key（DPAPI 加密）
//  - POST /api/ai/playlist      自然语言生成歌单（OpenAI 兼容 chat/completions）
// ====================================================================
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');

const LLM_SECRET_FILE = process.env.LLM_SECRET_FILE || '';
const LLM_CONFIG_FILE = process.env.LLM_CONFIG_FILE || '';

// ---- LLM baseUrl 安全校验 ----
// 背景：/api/ai/config 接受任意 baseUrl 且 callLLM 会带上用户的 Bearer API Key 发请求。
// 不校验则持 token 方（渲染进程 XSS 等）可把密钥外传到任意主机，并借本进程探测内网。
// 策略：强制 https（本机 loopback 的 http 例外，供本地 ollama 等自用场景——密钥不出本机）；
// 拒绝环回/内网/链路本地/云元数据/CGNAT/TEST-NET/组播保留段；带凭证的 URL 一律拒绝。
function isPrivateOrReservedIPv4(o) {
  const [a, b] = o;
  if (o.some(x => x > 255)) return true;
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;               // 链路本地 + 云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
  if (a === 192 && b === 168) return true;               // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64/10
  if (a === 192 && b === 0) return true;                 // 含 TEST-NET-1 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true;  // 基准测试段
  if (a === 198 && b === 51) return true;                // TEST-NET-2
  if (a === 203 && b === 0) return true;                 // TEST-NET-3
  if (a >= 224) return true;                             // 组播/保留
  return false;
}

function isBlockedLlmHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')
    || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata.goog') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return isPrivateOrReservedIPv4(v4.slice(1).map(Number));
  if (h.includes(':')) {
    // IPv6：环回 / 链路本地 / 唯一本地 / v4 映射。
    // 注意 WHATWG URL 会把 ::ffff:127.0.0.1 规范化为 ::ffff:7f00:1（十六进制组），两种形态都要认。
    const mappedDotted = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (mappedDotted) return isPrivateOrReservedIPv4(mappedDotted.slice(1).map(Number));
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (mappedHex) {
      const g1 = parseInt(mappedHex[1], 16), g2 = parseInt(mappedHex[2], 16);
      return isPrivateOrReservedIPv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]);
    }
    if (h === '::1' || h.startsWith('fe80:') || /^f[cd]/.test(h)) return true; // 环回/链路本地/唯一本地
    return false;
  }
  return false;
}

function isLoopbackHttpUrl(parsed) {
  return parsed.protocol === 'http:' && /^(127\.0\.0\.1|\[::1\]|localhost)$/.test(parsed.hostname);
}

function assertSafeLlmBaseUrlSync(baseUrl) {
  let parsed;
  try { parsed = new URL(String(baseUrl || '').trim()); } catch (_) { throw new Error('AI_BASE_URL_INVALID'); }
  if (parsed.username || parsed.password) throw new Error('AI_BASE_URL_CREDENTIALS');
  // 本机 loopback 的 http 例外优先判定：本地 ollama 等自用场景，密钥不出本机
  if (isLoopbackHttpUrl(parsed)) return parsed;
  if (parsed.protocol !== 'https:') throw new Error('AI_BASE_URL_PROTOCOL');
  if (isBlockedLlmHost(parsed.hostname)) throw new Error('AI_BASE_URL_HOST_BLOCKED');
  return parsed;
}

async function assertSafeLlmBaseUrl(baseUrl) {
  const parsed = assertSafeLlmBaseUrlSync(baseUrl);
  if (!isLoopbackHttpUrl(parsed)) {
    // 域名再解析一次：防「公网域名 -> 内网 IP」的 DNS 指向
    let addrs = [];
    try { addrs = await dns.promises.lookup(parsed.hostname, { all: true }); }
    catch (_) { throw new Error('AI_BASE_URL_DNS_FAILED'); }
    if (!addrs.length) throw new Error('AI_BASE_URL_DNS_FAILED');
    for (const a of addrs) {
      if (isBlockedLlmHost(a.address)) throw new Error('AI_BASE_URL_IP_BLOCKED');
    }
  }
  return parsed.toString();
}

function readSecret() {
  // 优先走 secret-store（DPAPI 加密），回退明文
  try {
    const { readSecretFile } = require('../../desktop/secret-store');
    return readSecretFile(LLM_SECRET_FILE);
  } catch (_) {
    if (LLM_SECRET_FILE && fs.existsSync(LLM_SECRET_FILE)) {
      return fs.readFileSync(LLM_SECRET_FILE, 'utf8').trim();
    }
    return '';
  }
}

function writeSecret(value) {
  try {
    const { writeSecretFile } = require('../../desktop/secret-store');
    writeSecretFile(LLM_SECRET_FILE, value);
    return true;
  } catch (e) {
    console.error('[AI Route] writeSecret failed:', e.message);
    return false;
  }
}

function readConfig() {
  try {
    if (LLM_CONFIG_FILE && fs.existsSync(LLM_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(LLM_CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' };
}

function writeConfig(cfg) {
  if (!LLM_CONFIG_FILE) return;
  try {
    fs.writeFileSync(LLM_CONFIG_FILE, JSON.stringify({
      baseUrl: cfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      model: cfg.model || '',
    }, null, 2));
  } catch (e) {
    console.error('[AI Route] writeConfig failed:', e.message);
  }
}

function buildPlaylistPrompt(userPrompt, profile) {
  const systemMsg = '你是一位资深音乐策展人。根据用户的需求推荐歌曲，返回纯 JSON 数组，不要 markdown 代码块，不要额外解释。每首歌格式：{"title":"歌名","artist":"歌手","reason":"推荐理由(简短)"}。推荐 12~18 首，按推荐优先级排序。歌名和歌手用原文（中文歌用中文，英文歌用英文）。';
  let userMsg = '用户需求：' + (userPrompt || '推荐一些适合现在听的歌');
  if (profile) {
    const parts = [];
    if (profile.topArtists && profile.topArtists.length) {
      parts.push('常听歌手：' + profile.topArtists.slice(0, 5).map(a => a.name + '(' + a.plays + '次)').join('、'));
    }
    if (profile.topSongs && profile.topSongs.length) {
      parts.push('常听歌曲：' + profile.topSongs.slice(0, 5).map(s => s.name + ' - ' + (s.artist || '')).join('、'));
    }
    if (profile.totalPlays) {
      parts.push('累计播放：' + profile.totalPlays + ' 次');
    }
    if (parts.length) {
      userMsg += '\n用户听歌画像：' + parts.join('；') + '\n请结合用户偏好推荐，既要有符合口味的，也要有拓展探索的。';
    }
  }
  return { systemMsg, userMsg };
}

/* 月度听歌总结：把前端算好的统计摘要交给 LLM 写成一段话。
 * 只传聚合数字（不是原始记录），prompt 明确要求不编造 —— 数据里没有的东西不许写。 */
function buildListenSummaryPrompt(rangeDays, stats) {
  const days = Math.max(1, Math.min(400, Number(rangeDays) || 30));
  const systemMsg = [
    '你是一位懂音乐也懂人的乐评人，为听歌数据写一份「听歌人格报告」。',
    '',
    '输出格式（严格遵守）：',
    '1) 第一行是一个 6~12 字的人格标签，用 **加粗** 包裹，例如 **情绪过载的浪漫主义者**。不要用「音乐爱好者」「听歌达人」「音乐旅人」这类空词。',
    '2) 然后用空行分隔 2~3 段，每段 55~90 字。每段开头用一个短句加粗引导，形如 **听觉上你吃两套**：后面接正文。',
    '3) 最后可以有一句 40 字以内的收尾判断，不加粗。',
    '',
    '内容要求：',
    '- 必须引用用户数据里**真实出现过的歌名或歌手名**（至少 2 个），并说明它体现了什么。',
    '- 可以从歌名/歌手的气质做推断，但**绝对不许编造数据里没有出现的歌曲、歌手、专辑或数字**。',
    '- 要有观点和比喻，可以适度锋利，但不要人身攻击、不要说教。',
    '- 不要 emoji、不要列表符号、不要「总结：」这类引导语、不要 # 号标题。',
    '- 若曲目数少于 10，要诚实点出「样本还小」，但仍要从这几首歌里读出气质，不许敷衍。'
  ].join('\n');

  const lines = [];
  lines.push('统计区间：最近 ' + days + ' 天');
  if (stats.totalText) lines.push('累计时长：' + String(stats.totalText).slice(0, 40));
  lines.push('播放次数：' + (Number(stats.plays) || 0) + ' 次');
  lines.push('不重复曲目：' + (Number(stats.songs) || 0) + ' 首；歌手 ' + (Number(stats.artists) || 0)
    + ' 位；专辑 ' + (Number(stats.albums) || 0) + ' 张');
  if (stats.newShare != null) lines.push('新遇见占比：' + Math.round((Number(stats.newShare) || 0) * 100) + '%');
  if (stats.topShare != null) lines.push('头部集中度：' + Math.round((Number(stats.topShare) || 0) * 100) + '%');
  if (Array.isArray(stats.topSongs) && stats.topSongs.length) {
    lines.push('听过的歌（按时长降序，这是你能引用的全部曲目）：');
    stats.topSongs.slice(0, 8).forEach(s => {
      lines.push('- ' + String(s.name || '').slice(0, 60)
        + (s.artist ? ' — ' + String(s.artist).slice(0, 40) : '')
        + '（' + Math.round(Number(s.seconds) || 0) + ' 秒）');
    });
  }
  if (Array.isArray(stats.topArtists) && stats.topArtists.length) {
    lines.push('出现过的歌手：' + stats.topArtists.slice(0, 6).map(a => String(a).slice(0, 30)).join('、'));
  }
  if (stats.peakHour != null && Number.isFinite(Number(stats.peakHour))) {
    lines.push('最集中的时段：' + (Number(stats.peakHour) + ':00') + ' 前后');
  }
  lines.push('直接输出报告正文，不要任何开场白。');
  return { systemMsg, userMsg: lines.join('\n') };
}

function callLLM(baseUrl, apiKey, model, systemMsg, userMsg, opts) {
  opts = opts || {};
  assertSafeLlmBaseUrlSync(baseUrl); // 防线二：持久化里遗留的坏配置在发请求前拦截
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model: model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: opts.temperature != null ? opts.temperature : 0.8,
      max_tokens: opts.maxTokens || 2000,
    });
    const req = transport.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: opts.timeoutMs > 0 ? opts.timeoutMs : 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('LLM API ' + res.statusCode + ': ' + data.slice(0, 200)));
          return;
        }
        try {
          const json = JSON.parse(data);
          const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (!content) { reject(new Error('LLM 返回为空')); return; }
          resolve(content);
        } catch (e) {
          reject(new Error('LLM 响应解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM 请求超时(30s)')); });
    req.write(body);
    req.end();
  });
}

function parsePlaylistResponse(content) {
  // LLM 可能返回带 ```json 包裹或纯 JSON
  let text = content.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  // 找到第一个 [ 到最后一个 ]
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => item && item.title).map(item => ({
      title: String(item.title),
      artist: String(item.artist || ''),
      reason: String(item.reason || ''),
    }));
  } catch (_) {
    return [];
  }
}

// ---- 歌词翻译（LLM 逐行，带 LRU 缓存） ----
const AI_TRANSLATE_CACHE_MAX = 40;
const aiTranslateCache = new Map();

function aiTranslateCacheKey(items) {
  let h = 0x811c9dc5;
  const text = items.length + '|' + items.map(l => l.text).join('\u0001');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return String(h);
}

function buildTranslatePrompt(items) {
  const systemMsg = '你是歌词翻译引擎。把用户给出的编号歌词逐行翻译成简体中文，保持编号与行数完全一致，'
    + '返回纯 JSON 字符串数组（如 ["译文1","译文2"]），不要 markdown 代码块，不要解释。'
    + '不要合并或拆分行，保留人名与专有名词；若某行已是中文或为纯符号，直接原样返回该行内容。';
  const userMsg = items.map((l, i) => (i + 1) + '. ' + l.text).join('\n');
  return { systemMsg, userMsg };
}

function parseTranslateResponse(content, expectedCount) {
  let text = String(content || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length !== expectedCount) return null;
    return arr.map(v => String(v == null ? '' : v).trim());
  } catch (_) {
    return null;
  }
}

// ---- 本地智能推荐引擎（无需 LLM API Key 的默认路径） ----
// 三个来源并行：酷狗猜你喜欢（登录后基于听歌历史）+ 网易 prompt 关键词搜索
// + 常听歌手的更多热门作品；本地去重、过滤已听熟曲目、限制单歌手占比。
const LOCAL_PLAYLIST_WANT = 14;

function normalizeLocalSongName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function buildLocalPlaylistSongs(prompt, profile, ctx, deps) {
  const { cloudsearch, artist_top_song, mapSongRecord, handleKugouGuessLike } = deps;
  const seen = new Set();
  const collected = [];
  const listenedNames = new Set(
    ((profile && profile.topSongs) || []).map(s => normalizeLocalSongName(s && s.name))
  );

  function pushSongs(rawSongs, reason, sourceWeight) {
    (rawSongs || []).forEach(song => {
      if (!song) return;
      const name = song.name || song.songname || song.title || song.filename || '';
      let artist = song.artist || song.singer || song.singername || '';
      if (!artist && Array.isArray(song.artists)) artist = song.artists.map(a => (a && a.name) || '').filter(Boolean).join('/');
      if (!name || !normalizeLocalSongName(name)) return;
      const key = normalizeLocalSongName(name) + '|' + normalizeLocalSongName(artist);
      if (seen.has(key)) return;
      if (listenedNames.has(normalizeLocalSongName(name))) return;
      seen.add(key);
      collected.push({
        title: String(name),
        artist: String(artist).split('/')[0].trim(),
        reason: reason || '',
        sourceWeight: sourceWeight || 0,
      });
    });
  }

  const jobs = [];
  // 源 1：酷狗猜你喜欢（私人FM / 每日推荐 / 歌单聚合三层降级）
  jobs.push((async () => {
    try {
      const r = await handleKugouGuessLike(ctx.kugouCookie, 20);
      console.log('[AI Local] kugou guess songs:', (r && r.songs || []).length, (r && r.error) || '');
      pushSongs((r && r.songs) || [], '根据你的收听喜好推荐', 30);
    } catch (e) { console.warn('[AI Local] kugou source failed:', e.message); }
  })());

  // 源 2：网易 prompt 关键词搜索（贴合用户输入的场景/心情）
  const keyword = String(prompt || '').trim().slice(0, 40);
  if (keyword) {
    jobs.push((async () => {
      try {
        const r = await cloudsearch({ keywords: keyword, limit: 30, cookie: ctx.userCookie, timestamp: Date.now() });
        const songs = (r.body && r.body.result && r.body.result.songs) || [];
        console.log('[AI Local] netease keyword songs:', songs.length);
        pushSongs(songs.map(mapSongRecord), '符合「' + keyword + '」的氛围', 20);
      } catch (e) { console.warn('[AI Local] netease keyword failed:', e.message); }
    })());
  }

  // 源 3：常听歌手的更多热门作品
  const topArtists = ((profile && profile.topArtists) || []).slice(0, 3);
  jobs.push((async () => {
    for (const item of topArtists) {
      const artistName = item && item.name;
      if (!artistName) continue;
      try {
        const ar = await cloudsearch({ keywords: artistName, type: 100, limit: 1, cookie: ctx.userCookie, timestamp: Date.now() });
        const hit = ar.body && ar.body.result && ar.body.result.artists && ar.body.result.artists[0];
        if (!hit || !hit.id) { console.log('[AI Local] artist no-hit:', artistName); continue; }
        const top = await artist_top_song({ id: hit.id, cookie: ctx.userCookie, timestamp: Date.now() });
        const songs = (top.body && top.body.songs) || [];
        console.log('[AI Local] artist top songs:', artistName, songs.length);
        pushSongs(songs.map(mapSongRecord).slice(0, 10), '你常听 ' + artistName + '，试试更多作品', 10);
      } catch (e) { console.warn('[AI Local] artist source failed:', artistName, e.message); }
    }
  })());

  await Promise.all(jobs);

  // 选歌：按来源权重排序 + 每个歌手最多 2 首，保证多样性
  const perArtist = new Map();
  const picked = [];
  collected
    .sort((a, b) => (b.sourceWeight - a.sourceWeight) || (Math.random() - 0.5))
    .forEach(song => {
      if (picked.length >= LOCAL_PLAYLIST_WANT) return;
      const artistKey = normalizeLocalSongName(song.artist);
      const count = perArtist.get(artistKey) || 0;
      if (artistKey && count >= 2) return;
      perArtist.set(artistKey, count + 1);
      picked.push({ title: song.title, artist: song.artist, reason: song.reason });
    });
  return picked;
}

module.exports = function register(ctx) {
  const { sendJSON, readRequestBody, cloudsearch, artist_top_song, mapSongRecord, handleKugouGuessLike } = ctx;

  return async function(req, res, url, pn) {
/* 连接测试的错误分类：把 401/404/超时/域名解析分开，用户才知道该改哪一项。
 * 统一返回 200 + { ok:false, code, message }，让前端 apiJson 不必处理异常分支。 */
function describeAiTestError(err) {
  const msg = String((err && err.message) || err || '');
  if (/LLM API 40[13]/.test(msg)) return { code: 'BAD_KEY', message: '密钥无效或没有权限（401/403）' };
  if (/LLM API 404/.test(msg)) return { code: 'NOT_FOUND', message: '地址或模型不存在（404），检查服务地址与模型 ID' };
  if (/LLM API 429/.test(msg)) return { code: 'RATE_LIMIT', message: '请求过于频繁或额度不足（429）' };
  if (/timeout|ETIMEDOUT/i.test(msg)) return { code: 'TIMEOUT', message: '请求超时（10 秒内没有响应）' };
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return { code: 'NETWORK', message: '域名解析失败，检查网络或服务地址' };
  if (/ECONNREFUSED|ECONNRESET|EPIPE/.test(msg)) return { code: 'NETWORK', message: '连接被拒绝或中断' };
  if (/地址|baseUrl|base URL|URL/i.test(msg)) return { code: 'BLOCKED', message: msg.slice(0, 160) };
  return { code: 'OTHER', message: (msg.slice(0, 160) || '未知错误') };
}

    // GET /api/ai/config — 查询配置状态（不回传密钥）
    if (pn === '/api/ai/config' && req.method === 'GET') {
      const cfg = readConfig();
      const hasKey = !!readSecret();
      sendJSON(res, { configured: hasKey, baseUrl: cfg.baseUrl, model: cfg.model });
      return;
    }

    // POST /api/ai/test — 连接测试：只用**已保存**的配置发一次最小请求，不接受前端传地址
    // （前端传 baseUrl 等于把「带密钥向任意地址发请求」的口子重新打开，SSRF 白名单就白做了）
    if (pn === '/api/ai/test' && req.method === 'POST') {
      const apiKey = readSecret();
      if (!apiKey) { sendJSON(res, { ok: false, code: 'NO_KEY', message: '还没有保存 API Key' }); return; }
      const cfg = readConfig();
      if (!cfg.model) { sendJSON(res, { ok: false, code: 'NO_MODEL', message: '还没有填写模型 ID' }); return; }
      const startedAt = Date.now();
      try {
        const content = await callLLM(cfg.baseUrl, apiKey, cfg.model, '你是连通性测试助手。', '只回一个字：OK', { maxTokens: 8, timeoutMs: 10000 });
        sendJSON(res, {
          ok: true,
          model: cfg.model,
          latencyMs: Date.now() - startedAt,
          reply: String(content || '').slice(0, 40),
        });
      } catch (e) {
        sendJSON(res, { ok: false, ...describeAiTestError(e) });
      }
      return;
    }

    // POST /api/ai/config — 保存配置
    if (pn === '/api/ai/config' && req.method === 'POST') {
      try {
        const parsed = await readRequestBody(req); // readRequestBody 返回已解析对象
        if (parsed.baseUrl) {
          // 防线一：落盘前校验（https / 非内网 / 无URL凭证），防密钥外传与借进程探测内网
          const safeBaseUrl = await assertSafeLlmBaseUrl(parsed.baseUrl);
          const cfg = readConfig();
          cfg.baseUrl = safeBaseUrl;
          if (parsed.model !== undefined) cfg.model = parsed.model;
          writeConfig(cfg);
        }
        if (parsed.apiKey !== undefined) {
          writeSecret(parsed.apiKey);
        }
        sendJSON(res, { ok: true, configured: !!readSecret() });
      } catch (e) {
        sendJSON(res, { error: e.message }, 500);
      }
      return;
    }

    // POST /api/ai/listen-summary — 月度听歌总结（只吃聚合统计，不碰原始记录）
    if (pn === '/api/ai/listen-summary' && req.method === 'POST') {
      const apiKey = readSecret();
      if (!apiKey) { sendJSON(res, { ok: false, code: 'NO_KEY', message: '还没有保存 API Key，去「设置 → AI」填一个' }); return; }
      const cfg = readConfig();
      if (!cfg.model) { sendJSON(res, { ok: false, code: 'NO_MODEL', message: '还没有填写模型 ID' }); return; }

      let body = {};
      try { body = (await readRequestBody(req)) || {}; } catch (_) { body = {}; }
      const stats = (body && typeof body.stats === 'object' && body.stats) || {};
      /* 摘要来自前端，给个上限免得被塞进大段文本挤爆 token */
      if (JSON.stringify(stats).length > 8000) {
        sendJSON(res, { ok: false, code: 'TOO_LARGE', message: '统计数据过大' }, 413);
        return;
      }
      try {
        const { systemMsg, userMsg } = buildListenSummaryPrompt(body.range, stats);
        /* 偶发空返回（实测 1/3 概率），重试一次再判失败 —— 比直接弹错给用户好 */
        let summary = '';
        let lastErr = null;
        for (let attempt = 0; attempt < 2 && !summary; attempt++) {
          try {
            const content = await callLLM(cfg.baseUrl, apiKey, cfg.model, systemMsg, userMsg,
              { timeoutMs: 75000, maxTokens: 1400, temperature: 0.7 });
            summary = String(content || '').trim();
          } catch (e) {
            lastErr = e;
          }
        }
        if (!summary) throw new Error(lastErr ? lastErr.message : '模型返回为空');
        sendJSON(res, { ok: true, summary: summary.slice(0, 4000), model: cfg.model });
      } catch (e) {
        console.warn('[AI ListenSummary] failed:', e && e.message);
        sendJSON(res, { ok: false, code: 'LLM_FAILED', message: String((e && e.message) || '生成失败') }, 502);
      }
      return;
    }

    // POST /api/ai/playlist — 生成歌单（LLM 增强优先；未配置/失败自动降级本地智能推荐）
    if (pn === '/api/ai/playlist' && req.method === 'POST') {
      let llmError = null;
      let songs = [];
      let engine = 'local';
      let parsed = {};
      try {
        parsed = await readRequestBody(req) || {}; // 返回已解析对象；只读一次，LLM 与本地引擎共用
      } catch (_) { parsed = {}; }
      try {
        const apiKey = readSecret();
        if (apiKey) {
          try {
            const cfg = readConfig();
            const { systemMsg, userMsg } = buildPlaylistPrompt(parsed.prompt, parsed.profile);
            const content = await callLLM(cfg.baseUrl, apiKey, cfg.model, systemMsg, userMsg);
            songs = parsePlaylistResponse(content);
            if (songs.length) engine = 'llm';
          } catch (e) {
            llmError = e;
            console.warn('[AI Playlist] LLM failed, falling back to local engine:', e.message);
          }
        }
      } catch (e) {
        llmError = e;
      }
      if (!songs.length) {
        try {
          songs = await buildLocalPlaylistSongs(parsed.prompt, parsed.profile, ctx, {
            cloudsearch, artist_top_song, mapSongRecord, handleKugouGuessLike,
          });
        } catch (e) {
          console.error('[AI Playlist] local engine failed:', e.message);
        }
      }
      if (!songs.length) {
        const message = llmError ? ('LLM 调用失败且本地推荐为空：' + llmError.message) : '未能生成推荐，请稍后重试';
        sendJSON(res, { error: message }, 502);
        return;
      }
      sendJSON(res, { songs, engine, raw: '' });
      return;
    }
    // POST /api/ai/translate — 歌词逐行翻译
    if (pn === '/api/ai/translate' && req.method === 'POST') {
      try {
        const apiKey = readSecret();
        if (!apiKey) { sendJSON(res, { error: '未配置 LLM API Key，请先在设置中填写' }, 400); return; }
        const cfg = readConfig();
        const parsed = await readRequestBody(req);
        const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
        const items = rawLines
          .map(l => ({ t: Number(l && l.t) || 0, text: String((l && l.text) || '').slice(0, 240) }))
          .filter(l => l.text);
        if (!items.length) { sendJSON(res, { error: '没有可翻译的歌词行' }, 400); return; }
        if (items.length > 120) { sendJSON(res, { error: '歌词行数过多（>120），已拒绝翻译' }, 400); return; }
        const cacheKey = aiTranslateCacheKey(items);
        const cached = aiTranslateCache.get(cacheKey);
        if (cached) { sendJSON(res, { translations: cached, cached: true }); return; }
        const { systemMsg, userMsg } = buildTranslatePrompt(items);
        const content = await callLLM(cfg.baseUrl, apiKey, cfg.model, systemMsg, userMsg, {
          temperature: 0.2,
          maxTokens: Math.min(4000, 600 + 80 * items.length),
        });
        const translations = parseTranslateResponse(content, items.length);
        if (!translations) {
          sendJSON(res, { error: 'LLM 翻译行数与原文不匹配，已放弃本次结果' }, 502);
          return;
        }
        aiTranslateCache.set(cacheKey, translations);
        if (aiTranslateCache.size > AI_TRANSLATE_CACHE_MAX) {
          const oldest = aiTranslateCache.keys().next().value;
          aiTranslateCache.delete(oldest);
        }
        sendJSON(res, { translations, count: translations.length });
      } catch (e) {
        console.error('[AI Translate]', e.message);
        sendJSON(res, { error: e.message }, 500);
      }
      return;
    }
  };
};
