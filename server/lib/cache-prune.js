'use strict';

// =============================================================================
// 磁盘缓存容量裁剪（借 Folia audioCachePrune 的选汰规则）
//
// 这里的「缓存」是节拍 map 的落盘文件（server/lib/beatmap-cache.js）：每首歌一个 JSON，
// 会随听歌数量无限增长。淘汰规则必须是纯函数 —— 排序方向反了会把最常听的丢掉、
// 留下从不回访的那些，而这件事在测试里能一眼看住。
//
// usedAt 取文件 mtime；读取命中时由 beatmap-cache 刷一次 mtime，语义就变成
// 「最近播放」而不是「最早下载」。
// =============================================================================

const DEFAULT_CACHE_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * 解析上限。
 * 0 是用户明确要求「不要上限」，是有效答案，不能当成缺省值；
 * 其它不可用值回落到默认值，而不是回落到「永不清理」—— 无上限正是这个模块要防的状态。
 */
function resolveCacheLimit(limitBytes) {
  if (limitBytes === 0) return Infinity;
  return Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : DEFAULT_CACHE_LIMIT_BYTES;
}

/**
 * 按最久未使用优先淘汰，直到总量落回上限。
 * entries: [{ name, size, usedAt }]；返回要删除的 name 数组。
 */
function selectEvictions(entries, limitBytes) {
  const list = Array.isArray(entries) ? entries : [];
  const limit = resolveCacheLimit(limitBytes);
  let total = list.reduce((sum, entry) => sum + (Number(entry && entry.size) || 0), 0);
  if (total <= limit) return [];

  const evicted = [];
  const byAge = list.slice().sort((a, b) => (Number(a && a.usedAt) || 0) - (Number(b && b.usedAt) || 0));
  for (const entry of byAge) {
    if (total <= limit) break;
    evicted.push(entry.name);
    total -= Number(entry.size) || 0;
  }
  return evicted;
}

/**
 * 扫描目录里的 .json 缓存文件并裁剪。
 * 只删 selectEvictions 点名的文件；单个文件 stat/unlink 失败不影响其它文件。
 */
async function pruneDirectory(options) {
  const o = options || {};
  const fs = o.fs || require('fs');
  const path = o.path || require('path');
  const dir = o.dir;
  if (!dir) return { ok: false, error: 'CACHE_DIR_REQUIRED', evicted: [] };

  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch (error) {
    const code = error && error.code;
    // 目录不存在 = 还没有缓存，不是失败。
    if (code === 'ENOENT') {
      return { ok: true, dir, scanned: 0, evicted: [], bytesBefore: 0, bytesAfter: 0 };
    }
    return { ok: false, error: code || 'READDIR_FAILED', evicted: [] };
  }

  const entries = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(file);
      entries.push({ name, file, size: stat.size, usedAt: stat.mtimeMs });
    } catch (_) { /* 文件刚被别的进程删掉：跳过 */ }
  }

  const evicted = selectEvictions(entries, o.limitBytes);
  const evictedSet = new Set(evicted);
  let removed = 0;
  let removedBytes = 0;
  for (const entry of entries) {
    if (!evictedSet.has(entry.name)) continue;
    try {
      await fs.promises.unlink(entry.file);
      removed += 1;
      removedBytes += entry.size;
    } catch (_) { /* 删不掉就留在下一轮 */ }
  }
  const bytesBefore = entries.reduce((sum, entry) => sum + entry.size, 0);
  return {
    ok: true,
    dir,
    scanned: entries.length,
    evicted,
    removed,
    bytesBefore,
    bytesAfter: bytesBefore - removedBytes,
    limitBytes: resolveCacheLimit(o.limitBytes) === Infinity ? 0 : resolveCacheLimit(o.limitBytes),
  };
}

module.exports = { DEFAULT_CACHE_LIMIT_BYTES, resolveCacheLimit, selectEvictions, pruneDirectory };
