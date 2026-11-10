// =============================================================================
// 应用内异步输入弹窗（替代 Electron 不支持的 window.prompt）
// -----------------------------------------------------------------------------
// 实测（Electron 44.9 / 项目自带 dist）：渲染进程调用 window.prompt 直接抛
//   Error: prompt() is not supported.
// 所以任何 prompt 调用点如果在 try/catch 之外，就会变成未处理异常、入口静默失效。
// 这里给出口令 / 城市名 / 链接等输入场景统一使用的 Promise 化模态：
//   - 支持 text / password 两种输入框（口令必须走 password，不明文回显）
//   - 取消、空值、两次口令不一致都有明确结果，调用方据此决定是否继续
//   - 复用 .modal-mask / .modal / .modal-btn 外壳，与内置歌单弹窗视觉一致
// =============================================================================
var appPromptState = null;
var appPromptSerial = 0;

// 交权 + 清理：标记结束、清掉聚焦定时器、移除本实例的全部监听。
// 只有仍是当前实例时才清全局引用（被顶掉的旧实例不许碰新实例的状态）。
function appPromptReleaseInstance(instance) {
  if (!instance || instance.settled) return;
  instance.settled = true;
  if (instance.focusTimer) {
    clearTimeout(instance.focusTimer);
    instance.focusTimer = 0;
  }
  if (typeof instance.cleanup === 'function') {
    try { instance.cleanup(); } catch (_) {}
  }
  instance.cleanup = null;
  if (appPromptState === instance) appPromptState = null;
}

/* 结束一个实例：先清理再 resolve，保证 Promise 一定落地。
 * options.supersede=true 表示「被新实例顶掉」：只收掉自己的监听与定时器，
 * 不关闭弹窗、不改输入框（新实例马上接管同一个外壳）。 */
function appPromptFinishInstance(instance, value, options) {
  if (!instance || instance.settled) return;
  var owned = appPromptState === instance;
  appPromptReleaseInstance(instance);
  if (owned && !(options && options.supersede)) {
    if (instance.inputType === 'password' && instance.inputEl) instance.inputEl.value = '';
    appPromptCloseModal(instance.mask);
  }
  instance.resolve(value);
}

function appPromptBuildModal() {
  var mask = document.getElementById('app-prompt-modal');
  if (mask) return mask;
  mask = document.createElement('div');
  mask.id = 'app-prompt-modal';
  mask.className = 'modal-mask';
  mask.setAttribute('role', 'dialog');
  mask.setAttribute('aria-modal', 'true');
  mask.innerHTML =
    '<div class="modal builtin-prompt-modal">' +
      '<h2 id="app-prompt-title">请输入</h2>' +
      '<div id="app-prompt-message" class="builtin-prompt-message" hidden></div>' +
      '<input id="app-prompt-input" type="text" autocomplete="off" spellcheck="false">' +
      '<div id="app-prompt-error" class="app-prompt-error" hidden></div>' +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button id="app-prompt-cancel" class="modal-btn" type="button">取消</button>' +
        '<button id="app-prompt-ok" class="modal-btn primary" type="button">确定</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  return mask;
}

function appPromptCloseModal(mask) {
  if (!mask) return;
  if (typeof closeGsapModal === 'function') closeGsapModal(mask);
  else mask.classList.remove('show');
}

/* options:
 *   title        标题
 *   message      说明文字（可空）
 *   placeholder  占位符
 *   value        初始值
 *   inputType    'text' | 'password'
 *   okText / cancelText
 *   allowEmpty   是否允许空值（默认 false，空值不关闭弹窗并给出提示）
 *   maxLength    最大长度（默认 200；口令场景调用方可放宽）
 *   validate     function(value) -> string，返回非空字符串表示校验失败
 * 返回：输入字符串（原样，不 trim，避免改掉口令中的空格）| null（取消）
 */
