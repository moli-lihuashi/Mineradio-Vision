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

const LLM_SECRET_FILE = process.env.LLM_SECRET_FILE || '';
const LLM_CONFIG_FILE = process.env.LLM_CONFIG_FILE || '';

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

function callLLM(baseUrl, apiKey, model, systemMsg, userMsg) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model: model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.8,
      max_tokens: 2000,
    });
    const req = transport.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
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

module.exports = function register(ctx) {
  const { sendJSON, readRequestBody } = ctx;

  return async function(req, res, url, pn) {
    // GET /api/ai/config — 查询配置状态（不回传密钥）
    if (pn === '/api/ai/config' && req.method === 'GET') {
      const cfg = readConfig();
      const hasKey = !!readSecret();
      sendJSON(res, { configured: hasKey, baseUrl: cfg.baseUrl, model: cfg.model });
      return;
    }

    // POST /api/ai/config — 保存配置
    if (pn === '/api/ai/config' && req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        if (parsed.baseUrl) {
          const cfg = readConfig();
          cfg.baseUrl = parsed.baseUrl;
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

    // POST /api/ai/playlist — 生成歌单
    if (pn === '/api/ai/playlist' && req.method === 'POST') {
      try {
        const apiKey = readSecret();
        if (!apiKey) { sendJSON(res, { error: '未配置 LLM API Key，请先在设置中填写' }, 400); return; }
        const cfg = readConfig();
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        const { systemMsg, userMsg } = buildPlaylistPrompt(parsed.prompt, parsed.profile);
        const content = await callLLM(cfg.baseUrl, apiKey, cfg.model, systemMsg, userMsg);
        const songs = parsePlaylistResponse(content);
        if (!songs.length) { sendJSON(res, { error: 'LLM 未返回有效歌单，请重试' }, 502); return; }
        sendJSON(res, { songs, raw: content.slice(0, 500) });
      } catch (e) {
        console.error('[AI Playlist]', e.message);
        sendJSON(res, { error: e.message }, 500);
      }
      return;
    }
  };
};
