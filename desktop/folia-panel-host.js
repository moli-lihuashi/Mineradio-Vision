/* Folia 面板型模组 · 主进程宿主
 *
 * 原版 Folia 的模组分两半：client.mjs（渲染端，注册 homeTabs 等）+ index.cjs（主进程，
 * 负责落盘与统计）。public/folia-mods/ 那批是「歌词样式」模组，只跑渲染端；
 * 这里补的是面板型模组需要的那一半：storage.paths、rpc.handle、log、onDispose。
 *
 * 契约（按 listening-archive v1.3.3 的 index.cjs 实际用法）：
 *   R(host) 里读 host.storage.paths.data        → 模组专属目录，宿主建好
 *   host.paths.documents                        → 导出备份写到「文档」
 *   host.rpc.handle(name, fn)                   → 渲染端 rpc.call(name, ...args) 落到这里
 *   host.log.{info,warn,error}
 *   host.onDispose(fn)                          → 退出前停 Worker
 *
 * 目录：public/folia-panel-mods/<dir>/{manifest.json, mod.json, client.mjs, index.cjs}
 * 数据：<userData>/mods-data/<id>/（与 Folia 的 mods-data 同名，便于迁移档案）
 *
 * 加载时机刻意做成「首次 IPC 才 require」：模组会起 Worker，压在启动路径上不划算。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* 模组目录。当前打包配置是 asar:false（resources/app 是实体目录），analytics.cjs
 * 能直接交给 worker_threads；这里仍保留一条 app.asar.unpacked 兼容分支 ——
 * 以后若改成 asar 打包，Worker 脚本需要走实体路径，否则会找不到文件。 */
const PACKED_MOD_ROOT = path.join(__dirname, '..', 'public', 'folia-panel-mods');
const MOD_ROOT = (function () {
  const marker = 'app.asar' + path.sep;
  if (PACKED_MOD_ROOT.indexOf(marker) >= 0) {
    const unpacked = PACKED_MOD_ROOT.replace(marker, 'app.asar.unpacked' + path.sep);
    try { if (fs.existsSync(unpacked)) return unpacked; } catch (_) {}
  }
  return PACKED_MOD_ROOT;
})();
const RPC_CHANNEL = 'mineradio-folia-panel-rpc';

const entries = new Map(); // id -> { id, meta, rpc, dispose, error }

/* 稳定的 appData 必须在 setPath('cache') 之前取。
 * main.js 实测：setPath('cache', X) 会把 appData 一起篡改成 X/chromium，
 * 之后再调 app.getPath('appData') 拿到的是缓存目录 —— 模组档案会跟着缓存跑，
 * 表现就是「数据写了但找不到」。
 * 本模块在 main.js 顶部 require，早于 setPath，所以在模块作用域捕获是安全的。 */
const STABLE_APP_DATA = (function () {
  try { return app.getPath('appData'); } catch (_) { return ''; }
})();

/* 模组数据根（等价于 Folia 的 mods-data）。每个模组在下面开自己的同名目录。 */
function modsDataRoot() {
  /* 探针/多实例隔离用：显式指定后不再走 appData，避免测试写进用户真实档案。 */
  const override = process.env.MINERADIO_MODS_DATA_DIR;
  if (override) return path.resolve(override);
  /* 与 main.js 的 _STABLE_USER_DATA 同源：APP_NAME = 内测通道 runtimeName
   * || 顶层 productName || build.productName。少了 runtimeName 这层，内测版会串到正式版目录。 */
  try {
    const pkg = require('../package.json');
    const appName = (pkg.mineradio && pkg.mineradio.runtimeName)
      || pkg.productName
      || (pkg.build && pkg.build.productName)
      || 'Mineradio';
    return path.join(STABLE_APP_DATA || app.getPath('userData'), appName, 'mods-data');
  } catch (_) {
    return path.join(STABLE_APP_DATA || app.getPath('userData'), 'mods-data');
  }
}

function readManifest() {
  try {
    const raw = fs.readFileSync(path.join(MOD_ROOT, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed && parsed.mods) ? parsed.mods : [];
  } catch (err) {
    console.warn('[FoliaPanel] 清单读取失败:', err && err.message);
    return [];
  }
}

function readModJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(MOD_ROOT, dir, 'mod.json'), 'utf8')) || {};
  } catch (_) {
    return null;
  }
}

