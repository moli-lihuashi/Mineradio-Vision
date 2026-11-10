// =============================================================================
// 跨设备登录包 QR / 局域网链接同步
// =============================================================================
async function refreshAllLoginStatusesAfterPackImport() {
  try { if (typeof refreshLoginStatus === 'function') await refreshLoginStatus(true); } catch (_) {}
  try { if (typeof refreshQQLoginStatus === 'function') await refreshQQLoginStatus(); } catch (_) {}
  try { if (typeof refreshKugouLoginStatus === 'function') await refreshKugouLoginStatus(); } catch (_) {}
  try { if (typeof refreshQishuiLoginStatus === 'function') await refreshQishuiLoginStatus(); } catch (_) {}
  try { if (typeof refreshSpotifyLoginStatus === 'function') await refreshSpotifyLoginStatus(); } catch (_) {}
  if (typeof refreshUserPlaylists === 'function') refreshUserPlaylists(true);
  if (typeof updateUserModalUi === 'function') updateUserModalUi();
}

function ensureLoginPackQrModal() {
  var mask = document.getElementById('login-pack-qr-modal');
  if (mask) return mask;
  mask = document.createElement('div');
  mask.id = 'login-pack-qr-modal';
  mask.className = 'modal-mask';
  mask.innerHTML =
    '<div class="modal" style="max-width:420px">' +
      '<h2>登录包二维码同步</h2>' +
      '<div id="login-pack-qr-body" style="font-size:12px;color:rgba(255,255,255,.72);line-height:1.55"></div>' +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="modal-btn" type="button" onclick="closeLoginPackQrModal()">关闭</button>' +
        '<button class="modal-btn primary" type="button" id="login-pack-qr-stop-btn" onclick="stopActiveLoginPackQrSync()">停止分享</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask) closeLoginPackQrModal();
  });
  return mask;
}

function closeLoginPackQrModal() {
  var mask = document.getElementById('login-pack-qr-modal');
  if (!mask) return;
  if (typeof closeGsapModal === 'function') closeGsapModal(mask);
  else mask.classList.remove('show');
}

async function stopActiveLoginPackQrSync() {
  var api = window.desktopWindow;
  if (api && typeof api.stopLoginPackQrSync === 'function') {
    try { await api.stopLoginPackQrSync(); } catch (_) {}
  }
  closeLoginPackQrModal();
  showToast('已停止登录包分享');
}

async function exportLoginSessionPackQr() {
  var api = window.desktopWindow;
  if (!api || typeof api.startLoginPackQrSync !== 'function') {
    showToast('请在桌面版中使用二维码同步');
    return;
  }
  // Electron 不支持 window.prompt（直接抛异常），口令统一走应用内异步输入弹窗
  var password = null;
  try {
    if (typeof promptPasswordWithConfirm !== 'function') {
      showToast('当前版本不支持口令输入');
      return;
    }
    password = await promptPasswordWithConfirm({
      title: '设置同步口令',
      message: '另一台电脑导入同步链接时需要输入同一口令',
      placeholder: '同步口令'
    });
  } catch (e) {
    console.warn('[LoginPackQrExport] password prompt failed:', e);
    showToast('口令输入失败');
    return;
  }
  if (password == null) return;
  try {
    var result = await api.startLoginPackQrSync({
      password: String(password),
      providers: ['netease', 'qq', 'kugou', 'qishui', 'spotify']
    });
    if (!(result && result.ok)) {
      showToast((result && (result.message || result.error)) || '二维码同步启动失败');
      return;
    }
    var mask = ensureLoginPackQrModal();
    var body = document.getElementById('login-pack-qr-body');
    var expireMin = Math.max(1, Math.round((result.ttlMs || 180000) / 60000));
    body.innerHTML =
      '<div style="margin-bottom:10px">同局域网另一台电脑扫描或粘贴链接，再输入相同口令即可导入。</div>' +
      (result.qrDataUrl
        ? '<div style="display:flex;justify-content:center;margin:12px 0"><img alt="login-pack-qr" src="' + result.qrDataUrl + '" style="width:220px;height:220px;border-radius:12px;background:#fff"></div>'
        : '<div style="margin:10px 0;color:rgba(255,196,92,.9)">二维码生成失败，请直接复制下方链接。</div>') +
      '<div style="word-break:break-all;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)">' +
        escHtml(result.url || '') +
      '</div>' +
      '<div style="margin-top:10px;color:rgba(255,255,255,.42);font-size:11px">约 ' + expireMin + ' 分钟内有效，拉取一次后自动失效。</div>';
    if (typeof openGsapModal === 'function') openGsapModal(mask);
    else mask.classList.add('show');
    showToast('已开启登录包二维码同步');
  } catch (e) {
    showToast('二维码同步启动失败');
  }
}

async function importLoginSessionPackFromQr() {
  var api = window.desktopWindow;
  if (!api || typeof api.importLoginPackFromQrUrl !== 'function') {
    showToast('请在桌面版中使用链接导入');
    return;
  }
  // 链接 + 口令两个输入都走应用内弹窗；任一步取消即整体放弃，不产生副作用
  var url = null;
  var password = null;
  try {
    if (typeof openAppPromptModal !== 'function') {
      showToast('当前版本不支持链接导入输入');
      return;
    }
    url = await openAppPromptModal({
      title: '链接导入登录包',
      message: '粘贴另一台电脑的同步链接（http://...）',
      placeholder: 'http://192.168.1.10:12345/login-pack',
      okText: '下一步',
      allowEmpty: false,
      maxLength: 2048
    });
    if (url == null) return;
    password = await promptPasswordOnce({
      title: '输入同步口令',
      message: '请输入发起同步时设置的口令',
      placeholder: '同步口令'
    });
  } catch (e) {
    console.warn('[LoginPackQrImport] input prompt failed:', e);
    showToast('输入失败，已取消链接导入');
    return;
  }
  if (password == null) return;
  try {
    var result = await api.importLoginPackFromQrUrl({
      url: String(url).trim(),
      password: String(password)
    });
    if (!(result && result.ok)) {
      showToast((result && (result.message || result.error)) || '导入失败');
      return;
    }
    showToast('已导入 ' + (result.providers || []).join('/') + ' · 正在刷新登录态');
    await refreshAllLoginStatusesAfterPackImport();
  } catch (e) {
    showToast('链接导入失败');
  }
}
