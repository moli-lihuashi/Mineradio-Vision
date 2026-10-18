'use strict';

// beatmap 磁盘缓存：目录可用性判定（C 盘禁用，除非显式 MINERADIO_BEAT_CACHE_DIR）、
// key→文件名、读写与损坏自愈。从 server.js 抽出，与更新系统无关。
// deps: { cacheDir }

module.exports = function createBeatmapCache(deps) {
  const { cacheDir } = deps || {};
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const BEATMAP_CACHE_DIR = cacheDir;

  function beatCacheRootInfo() {
    const dir = path.resolve(BEATMAP_CACHE_DIR);
    const root = path.parse(dir).root;
    const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
    const explicit = !!String(process.env.MINERADIO_BEAT_CACHE_DIR || '').trim();
    const allowed = explicit || (!!root && !/^C:$/i.test(drive));
    const available = allowed && fs.existsSync(root);
    return { dir, root, drive, allowed, available };
  }
  function ensureBeatMapCacheDir() {
    const info = beatCacheRootInfo();
    if (!info.allowed) {
      const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
      err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
      err.info = info;
      throw err;
    }
    if (!info.available) {
      const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
      err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
      err.info = info;
      throw err;
    }
    fs.mkdirSync(info.dir, { recursive: true });
    return info.dir;
  }
  function safeBeatMapCacheFile(key) {
    const raw = String(key || '').trim();
    if (!raw || raw.length > 240) return null;
    const hash = crypto.createHash('sha1').update(raw).digest('hex');
    const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
    return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
  }
  function compactBeatMapCachePayload(body) {
    const key = String(body && body.key || '').trim();
    const map = body && body.map;
    if (!key || !map || typeof map !== 'object') return null;
    return {
      v: 1,
      key,
      savedAt: Date.now(),
      meta: {
        provider: String(body.provider || '').slice(0, 32),
        title: String(body.title || '').slice(0, 160),
        artist: String(body.artist || '').slice(0, 160),
        mode: String(body.mode || 'mr').slice(0, 32),
      },
      map,
    };
  }
  async function readBeatMapCache(key) {
    const file = safeBeatMapCacheFile(key);
    if (!file) return null;
    let raw;
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      fs.promises.unlink(file).catch(() => {}); // 读失败（权限/损坏）：删掉避免每次读盘后失败
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && parsed.map ? parsed : null;
    } catch (_) {
      fs.promises.unlink(file).catch(() => {}); // JSON 损坏：删掉，下次正常回源
      return null;
    }
  }
  async function writeBeatMapCache(body) {
    const payload = compactBeatMapCachePayload(body);
    if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
    const file = safeBeatMapCacheFile(payload.key);
    if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(payload));
    await fs.promises.rename(tmp, file);
    return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
  }

  return {
    beatCacheRootInfo,
    ensureBeatMapCacheDir,
    safeBeatMapCacheFile,
    compactBeatMapCachePayload,
    readBeatMapCache,
    writeBeatMapCache,
  };
};
