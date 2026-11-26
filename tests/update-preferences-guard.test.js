'use strict';

/*
 * 更新偏好守卫（2026-11-25）
 *
 * 对应 Folia 的 `enableUpdateCheck` / `enableAutoUpdate`。我们原本是「启动 9 秒后无条件查一次」，
 * 用户既关不掉、也不能让新版本自动下好。现在两个开关都在「设置 → 关于 → 更新」。
 *
 * 四个必须钉住的点：
 *   1) 启动检查默认开（老行为不变），自动下载默认关（不替用户下载东西）；
 *   2) 关掉启动检查时，initUpdatePreview 不能只是「查了不显示」——必须真的不查、也不点亮点入口；
 *   3) 关掉之后手动入口（三条杠 → 检查更新）仍然要能查：openUpdatePanel 在没检查过时补一次；
 *   4) 自动下载要按版本去重，否则每次定时检查都会重启下载任务。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UPDATE_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/08-account/00-update-preview.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const fnBody = (source, marker) => {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return '';
};

test('默认值：启动检查开、自动下载关', () => {
  assert.match(UPDATE_JS, /UPDATE_CHECK_ON_START_KEY = 'mineradio:update-check-on-start:v1'/);
  assert.match(UPDATE_JS, /UPDATE_AUTO_DOWNLOAD_KEY = 'mineradio:update-auto-download:v1'/);
  assert.match(UPDATE_JS, /getItem\(UPDATE_CHECK_ON_START_KEY\) !== 'false'/,
    '启动检查必须是「没存过值 = 开」，否则老用户升级后行为会变');
  assert.match(UPDATE_JS, /getItem\(UPDATE_AUTO_DOWNLOAD_KEY\) === 'true'/,
    '自动下载必须是「明确存了 true 才开」');
});

test('关掉启动检查 = 真的不查，也不点亮更新入口', () => {
  const init = fnBody(UPDATE_JS, 'function initUpdatePreview');
  assert.match(init, /!updateCheckOnStartEnabled\(\)/, '必须按开关决定是否检查');
  const gatePos = init.indexOf('!updateCheckOnStartEnabled()');
  const checkPos = init.indexOf('checkLatestUpdate()');
  assert.ok(gatePos > 0 && gatePos < checkPos, '开关判断必须在 checkLatestUpdate 之前');
  assert.match(init, /setUpdatePreviewVisible\(false\)/, '关掉时要把更新入口收起来');
  assert.match(init, /return;/, '关掉时不能继续走呼吸动画（那会把入口重新点亮）');
});

test('手动入口在从未检查过时会补一次', () => {
  const open = fnBody(UPDATE_JS, 'function openUpdatePanel');
  assert.match(open, /!updatePreviewState\.checked\) checkLatestUpdate\(\)/,
    '关掉启动检查后，三条杠里的「检查更新」仍要能查出结果');
});

test('自动下载：按版本去重，假数据/无地址/下载中都不触发', () => {
  const auto = fnBody(UPDATE_JS, 'function maybeAutoDownloadUpdate');
  assert.ok(auto, '必须有 maybeAutoDownloadUpdate');
  assert.match(auto, /updateAutoDownloadEnabled\(\)/, '必须先看开关');
  assert.match(auto, /updatePreviewState\.preview/, 'preview 假数据不能触发真实下载');
  assert.match(auto, /status === 'downloading'/, '下载中不能重复触发');
  assert.match(auto, /autoDownloadedVersion === version/, '同一版本只自动下载一次');
  assert.match(auto, /patchAvailable/, '有增量补丁时优先用补丁');
  const apply = fnBody(UPDATE_JS, 'function applyLatestUpdateInfo');
  assert.match(apply, /maybeAutoDownloadUpdate\(\)/, '检查结果落地后要进入自动下载判定');
});

test('检查去重：并发调用不会打两次接口', () => {
  const check = fnBody(UPDATE_JS, 'async function checkLatestUpdate');
  assert.match(check, /updatePreviewState\.checking\) return/, '必须有 in-flight 去重');
  assert.match(check, /updatePreviewState\.checked = true/, '成功/失败都要记录「已检查过」');
});

test('设置页有两个开关，并在打开时同步状态', () => {
  assert.match(INDEX, /id="t-updateCheckOnStart"[^>]*onclick="toggleUpdateCheckOnStart\(\)"/);
  assert.match(INDEX, /id="t-updateAutoDownload"[^>]*onclick="toggleUpdateAutoDownload\(\)"/);
  assert.match(SETTINGS_JS, /applyUpdatePrefsUi\(\)/,
    '打开设置页要回填两个开关，否则显示与实际相反');
});
