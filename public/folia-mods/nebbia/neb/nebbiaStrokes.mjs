/* 笔顺数据源 —— **这个文件是重写的，不是移植的**（port-nebbia.mjs 的 OVERRIDES 里登记了，不会覆盖）。
 *
 * 官方做法：构建期用 tools/build-strokes.mjs 把 AnimCJK 的笔顺烧成 public/nebbia-strokes.json
 * （Arphic Public License，不进仓库），运行时一次性 fetch 整表，`getNebbiaStrokeMedians(ch)` 同步查表。
 *
 * 我们改成按字懒加载 hanzi-writer-data 的 `medians`。两者格式恰好一致：
 *   官方 AnimCJK  → [[ [x,y], ... ], ...]，1024 制
 *   hanzi-writer  → medians: [[ [x,y], ... ], ...]，1024 制、y 向下、按笔顺排列
 * 所以 nebbiaGlyphs 里那一句 `m.map(([x, y]) => [x / 1024, y / 1024])` 一个字都不用改。
 *
 * 代价是同步查询在数据到达前返回 null → 该字先用骨架（skeletonPolys）顶上；
 * 数据到了通过 setStrokeArrivedHook 通知运行时清字形缓存、重排一次。
 */
const CDN = [
  'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/',
  'https://unpkg.com/hanzi-writer-data@2.0/',
  'https://registry.npmmirror.com/hanzi-writer-data/2.0.1/files/',
];
const CONCURRENCY = 4;

const loaded = new Map();
const inflight = new Set();
const queue = [];
let active = 0;
let hook = null;

/** 数据到了调一次（运行时用它作废字形缓存并重排）。 */
export const setStrokeArrivedHook = (fn) => { hook = fn; };

/** 只在「真的需要笔顺」的字上花流量：CJK 统一表意文字。 */
const needsStrokes = (ch) => {
  if (!ch || ch.length !== 1) return false;
  const c = ch.codePointAt(0);
  return (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
};

/* 真实的坑：hanzi-writer 的 medians 是**屏幕坐标（y 向下）**，官方 AnimCJK 是**字体坐标（y 向上）**。
 * nebbiaGlyphs 里那句 `[x / 1024, y / 1024]` 是照字体坐标写的 —— 直接喂进去整段歌词会上下镜像。 */
const flipY = (medians) => medians.map((stroke) => stroke.map(([x, y]) => [x, 1024 - y]));

const fetchOne = async (ch) => {
  const name = encodeURIComponent(ch) + '.json';
  /* 同源优先：主进程的 /hanzi-strokes/<字>.json（server/lib/http-server.js）会替我们去取并落盘缓存。
   * 渲染层的 CSP 是 connect-src 'self'，直连下面那几个 CDN 一律被挡 —— 所以真机上这条路才是主路，
   * CDN 只是留给 dev-probe.html 这种没有主进程的场景。 */
  const sources = [];
  try { sources.push(new URL('/hanzi-strokes/' + name, location.href).href); } catch (_) {}
  for (const base of CDN) sources.push(base + name);
  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      return Array.isArray(data?.medians) && data.medians.length ? flipY(data.medians) : null;
    } catch (_) { /* 换下一个源 */ }
  }
  return null;
};

const pump = () => {
  while (active < CONCURRENCY && queue.length) {
    const ch = queue.shift();
    if (loaded.has(ch)) continue;
    active += 1;
    fetchOne(ch).then((medians) => {
      loaded.set(ch, medians);
      inflight.delete(ch);
      active -= 1;
      if (medians && hook) { try { hook(ch); } catch (_) {} }
      pump();
    });
  }
};

const enqueue = (ch) => {
  if (loaded.has(ch) || inflight.has(ch)) return;
  inflight.add(ch);
  queue.push(ch);
  pump();
};

/** 同步查表。没有就先排进队列，这一轮先用骨架。 */
export const getNebbiaStrokeMedians = (ch) => {
  const hit = loaded.get(ch);
  if (hit !== undefined) return hit;
  if (needsStrokes(ch)) enqueue(ch);
  return null;
};

/** 兼容官方 API：运行时构造时会 await 一次。这里没有整表可等，直接放行。 */
export const loadNebbiaStrokes = () => Promise.resolve(true);

/** 探针用。 */
export const nebbiaStrokeStats = () => ({
  loaded: loaded.size,
  hits: [...loaded.values()].filter(Boolean).length,
  waiting: queue.length + inflight.size,
});
