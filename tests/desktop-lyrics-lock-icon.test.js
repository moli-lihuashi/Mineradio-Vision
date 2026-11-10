'use strict';

// 桌面歌词锁图标（morphicons）回归守。
//
// 用户要求：用 morphicons 的 lock / unlock 替换原来那枚「两段伪元素拼出来的挂锁」。
// 落点是 public/desktop-lyrics.html（独立覆盖层窗口，不是主界面的 index.html）。
// 守六件事：
//   ① 图标是真正的 SVG（viewBox 24 + path），旧的手绘伪元素彻底删掉，别留两套并存；
//   ② morphicons 是项目已有的 vendor（classic build），必须在本页脚本之前同步加载；
//   ③ lock / lock-open 的两段子路径同构（同一锁体 + 只有锁梁不同），否则形变会互相穿插；
//   ④ 切换走 syncLockClasses() 唯一出口，状态没变不重复发形变（状态轮询每 45s 一次）；
//   ⑤ 库缺失 / createMorph 抛错时必须直接写 d 落位 —— 图标不能因为动画库没加载就消失；
//   ⑥ 页面自身 CSP 允许同源脚本，且没有引入任何网络请求。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/desktop-lyrics.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 没有闭合');
}

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, '未找到起点 ' + from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, '未找到终点 ' + to);
  return source.slice(a, b);
}

const LOCK_BODY = 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z';

test('锁图标是 SVG + path，旧的伪元素画法已彻底移除', () => {
  assert.match(html, /<svg class="lock-icon" viewBox="0 0 24 24"[^>]*>\s*<path d=""><\/path>\s*<\/svg>/,
    '锁图标必须是 24 网格的 SVG，里面一条 path 交给 morphicons 写 d');
  assert.doesNotMatch(html, /<span class="lock-icon">/, '旧的 span 版锁图标必须删掉');
  assert.doesNotMatch(html, /\.lock-icon::before/, '锁体不许再靠伪元素画');
  assert.doesNotMatch(html, /\.lock-icon::after/, '锁梁不许再靠伪元素画');
  assert.doesNotMatch(html, /body\.unlocked \.lock-icon::after/, '旧的「转一下锁梁」也要删掉，避免和形变打架');
  assert.match(html, /\.lock-icon path\{[^}]*stroke:var\(--lyric-highlight\)/, '描边要跟随歌词高亮色');
  assert.match(html, /\.lock-icon path\{[^}]*stroke-linecap:round/, '圆头描边才像 Lucide');
});

test('morphicons 用的是项目已有 classic build，且在本页脚本之前加载', () => {
  const sdk = html.indexOf('vendor/morphicons/morphicons.global.js');
  const use = html.indexOf('window.Morphicons.createMorph');
  const inline = html.indexOf("'use strict';");
  assert.ok(sdk >= 0, '页面必须引入 vendor/morphicons/morphicons.global.js');
  assert.ok(inline > sdk, '脚本顺序：先加载 morphicons，再执行页面脚本');
  assert.ok(use > sdk, '使用点必须在库之后');
  assert.doesNotMatch(html, /morphicons@|cdn\.jsdelivr|unpkg\.com|esm\.sh/, '不许改成 CDN 依赖，离线也要能用');
});

test('lock / lock-open 的几何同构：同一条锁体，只有锁梁不同（两段子路径可配对）', () => {
  const lock = between(html, 'var LOCK_ICON_D = ', ';');
  const open = between(html, 'var UNLOCK_ICON_D = ', ';');
  assert.match(lock, new RegExp(LOCK_BODY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '锁体路径必须与 Lucide lock 一致');
  assert.match(open, new RegExp(LOCK_BODY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '解锁态锁体必须完全一样，形变才不会抖');
  assert.match(lock, /M7 11V7a5 5 0 0 1 10 0v4/, '锁定态：锁梁闭合（v4 收口在锁体上沿）');
  assert.match(open, /M7 11V7a5 5 0 0 1 9\.9-1/, '解锁态：锁梁向右抬起（Lucide lock-open）');
  const count = (s) => (s.match(/[Mm]/g) || []).length;
  assert.strictEqual(count(lock), 2, '锁定态必须是两段子路径（锁体 + 锁梁）');
  assert.strictEqual(count(open), 2, '解锁态也必须是两段，段数一致才能一一配对');
});

test('切换只有一个出口：syncLockClasses → syncLockIcon', () => {
  const syncClasses = extractFunction(html, 'syncLockClasses');
  assert.match(syncClasses, /syncLockIcon\(locked\)/, '状态同步里必须驱动图标');
  const calls = html.match(/syncLockIcon\s*\(/g) || [];
  assert.strictEqual(calls.length, 2, 'syncLockIcon 只允许「定义 + 一处调用」，实际 ' + calls.length + ' 次');
});

test('syncLockIcon：首次落位、状态去重、形变带弹簧', () => {
  const fn = extractFunction(html, 'syncLockIcon');
  assert.match(fn, /path\.setAttribute\('d', want\)/, '首次（或没有库时）要直接写 d，先保证画出来');
  assert.match(fn, /if \(lockIconLocked === !!locked\) return;/, '状态没变不要再发一次形变（状态每 45s 轮询一次）');
  assert.match(fn, /window\.Morphicons\.createMorph\(path, want\)/, '用 createMorph 接管 path');
  assert.match(fn, /morphTo\(want, 'snappy'\)/, '切换用 snappy 弹簧，和主界面控制台图标一致');
  assert.match(fn, /catch \(err\) \{\s*lockIconMorph = null;/, '库挂了要降级成直切，不能留个半死实例');
  assert.match(fn, /catch \(err\) \{\}/, 'morphTo 抛错不能把状态切换带崩');
});

test('页面 CSP 仍允许同源脚本、且没有新增网络出口', () => {
  const csp = between(html, 'Content-Security-Policy', '>');
  assert.match(csp, /script-src 'self' 'unsafe-inline'/, '内联脚本 + 同源 vendor 脚本都要放行');
  assert.match(csp, /connect-src 'self'/, '不许放开外连');
  assert.doesNotMatch(csp, /connect-src[^;]*https?:/, 'CSP 不允许外网地址');
});
