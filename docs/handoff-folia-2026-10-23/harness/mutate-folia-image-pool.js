/* 突变自证：证明 smoke-folia-tuning-bg-panels.js 的 I9 段（自定义图上传行）真拦得住回归。
 *
 * 用法：node .workbuddy/harness/mutate-folia-image-pool.js
 * 判定：每个突变都必须让 smoke 非零退出、且 FAIL 行里出现它声明的判据；
 *       全部拦住 + 还原后全过 + 仓库零改动 → 退出码 0。
 *
 * 锚点行尾：00b / 0l 是纯 LF，0l1 是纯 CRLF —— 多行锚点必须照着写，否则整条按 MISSED 计。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'public', 'js', 'modules', '12-folia');
const COPY = path.join(ROOT, '.workbuddy', 'tmp', 'mut-image-pool');
const SMOKE = path.join(__dirname, 'smoke-folia-tuning-bg-panels.js');
const NODE = process.execPath;

const FILES = [
  '00b-folia-image-pool.js',
  '01-folia-mode-registry.js',
  '01a-folia-bg-sora.js',
  '01b-folia-bg-common.js',
  '01c-folia-bg-latent.js',
  '01d-folia-bg-monet.js',
  '01e-folia-bg-noise-texture.js',
  '01f-folia-bg-nomand.js',
  '01g-folia-bg-url.js',
  '0l0-folia-mode-tuning.js',
  '0l-folia-tuning-panel.js',
  '0l1-folia-mode-panels.js',
];

const POOL = '00b-folia-image-pool.js';
const P0 = '0l-folia-tuning-panel.js';
const PP = '0l1-folia-mode-panels.js';

const MUTATIONS = [
  /* ---- 00b 图片池内核 ---- */
  {
    file: POOL,
    name: 'pool: 背景槽键名抄错（与 Folia 的 monet_background_image 不一致）',
    from: "  background: 'monet_background_image',",
    to: "  background: 'monet_bg_image',",
    expect: '五个资产键名'
  },
  {
    file: POOL,
    name: 'pool: 格式校验恒通过（.txt 也能落盘）',
    from: '    if (!foliaAssetIsImageFile(file)) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.unsupported }); return; }',
    to: '    if (false) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.unsupported }); return; }',
    expect: '.txt 被拒'
  },
  {
    file: POOL,
    name: 'pool: 空选不拦（把 undefined 当文件继续走）',
    from: '    if (!file) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.selectFile }); return; }',
    to: '    if (false) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.selectFile }); return; }',
    expect: '空选被拒'
  },
  {
    file: POOL,
    name: 'pool: 只桥接莫奈全局（漫游拿不到同一张图）',
    from: '  window.foliaNomandCustomImage = value;',
    to: '  /* mutated: 漫游那条不写 */',
    expect: '桥接两个全局'
  },
  {
    file: POOL,
    name: 'pool: 清空时不更新快照（图还在池里）',
    from: '      foliaAssetIngest(key, null);\n      foliaAssetBridgeGlobals();',
    to: '      /* mutated: 快照不清 */\n      foliaAssetBridgeGlobals();',
    expect: '清空后池归零'
  },
  {
    file: POOL,
    name: 'pool: 上传不生成对象 URL（面板拿不到图）',
    from: '    try { url = URL.createObjectURL(entry.blob); } catch (_) { url = \'\'; }',
    to: '    url = \'\'; /* mutated */',
    expect: 'blob: 地址'
  },

  /* ---- 0l 上传行本体 ---- */
  {
    file: P0,
    name: 'row: 上传成功后不刷新面板（文件名/药丸都不更新）',
    from: '        if (typeof options.onFailed === \'function\') options.onFailed(message);\n      }\n      foliaRefreshTuningPanel();',
    to: '        if (typeof options.onFailed === \'function\') options.onFailed(message);\n      }',
    expect: '选文件后'
  },
  {
    file: P0,
    name: 'row: 清空按钮恒可用（没有图也点得动）',
    from: '  clear.disabled = !hasAsset;',
    to: '  clear.disabled = false;',
    expect: '无图时清空按钮禁用'
  },
  {
    file: P0,
    name: 'row: 文件名行恒显示「-」（不回显）',
    from: '  var nameText = foliaAssetFeedback[scope] || entryName || \'未选择\';',
    to: '  var nameText = \'未选择\';',
    expect: '有图时清空可用'
  },
  {
    file: P0,
    name: 'monet-bg: 上传成功不把来源切到自定义',
    from: '        binding.set(foliaTuningPatch(\'backgroundSource\', \'uploaded-global\'));',
    to: '        /* mutated: 来源不动 */',
    expect: '来源切到 uploaded-global'
  },
  {
    file: P0,
    name: 'row: 头行不挂标签（与其它控件骨相不一致）',
    from: "  head.appendChild(foliaTuningEl('span', 'fx-folia-tuning-label', options.label || '图片文件'));",
    to: '  /* mutated: 标签不挂 */',
    expect: '头行有标签'
  },
  {
    file: P0,
    name: 'row: 有图时不显示缩略图',
    from: '  var thumb;\n  if (entryUrl) {\n    thumb = document.createElement(\'img\');',
    to: '  var thumb;\n  if (false) {\n    thumb = document.createElement(\'img\');',
    expect: '缩略图'
  },
  {
    file: P0,
    name: 'nomand: 成功文案抄错',
    from: "  uploadSuccess: '背景图片上传成功',",
    to: "  uploadSuccess: '上传成功',",
    expect: '漫游上传后'
  },

  /* ---- 0l1 莫奈样式面板（CRLF） ---- */
  {
    file: PP,
    name: 'monet-portrait: 药丸不看池（恒禁用，有图也用不了）',
    from: "  var hasUploaded = (window.foliaAssetCount ? window.foliaAssetCount('portrait') > 0 : false)",
    to: "  var hasUploaded = false && (window.foliaAssetCount ? window.foliaAssetCount('portrait') > 0 : false)",
    expect: '药丸解禁'
  },
  {
    file: PP,
    name: 'monet-portrait: 清空后来源不回退（停在 custom 但没图）',
    from: "      if (binding.get().portraitSource === 'custom') {\r\n        binding.set(foliaTuningPatch('portraitSource', 'cover'));",
    to: "      if (false) {\r\n        binding.set(foliaTuningPatch('portraitSource', 'cover'));",
    expect: '清空肖像'
  }
];

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runSmoke = () => {
  const res = spawnSync(NODE, [SMOKE], {
    encoding: 'utf8',
    cwd: ROOT,
    env: Object.assign({}, process.env, { FOLIA_MOD_DIR: COPY })
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

fs.mkdirSync(COPY, { recursive: true });
const pristine = {};
for (const f of FILES) {
  pristine[f] = fs.readFileSync(path.join(SRC, f));
  fs.writeFileSync(path.join(COPY, f), pristine[f]);
}
const repoBefore = FILES.map((f) => f + ' ' + sha256(path.join(SRC, f)));
console.log('副本目录 ' + COPY + '（' + FILES.length + ' 个文件）');

const base = runSmoke();
if (base.code !== 0) {
  console.log('前提失败：干净副本的基线 smoke 不过，先修 baseline');
  console.log(base.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
  console.log(base.stderr);
  process.exit(1);
}
console.log('基线 ' + (base.stdout.match(/ALL PASS \(\d+ 项\)/) || ['ALL PASS'])[0]);

let caught = 0;
for (const m of MUTATIONS) {
  const target = path.join(COPY, m.file);
  const original = fs.readFileSync(target, 'utf8');
  try {
    if (original.indexOf(m.from) < 0) {
      console.log('MISSED  ' + m.name + ' :: 锚点在副本里找不到（判据失效，按未拦住计）');
      continue;
    }
    fs.writeFileSync(target, original.split(m.from).join(m.to));
    const r = runSmoke();
    const fails = r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
    const hit = fails.some((l) => l.indexOf(m.expect) >= 0);
    if (r.code !== 0 && hit) {
      caught += 1;
      console.log('BLOCKED ' + m.name + ' → ' + (fails.find((l) => l.indexOf(m.expect) >= 0) || '').slice(0, 92));
    } else {
      console.log('MISSED  ' + m.name + ' :: exit=' + r.code
        + ' expect="' + m.expect + '" fails=' + JSON.stringify(fails.slice(0, 3)));
    }
  } finally {
    fs.writeFileSync(target, original);
  }
}

const repoAfter = FILES.map((f) => f + ' ' + sha256(path.join(SRC, f)));
const untouched = repoBefore.join('\n') === repoAfter.join('\n');
const after = runSmoke();
console.log('\n' + caught + '/' + MUTATIONS.length + ' 个突变被拦住；还原后 smoke '
  + (after.code === 0 ? '恢复全过' : '没恢复（危险）') + '；仓库 '
  + (untouched ? '零改动（sha256 前后一致）' : '被改动了（危险）'));
process.exit(caught === MUTATIONS.length && untouched && after.code === 0 ? 0 : 1);
