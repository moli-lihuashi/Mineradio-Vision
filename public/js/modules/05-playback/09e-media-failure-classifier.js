// =============================================================================
// 媒体元素错误分类（借 Folia mediaFailureClassifier 的语义，不引依赖）
//
// 旧行为：waiting / stalled / error 共用一条恢复链。用户快速点「下一曲」时，
// 旧 src 被换掉会产生 MEDIA_ERR_ABORTED，这条中断同样会安排看门狗，
// 随后的软重试 / 重新取链会去打断新一次起播的 play() —— 表现为概率性播放失败。
//
// 现在：先把浏览器给出的 MediaError 信号分类，再决定谁有资格进入恢复链。
// aborted 是「操作被中断」，不是「播放失败」，必须直接让路。
// waiting / stalled 没有 MediaError，保持原有卡顿恢复逻辑不变。
// =============================================================================

var MEDIA_FAILURE_CODES = {
  ABORTED: 1,
  NETWORK: 2,
  DECODE: 3,
  SRC_NOT_SUPPORTED: 4
};

// 换链后的地址带这个标记：如果恢复产物本身仍报 unsupported，
// 就不再重复换源，避免 unsupported → 换源 → unsupported 的死循环。
var MEDIA_RECOVERED_SOURCE_MARK = 'mineradio-recovered=1';

function classifyMediaElementFailure(error, source) {
  var code = (error && typeof error.code === 'number') ? error.code : null;
  if (code === MEDIA_FAILURE_CODES.ABORTED) {
    return {
      kind: 'aborted', code: code, eligibleForRecovery: false,
      reason: '切歌或换源产生的中断，不是播放失败'
    };
  }
  if (code === MEDIA_FAILURE_CODES.NETWORK) {
    return {
      kind: 'network', code: code, eligibleForRecovery: true,
      reason: '网络中断，允许重新取链'
    };
  }
  if (code === MEDIA_FAILURE_CODES.DECODE) {
    return {
      kind: 'decode', code: code, eligibleForRecovery: true,
      reason: '解码失败，允许换源'
    };
  }
  if (code === MEDIA_FAILURE_CODES.SRC_NOT_SUPPORTED) {
    var alreadyRecovered = typeof source === 'string' &&
      source.indexOf(MEDIA_RECOVERED_SOURCE_MARK) >= 0;
    return {
      kind: 'unsupported', code: code, eligibleForRecovery: !alreadyRecovered,
      reason: alreadyRecovered ? '恢复产物仍不支持，禁止循环换源' : '源格式不支持，允许换源一次'
    };
  }
  return {
    kind: 'unknown', code: code, eligibleForRecovery: false,
    reason: '没有可判定的媒体错误码，保守不自动恢复'
  };
}

/* 看门狗闸门：只在 error 事件且能读到 MediaError 时否决。
 * 读不到错误码时返回 false，交回原有逻辑，不因为新机制把恢复能力关掉。 */
function mediaFailureBlocksStallRecovery(reason, media) {
  if (reason !== 'error') return false;
  if (!media || !media.error) return false;
  var verdict = classifyMediaElementFailure(media.error, media.currentSrc || media.src || '');
  return !verdict.eligibleForRecovery;
}
