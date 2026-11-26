'use strict';

/*
 * AI 设置页守卫（2026-11-25）
 *
 * 后端本来就有 /api/ai/config、/api/ai/playlist、/api/ai/translate；这次只是把配置从
 * 「AI 歌单弹窗里的 ⚙」提到 设置 → AI，并新增一个连接测试接口。
 *
 * 五条底线：
 *   1) POST /api/ai/config 的语义是「只要出现 apiKey 就写盘」——空串等于清除。
 *      所以设置页留空时**不能**带这个字段，否则用户改个模型就把 Key 抹了。
 *   2) 清除密钥必须是显式动作（两段式按钮），不能混在保存里。
 *   3) 连接测试只允许用**已保存**的配置，绝不接受前端传 baseUrl ——
 *      否则「带密钥向任意地址发请求」的口子又开了，SSRF 白名单白做。
 *   4) 测试失败要分类（401/404/超时/域名），不能只回一句「失败」。
 *   5) 两个「AI 补译文」开关必须联动同一个 localStorage 键。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const LYRICS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'), 'utf8');
const AI_ROUTE = fs.readFileSync(path.join(ROOT, 'server/routes/ai.js'), 'utf8');

function sliceFn(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0, opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return '';
}

test('AI 分区与表单齐全', () => {
  assert.match(INDEX, /data-settings-tab="ai"/);
  assert.match(INDEX, /data-settings-page="ai"/);
  for (const id of ['ai-settings-baseurl', 'ai-settings-model', 'ai-settings-apikey',
    'ai-settings-status', 'ai-settings-save', 'ai-settings-test', 'ai-settings-clear',
    't-aiLyricTranslateSettings']) {
    assert.match(INDEX, new RegExp(`id="${id}"`), `缺少 ${id}`);
  }
});

test('留空 Key 时不能提交 apiKey 字段（否则等于清除）', () => {
  const save = sliceFn(SETTINGS_JS, 'function saveAiSettingsConfig');
  assert.ok(save, '必须有 saveAiSettingsConfig');
  assert.match(save, /if \(apiKey\) payload\.apiKey = apiKey;/, '只有填了才带上 apiKey');
  assert.doesNotMatch(save, /apiKey: apiKey/, '不能无条件把 apiKey 放进 payload');
  // 清除是独立动作，显式传空串
  const clear = sliceFn(SETTINGS_JS, 'function clearAiSettingsKey');
  assert.match(clear, /JSON\.stringify\(\{ apiKey: '' \}\)/, '清除必须显式传空串');
  assert.match(clear, /_aiClearArmed/, '两段式确认，避免误删');
});

test('连接测试只用已保存配置，且不改动 SSRF 防线', () => {
  const route = AI_ROUTE;
  assert.match(route, /pn === '\/api\/ai\/test'/, '必须有测试接口');
  const testBlock = route.slice(
    route.indexOf("pn === '/api/ai/test'"),
    route.indexOf("pn === '/api/ai/config' && req.method === 'POST'")
  );
  assert.ok(testBlock.length > 200, '要能截到测试接口的函数体');
  assert.match(testBlock, /readSecret\(\)/, '必须用已保存的密钥');
  assert.match(testBlock, /readConfig\(\)/, '必须用已保存的 baseUrl / model');
  assert.doesNotMatch(testBlock, /body|parsed|req\.arg/i, '测试接口不接受前端传地址或密钥');
  assert.match(testBlock, /timeoutMs: 10000/, '测试要有 10 秒超时');
  assert.match(route, /assertSafeLlmBaseUrl\(parsed\.baseUrl\)/, '保存配置时的 SSRF 校验必须保留');
  assert.match(route, /assertSafeLlmBaseUrlSync\(baseUrl\)/, '发请求前的二次校验必须保留');
});

test('错误分类覆盖 401/404/超时/域名', () => {
  const src = sliceFn(AI_ROUTE, 'function describeAiTestError');
  assert.ok(src, '必须有 describeAiTestError');
  const fn = new Function(src + '; return describeAiTestError;')();
  assert.equal(fn(new Error('LLM API 401: bad key')).code, 'BAD_KEY');
  assert.equal(fn(new Error('LLM API 403: nope')).code, 'BAD_KEY');
  assert.equal(fn(new Error('LLM API 404: not found')).code, 'NOT_FOUND');
  assert.equal(fn(new Error('connect ETIMEDOUT')).code, 'TIMEOUT');
  assert.equal(fn(new Error('getaddrinfo ENOTFOUND api.example.com')).code, 'NETWORK');
  assert.equal(fn(new Error('连接被拒绝 ECONNREFUSED')).code, 'NETWORK');
  assert.equal(fn(new Error('baseUrl 必须是 https 地址')).code, 'BLOCKED');
  assert.equal(fn(new Error('LLM 返回为空')).code, 'OTHER');
});

test('两个 AI 补译文开关联动同一状态', () => {
  const fn = sliceFn(LYRICS_JS, 'function updateAiLyricTranslateToggle');
  assert.match(fn, /t-aiLyricTranslateSettings/, '设置页那个开关也要跟着变');
  assert.match(fn, /t-aiLyricTranslate/, '视觉控制台那个仍要变');
  assert.match(LYRICS_JS, /mineradio-ai-translate-v1/, '共享同一个 localStorage 键');
});

test('DeepSeek 预设：只填地址与模型，不碰 Key、不自动保存', () => {
  // 取值来自官方文档（2026-11-25 核对）：base_url = https://api.deepseek.com（无需 /v1），
  // V4.1-Flash 的模型名是 deepseek-flash（旧名 deepseek-v4-flash 仍被路由到同一模型）。
  assert.match(INDEX, /id="ai-settings-preset-deepseek"/, '要有预设按钮');
  const preset = SETTINGS_JS.slice(
    SETTINGS_JS.indexOf('var AI_PRESET_DEEPSEEK'),
    SETTINGS_JS.indexOf('function bindAiSettings()')
  );
  assert.ok(preset.includes("baseUrl: 'https://api.deepseek.com'"),
    'base_url 必须是不带 /v1 的官方地址');
  assert.ok(preset.includes("model: 'deepseek-flash'"),
    '模型名必须是 deepseek-flash（V4.1-Flash）');
  assert.ok(!preset.includes('apiJson'), '预设不能自动保存');
  assert.ok(!preset.includes('apiKey ='), '预设不能改 Key 输入框');
  const fn = preset.slice(preset.indexOf('function fillAiDeepSeekPreset'));
  assert.match(fn, /ai-settings-baseurl/);
  assert.match(fn, /ai-settings-model/);
});
