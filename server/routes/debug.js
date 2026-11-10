// ====================================================================
//  路由: 运行诊断
//  - /api/debug/network     连接层请求记录（DNS/TCP/TLS/首字节/总耗时、错误阶段）
//  - /api/debug/logs        运行日志缓冲（已脱敏）
//  - /api/debug/build       构建溯源（源码 commit、dist 关键文件 sha256 对照）
//  - /api/debug/self-check  分层网络自检（DNS / TCP / TLS / HTTPS / 代理 / 本机后端）
//  - /api/debug/cache-prune 节拍缓存容量裁剪（**唯一会写盘的接口，只接受 POST**）
//
//  /api/* 一律走 assertApiAuth；除 cache-prune 外都只返回内存快照。
// ====================================================================
'use strict';

const path = require('path');
const networkDiagnostics = require('../lib/network-diagnostics');
const logBuffer = require('../lib/log-buffer');
const mediaCacheGuard = require('../lib/media-cache-guard');
const { collectBuildProvenance } = require('../lib/build-provenance');
const { runSelfCheck, DEFAULT_HOSTS } = require('../lib/self-check');

// 路由装配时安装日志缓冲。默认开、必须在问题发生前就开着，不能等用户手动启用。
const logs = logBuffer.getLogBuffer();
logs.install();
const network = networkDiagnostics.getNetworkRecorder();
const guard = mediaCacheGuard.getMediaCacheGuard();
const appRoot = path.resolve(__dirname, '..', '..');

module.exports = function register(ctx) {
  const { sendJSON, pruneBeatMapCache, beatMapCacheLimitBytes } = ctx;

  return async function (req, res, url, pn) {
    if (pn === '/api/debug/network') {
      const tag = url.searchParams.get('tag');
      const provider = url.searchParams.get('provider');
      const limit = parseInt(url.searchParams.get('limit') || '200', 10) || 200;
      sendJSON(res, {
        enabled: network.isEnabled(),
        count: network.size(),
        suspiciousAudio: guard.suspiciousPayloads(),
        distrustedAudioKeys: guard.distrustedKeys(),
        entries: network.snapshot({
          provider: provider || undefined,
          tag: tag !== null ? tag : undefined,
          errorsOnly: url.searchParams.get('errorsOnly') === '1',
          limit,
        }),
      });
      return;
    }

    if (pn === '/api/debug/logs') {
      const limit = parseInt(url.searchParams.get('limit') || '1000', 10) || 1000;
      sendJSON(res, {
        enabled: logs.isEnabled(),
        installed: logs.isInstalled(),
        count: logs.size(),
        entries: logs.snapshot({
          level: url.searchParams.get('level') || undefined,
          scope: url.searchParams.get('scope') || undefined,
          limit,
        }),
      });
      return;
    }

    if (pn === '/api/debug/build') {
      try {
        sendJSON(res, collectBuildProvenance({ appRoot, runtimeAppRoot: __dirname }));
      } catch (err) {
        sendJSON(res, { error: 'BUILD_PROVENANCE_FAILED', message: String(err && err.message || err) }, 500);
      }
      return;
    }

    /* 分层网络自检。用户说「我网络没问题」时，这份结果用来指认卡在 DNS / TCP / TLS / HTTP 哪一层。
       端口取本次连接的实际监听端口，不依赖全局 PORT —— 探测的就是「这个进程在不在听」。 */
    if (pn === '/api/debug/self-check') {
      const hostsParam = (url.searchParams.get('hosts') || '').trim();
      const hosts = hostsParam
        ? hostsParam.split(',').map(item => item.trim()).filter(Boolean).slice(0, 8)
        : DEFAULT_HOSTS;
      const timeoutMs = Math.min(15000, Math.max(500, parseInt(url.searchParams.get('timeoutMs') || '5000', 10) || 5000));
      try {
        // 默认跑真实分层自检；测试可注入 runner 桩，不必真打公网。
        const runner = typeof ctx.runSelfCheck === 'function' ? ctx.runSelfCheck : runSelfCheck;
        const report = await runner({
          hosts,
          timeoutMs,
          runtime: 'server',
          backend: {
            status: 'running',
            port: req.socket && req.socket.localPort ? req.socket.localPort : null,
            error: null,
          },
        });
        sendJSON(res, report);
      } catch (err) {
        sendJSON(res, { error: 'SELF_CHECK_FAILED', message: String(err && err.message || err) }, 500);
      }
      return;
    }

    /* 节拍缓存裁剪。这是本文件里唯一会写盘的接口，所以限定 POST ——
       浏览器地址栏 / 预取 / 后退缓存都不会自发 POST，避免被顺手删掉用户的节拍缓存。 */
    if (pn === '/api/debug/cache-prune') {
      if (String(req.method || '').toUpperCase() !== 'POST') {
        sendJSON(res, {
          error: 'METHOD_NOT_ALLOWED',
          message: 'cache-prune 会删除磁盘文件，只接受 POST',
        }, 405);
        return;
      }
      if (typeof pruneBeatMapCache !== 'function') {
        sendJSON(res, { error: 'CACHE_PRUNE_UNAVAILABLE' }, 503);
        return;
      }
      const limitMb = url.searchParams.get('limitMb');
      const limitBytes = limitMb == null || limitMb === ''
        ? (typeof beatMapCacheLimitBytes === 'function' ? beatMapCacheLimitBytes() : undefined)
        : Math.round(Number(limitMb) * 1024 * 1024);
      try {
        sendJSON(res, await pruneBeatMapCache({ limitBytes }));
      } catch (err) {
        sendJSON(res, { error: 'CACHE_PRUNE_FAILED', message: String(err && err.message || err) }, 500);
      }
      return;
    }
  };
};
