'use strict';

/*
 * 设置备份守卫（2026-11-25）
 *
 * 「导出设置」是外部文件：一旦混进登录凭据，用户随手发出去就等于泄号；
 * 一旦导入时不做白名单过滤，一个构造过的 JSON 就能往任意 localStorage 键里写东西。
 *
 * 四条底线：
 *   1) 导出只读白名单，且白名单里不能出现凭据 / 歌单 / 缓存 / 统计类键；
 *   2) 导入只写白名单里的键，且是「合并」语义 —— 不能 localStorage.clear()；
 *   3) 版本比当前新、kind 不对、文件过大，都要拒绝并给出原因；
 *   4) 重启入口走 restartApp，不能自定义 process 操作。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/10-shell/31-settings-page.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const listStart = SETTINGS_JS.indexOf('var SETTINGS_BACKUP_KEYS = [');
const listEnd = SETTINGS_JS.indexOf('];', listStart);
const keyList = SETTINGS_JS.slice(listStart, listEnd);
const blockStart = SETTINGS_JS.indexOf('var SETTINGS_BACKUP_KIND');
const blockEnd = SETTINGS_JS.indexOf('function bindSettingsBackup()');
const backupBlock = SETTINGS_JS.slice(blockStart, blockEnd);

test('白名单里不能混进凭据 / 歌单 / 缓存 / 统计', () => {
  assert.ok(listStart > 0 && listEnd > listStart, '必须有 SETTINGS_BACKUP_KEYS 白名单');
  /* 注意别写成裸 playlist：mineradio-playlist-panel-pinned-v1 只是「面板是否钉住」的 UI 偏好，
   * 不是用户歌单内容（后者叫 mineradio-local-playlists-v1）。 */
  const forbidden = /login|cookie|token|session-pack|vip-evidence|local-playlists|listen-stats|search-history|local-beatmaps|discover-cache|weather-cache|custom-covers|custom-lyrics/i;
  const hits = keyList.split('\n')
    .map((line) => (line.match(/'([^']+)'/) || [])[1])
    .filter(Boolean)
    .filter((key) => forbidden.test(key));
  assert.deepEqual(hits, [], `这些键不该进备份：${hits.join(', ')}`);
  assert.match(keyList, /mineradio-lyric-layout-v1/, '核心外观参数必须在备份里');
  assert.match(keyList, /mineradio-hotkey-settings-v1/, '热键必须在备份里');
});

test('导出走系统保存对话框，内容是带版本的自有格式', () => {
  assert.match(backupBlock, /exportJsonFile\(/, '必须用现成的导出 IPC');
  assert.match(backupBlock, /kind: SETTINGS_BACKUP_KIND/);
  assert.match(backupBlock, /version: SETTINGS_BACKUP_VERSION/);
  assert.match(backupBlock, /JSON\.stringify\(payload, null, 2\)/);
});

test('导入只写白名单键，且是合并语义', () => {
  assert.match(backupBlock, /hasOwnProperty\.call\(values, key\)/, '必须逐键检查备份里是否存在');
  assert.match(backupBlock, /SETTINGS_BACKUP_KEYS/, '必须按白名单写入');
  assert.doesNotMatch(backupBlock, /localStorage\.clear\(\)/, '导入不能清空整个 localStorage');
  assert.match(backupBlock, /data\.kind !== SETTINGS_BACKUP_KIND/, '要校验文件类型');
  assert.match(backupBlock, /version > SETTINGS_BACKUP_VERSION/, '要拒绝更高版本的备份');
  assert.match(backupBlock, /SETTINGS_BACKUP_MAX_BYTES/, '要限制文件大小');
});

test('重启入口走 restartApp', () => {
  assert.match(backupBlock, /restartApp\(\)/);
  assert.doesNotMatch(backupBlock, /require\('child_process'\)|process\.exit/, '前端不做进程操作');
});

test('设置页三个入口与状态行都在', () => {
  assert.match(INDEX, /id="settings-backup-export"/);
  assert.match(INDEX, /id="settings-backup-import"/);
  assert.match(INDEX, /id="settings-backup-restart"/);
  assert.match(INDEX, /id="settings-backup-status"/);
  assert.match(SETTINGS_JS, /bindSettingsBackup\(\);/, '初始化时要绑定三个入口');
});