function createHost(entry, rpc, disposers) {
  const dataDir = path.join(modsDataRoot(), entry.id);
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    storage: {
      /* 模组只用 data；cache 一起给出，避免以后升级时 undefined.join。 */
      paths: {
        data: dataDir,
        cache: path.join(dataDir, 'cache')
      }
    },
    paths: {
      documents: app.getPath('documents')
    },
    rpc: {
      handle: function (name, fn) {
        if (typeof name !== 'string' || !name || typeof fn !== 'function') return;
        rpc.set(name, fn);
      }
    },
    log: {
      info: function () { console.log.apply(console, ['[FoliaPanel:' + entry.id + ']'].concat([].slice.call(arguments))); },
      warn: function () { console.warn.apply(console, ['[FoliaPanel:' + entry.id + ']'].concat([].slice.call(arguments))); },
      error: function () { console.error.apply(console, ['[FoliaPanel:' + entry.id + ']'].concat([].slice.call(arguments))); }
    },
    onDispose: function (fn) {
      if (typeof fn === 'function') disposers.push(fn);
    }
  };
}

/* 加载一个模组（幂等）。失败不抛给调用方，记在 entry.error 上由渲染端显示。 */
function ensureEntry(id) {
  const cached = entries.get(id);
  if (cached) return cached;

  const item = readManifest().find(function (m) { return m && m.id === id && m.enabled !== false; });
  if (!item) {
    const miss = { id: id, meta: null, rpc: new Map(), dispose: null, error: '清单里没有这个模组' };
    entries.set(id, miss);
    return miss;
  }

  const dir = String(item.dir || item.id);
  const meta = readModJson(dir);
  if (!meta) {
    const bad = { id: id, meta: null, rpc: new Map(), dispose: null, error: 'mod.json 读取失败' };
    entries.set(id, bad);
    return bad;
  }

  const rpc = new Map();
  const disposers = [];
  const entry = { id: id, meta: meta, rpc: rpc, dispose: null, error: null };
  entries.set(id, entry);

  try {
    const mainFile = path.join(MOD_ROOT, dir, meta.main || 'index.cjs');
    const factory = require(mainFile);
    if (typeof factory !== 'function') throw new Error('index.cjs 未导出函数');
    factory(createHost(entry, rpc, disposers));
    entry.dispose = function () {
      for (let i = disposers.length - 1; i >= 0; i--) {
        try { disposers[i](); } catch (_) {}
      }
      disposers.length = 0;
    };
    console.log('[FoliaPanel] 已就绪', id, meta.version || '', '·', rpc.size, '个接口');
  } catch (err) {
    entry.error = String((err && err.message) || err);
    console.warn('[FoliaPanel] 加载失败', id, entry.error);
  }
  return entry;
}

/* 渲染端 rpc.call 的落地口。把异常转成可读字符串（IPC 只传 message，堆栈没必要）。 */
function callMod(id, method, args) {
  const entry = ensureEntry(String(id));
  if (entry.error) return Promise.reject(new Error(entry.error));
  const fn = entry.rpc.get(String(method));
  if (!fn) return Promise.reject(new Error('模组未注册接口：' + method));
  try {
    return Promise.resolve(fn.apply(null, Array.isArray(args) ? args : []));
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

function disposeAll() {
  for (const entry of entries.values()) {
    try { if (entry.dispose) entry.dispose(); } catch (_) {}
  }
  entries.clear();
}

function registerFoliaPanelIpc(ipcMain) {
  ipcMain.handle(RPC_CHANNEL, async (_event, payload) => {
    const p = payload || {};
    try {
      const value = await callMod(p.id, p.method, p.args);
      return { ok: true, value: value === undefined ? null : value };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

module.exports = {
  RPC_CHANNEL: RPC_CHANNEL,
  registerFoliaPanelIpc: registerFoliaPanelIpc,
  callMod: callMod,
  disposeAll: disposeAll,
  MOD_ROOT: MOD_ROOT
};
