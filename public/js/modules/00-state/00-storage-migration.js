// =============================================================================
// 带版本的存档读写（借 Folia getFromCacheWithMigration 的语义）
//
// 这个项目的历史包袱是：迁移靠 'off-v4' 这类一次性标记，读写两处都要记得改，
// 漏一处就会出现「启动后设置归零」。这里把版本与迁移收敛成唯一入口：
//   · 扁平结构（v 与业务字段同级），旧代码仍能读到自己的字段，不会因为加版本而失联；
//   · 旧档（无 v）按 v0 处理，交给调用方的 migrate；
//   · 未来版本不读也不覆盖 —— 降级运行时写回高版本档会丢用户数据；
//   · 解析失败/存储不可用一律返回结构化原因，绝不抛出。
// =============================================================================

var MINERADIO_STORAGE_SCHEMA_VERSION = 1;

function mineradioStorageArea(storage) {
  if (storage) return storage;
  try {
    return (typeof localStorage !== 'undefined') ? localStorage : null;
  } catch (_) { return null; }
}

/**
 * 读一份带版本的 JSON 存档。
 * 返回 { ok, value, version, migrated, reason }；ok=false 时调用方走默认值。
 */
function readVersionedJson(key, options) {
  var opts = options || {};
  var target = Number(opts.version) || MINERADIO_STORAGE_SCHEMA_VERSION;
  var area = mineradioStorageArea(opts.storage);
  if (!area) return { ok: false, reason: 'no-storage', value: null, version: 0, migrated: false };

  var raw = null;
  try { raw = area.getItem(key); } catch (_) {
    return { ok: false, reason: 'read-failed', value: null, version: 0, migrated: false };
  }
  if (!raw) return { ok: false, reason: 'empty', value: null, version: 0, migrated: false };

  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {
    return { ok: false, reason: 'parse-failed', value: null, version: 0, migrated: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object', value: null, version: 0, migrated: false };
  }

  var found = Number(parsed.v);
  if (!isFinite(found) || found < 0) found = 0;
  if (found > target) {
    return { ok: false, reason: 'future-version', value: null, version: found, migrated: false };
  }

  var value = parsed;
  var migrated = false;
  if (found < target) {
    if (typeof opts.migrate !== 'function') {
      return { ok: false, reason: 'no-migrator', value: null, version: found, migrated: false };
    }
    var next = opts.migrate(parsed, found, target);
    if (!next || typeof next !== 'object') {
      return { ok: false, reason: 'migrate-failed', value: null, version: found, migrated: false };
    }
    value = next;
    migrated = true;
    // 迁移结果立即回写：下次启动不必再迁一次，也避免半迁移状态被读到。
    writeVersionedJson(key, value, target, area, true);
  }
  return { ok: true, value: value, version: target, migrated: migrated, reason: '' };
}

/**
 * 写一份带版本的 JSON 存档（扁平结构：业务字段 + v + at）。
 * keepTimestamp=true 时保留已有的 at，用于迁移回写。
 */
function writeVersionedJson(key, value, version, storage, keepTimestamp) {
  var area = mineradioStorageArea(storage);
  if (!area) return false;
  try {
    var next = {};
    if (value && typeof value === 'object') {
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) next[k] = value[k];
      }
    }
    next.v = Number(version) || MINERADIO_STORAGE_SCHEMA_VERSION;
    if (!keepTimestamp && !next.at) next.at = Date.now();
    area.setItem(key, JSON.stringify(next));
    return true;
  } catch (_) { return false; }
}
