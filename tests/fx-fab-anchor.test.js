'use strict';
// 守卫：视觉控制台开关（#fx-fab）与它的自动隐藏箭头固定在右下角，
// 不随底部控制条（body.controls-visible）升起。用户 2026-11-14 明确要求。
// 历史缺陷：fx-panel.css 里 controls-visible 把 fab 从 bottom:24px 抬到 126px，
// 控制条一升起开关就跟着往上跳。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function cssRuleBlocks(file) {
  const raw = read(file).replace(/\/\*[\s\S]*?\*\//g, ''); // 去掉注释，避免注释文字被当成选择器
  return raw.split('}').map((b) => b.trim()).filter(Boolean).map((b) => {
    const brace = b.indexOf('{');
    return { selector: brace < 0 ? '' : b.slice(0, brace), body: brace < 0 ? '' : b.slice(brace + 1) };
  });
}

function allFiles(dir, ext) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...allFiles(rel, ext));
    else if (ent.name.endsWith(ext)) out.push(rel);
  }
  return out;
}

test('视觉控制台开关的基准位置：24px / 箭头 37px', () => {
  const blocks = cssRuleBlocks('public/css/07-fx/fx-panel.css');
  const fab = blocks.find((b) => b.selector.trim() === '#fx-fab');
  const hide = blocks.find((b) => b.selector.trim() === '#fx-fab-hide-btn');
  assert.ok(fab && hide, '必须能找到两个基础规则');
  assert.match(fab.body, /bottom:24px/, 'fab 基准 bottom 应为 24px');
  assert.match(hide.body, /bottom:37px/, '箭头基准 bottom 应为 37px');
});

test('controls-visible 下 fab 与箭头都不许被抬升（全仓 CSS 扫描）', () => {
  let checked = 0;
  for (const f of allFiles('public/css', '.css')) {
    for (const b of cssRuleBlocks(f)) {
      if (!/controls-visible/.test(b.selector)) continue;
      if (!/#fx-fab/.test(b.selector)) continue;
      const m = b.body.match(/bottom:(\d+)px/);
      assert.ok(m, f + ' 的这条 controls-visible 规则没写 bottom，可能被别处覆盖：' + b.selector.trim());
      const value = Number(m[1]);
      const isHide = /#fx-fab-hide-btn/.test(b.selector);
      // 普通屏基准 24/37；max-height:760px 的短屏用 22/35。只有这四个值允许。
      const allowed = isHide ? [37, 35] : [24, 22];
      assert.ok(allowed.includes(value),
        f + ' 把 ' + (isHide ? '箭头' : '视觉控制台开关') + ' 抬到了 bottom:' + value + 'px（应固定在 ' + allowed.join('/') + 'px）：' + b.selector.trim());
      checked++;
    }
  }
  assert.ok(checked >= 4, '至少要检查到 4 条 controls-visible 规则（普通屏 + 短屏各一组），实际 ' + checked);
});

test('没有 JS 绕过 CSS 直接改 #fx-fab 的位置', () => {
  for (const f of allFiles('public/js', '.js')) {
    const src = read(f);
    assert.ok(!/(getElementById\(['"]fx-fab['"]\)|fxFab).{0,80}style\.bottom/.test(src),
      f + ' 直接改了 #fx-fab 的 style.bottom，会绕过固定位置');
  }
});

// 用户改完 CSS 后仍看到旧行为：CSS link 带固定版本号，内容更新却命中磁盘缓存。
// 三层防线：HTML inline 锁定（压过缓存里的旧规则）、版本号 bump（重启后强制拉新）、
// CSS !important（压过任何后来加载的抬升规则）。
test('CSS 缓存防线：inline 锁定 + 版本号 bump + !important', () => {
  const html = read('public/index.html');
  assert.match(html, /id="fx-fab"[^>]*style="bottom:24px"/,
    '#fx-fab 必须用 inline 锁死 bottom，否则缓存里的旧抬升规则仍会生效');
  assert.match(html, /id="fx-fab-hide-btn"[^>]*style="bottom:37px"/,
    '自动隐藏箭头也要 inline 锁定，否则两个按钮会分离');
  assert.match(html, /fx-panel\.css\?v=3\.0\.2-fpsgroups/,
    'CSS 版本号必须 bump，否则重启后仍可能命中磁盘缓存里的旧文件');
  assert.ok(!/fx-panel\.css\?v=3\.0\.1-fabanchor/.test(html), '旧版本号不能残留');

  const css = read('public/css/07-fx/fx-panel.css');
  const anchored = css.match(/controls-visible #fx-fab(?:-hide-btn)?\{bottom:\d+px!important\}/g) || [];
  assert.ok(anchored.length >= 4,
    '普通屏与短屏的四条固定规则都要带 !important，实际 ' + anchored.length + ' 条');
});