function openAppPromptModal(options) {
  options = options || {};
  var mask = appPromptBuildModal();
  var titleEl = document.getElementById('app-prompt-title');
  var messageEl = document.getElementById('app-prompt-message');
  var inputEl = document.getElementById('app-prompt-input');
  var errorEl = document.getElementById('app-prompt-error');
  var okBtn = document.getElementById('app-prompt-ok');
  var cancelBtn = document.getElementById('app-prompt-cancel');
  if (!mask || !titleEl || !inputEl || !okBtn || !cancelBtn || !document.body.contains(mask)) {
    // 外壳缺失（极端情况）：交给调用方按取消处理，绝不退回 window.prompt
    return Promise.resolve(null);
  }
  // 重入保护：旧实例只做「交出 DOM 所有权 + 清掉自己的监听/定时器 + resolve(null)」，
  // 既不关闭弹窗也不清 DOM（新实例马上接管同一个外壳）；更不能清掉新实例的全局状态，
  // 否则旧监听处理新窗口的点击后，新 Promise 会永久悬挂。
  if (appPromptState) {
    var superseded = appPromptState;
    appPromptState = null;
    appPromptFinishInstance(superseded, null, { supersede: true });
  }
  var allowEmpty = options.allowEmpty === true;
  var maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 200;
  return new Promise(function (resolve) {
    // 每次弹窗一个独立实例：身份、监听、定时器、settle 全部互不共享
    var instance = {
      id: ++appPromptSerial,
      settled: false,
      mask: mask,
      inputEl: inputEl,
      inputType: options.inputType === 'password' ? 'password' : 'text',
      resolve: resolve,
      cleanup: null,
      focusTimer: 0
    };
    appPromptState = instance;
    titleEl.textContent = String(options.title || '请输入');
    if (messageEl) {
      messageEl.textContent = String(options.message || '');
      messageEl.hidden = !messageEl.textContent;
    }
    function setError(text) {
      if (!errorEl) return;
      errorEl.textContent = String(text || '');
      errorEl.hidden = !text;
    }
    setError('');
    inputEl.type = instance.inputType;
    inputEl.maxLength = maxLength;
    inputEl.value = String(options.value == null ? '' : options.value);
    inputEl.placeholder = String(options.placeholder || '');
    okBtn.textContent = String(options.okText || '确定');
    if (cancelBtn) cancelBtn.textContent = String(options.cancelText || '取消');

    // 只认「当前实例」：被顶掉之后，任何残留回调都不许再动 DOM 或全局状态
    function isCurrent() {
      return appPromptState === instance && !instance.settled;
    }
    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      mask.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown, true);
    }
    instance.cleanup = cleanup;
    function settle(value) {
      if (!isCurrent()) return;
      appPromptFinishInstance(instance, value, null);
    }
    function onOk() {
      if (!isCurrent()) return;
      var raw = inputEl.value;
      if (!allowEmpty && String(raw).trim() === '') {
        setError('内容不能为空');
        try { inputEl.focus(); } catch (_) {}
        return;
      }
      if (typeof options.validate === 'function') {
        var message = options.validate(raw);
        if (message) {
          setError(message);
          try { inputEl.focus(); } catch (_) {}
          return;
        }
      }
      settle(raw);
    }
    function onCancel() { settle(null); }
    function onBackdrop(event) { if (event.target === mask) settle(null); }
    function onKeydown(event) {
      if (!isCurrent()) return;
      if (event.key === 'Escape') { event.preventDefault(); settle(null); }
      else if (event.key === 'Enter') { event.preventDefault(); onOk(); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    mask.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown, true);
    if (typeof openGsapModal === 'function') openGsapModal(mask);
    else mask.classList.add('show');
    instance.focusTimer = setTimeout(function () {
      instance.focusTimer = 0;
      if (!isCurrent()) return;
      try { inputEl.focus(); inputEl.select(); } catch (_) {}
    }, 60);
  });
}

/* 设置口令：两次输入一致才返回口令；任何一次取消 / 空值 / 不一致都返回 null，
 * 调用方据此直接放弃操作（不产生副作用，也不会抛未处理异常）。 */
async function promptPasswordWithConfirm(options) {
  options = options || {};
  var first = await openAppPromptModal({
    title: options.title || '设置口令',
    message: options.message || '',
    placeholder: options.placeholder || '口令',
    inputType: 'password',
    okText: '下一步',
    allowEmpty: false,
    maxLength: 128
  });
  if (first == null) return null;
  var second = await openAppPromptModal({
    title: '确认口令',
    message: '再输入一次相同的口令',
    placeholder: '再次输入口令',
    inputType: 'password',
    okText: '确认',
    allowEmpty: false,
    maxLength: 128
  });
  if (second == null) return null;
  if (first !== second) {
    if (typeof showToast === 'function') showToast('两次口令不一致');
    return null;
  }
  return first;
}

/* 输入一次口令（导入 / 链接导入场景） */
async function promptPasswordOnce(options) {
  options = options || {};
  var password = await openAppPromptModal({
    title: options.title || '输入口令',
    message: options.message || '',
    placeholder: options.placeholder || '口令',
    inputType: 'password',
    okText: options.okText || '确定',
    allowEmpty: false,
    maxLength: 128
  });
  if (password == null) return null;
  return password;
}
