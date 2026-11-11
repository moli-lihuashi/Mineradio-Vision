# 代码审查报告：性能问题与安全隐患

- 审查日期：2026-10-17
- 审查范围：`server.js` + `server/**`（~2.9k 行）、`desktop/**`（~16k 行）、`public/js/modules/**`（125 模块）、`qishui-auth-v6**`/`qishui-audio-decryptor**`
- 方法：分域通读 + 逐条行号证据核验（高危项已人工复核）
- 结论先行：**基础防护（contextIsolation / 静态路径穿越 / body 上限 / beatmap 哈希 / WE 协议白名单）写得规范；问题集中在「远程供应链信任」和「渲染进程失陷后的放大链」两处系统性缺口。**

> **后续状态（2026-11-11）**：本报告是 2026-10-17 的审查快照，下文「#15 / #16 未做」是当时的判定，保留不改。该项已在真实扫码 + 二次验证环境完成：验证窗口恢复 `webSecurity: true`、`ACAO` 收窄到本页 origin 并配 `Allow-Credentials`、补齐 `Allow-Headers` 五个自定义头、注入前按小写名清上游 CORS 头。当时「关掉会断 MFA 链路」的顾虑属实，断链原因已查明并逐层修复（详见 `CHANGELOG.md` 的「未发布」章节与 `memory/2026-11-11.md`）。当时建议的「改走主进程 `net.request`」未采用，实际走的是补全 CORS + 显式凭据，安全性与可用性均已在真实链路验证。

---

## 一、安全问题

### P0 — 严重（可被远程利用或直接泄露账号）

#### 1. 渲染层无 CSP，且启动即加载远程脚本，而 IPC 暴露面全量敞开
- `public/index.html:9-10`：启动即请求 `fonts.googleapis.com`（CSS + preload）
- `public/js/modules/10-shell/00-gesture-resize-ui.js:82-85,108-124`：手势功能经 `08-account/07-dynamic-libs.js:4-33` 从 `cdn.jsdelivr.net` / `unpkg.com` **运行时动态注入 JS**
- 全仓库无 `Content-Security-Policy`（index.html 与 server.js 均已 grep 确认）
- 而 `desktop/preload.js` 通过 contextBridge 暴露了：导出各平台登录 cookie（:30）、从任意 URL 拉登录包（:35）、改缓存目录（:93）、触发 UAC（:87）、对任意 PID 清工作集（:80）
- **利用链**：CDN 被污染 / 任一处 XSS（见 P1-8）→ 获得主进程敏感 IPC → 凭据窃取 + 内网 SSRF + UAC 诱饵弹窗，零用户交互（Google Fonts 启动即加载）。
- **修复**：加 CSP（`default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; object-src 'none'; base-uri 'self'`；注意全站大量 inline `onclick=`，需配 nonce 或逐步改事件委托）；远程库本地化 + SRI，删除运行时 CDN 依赖。

#### 2. 自动更新链无代码签名校验，供应链可投毒
- `server.js:871-877`：`readUpdateManifest` 允许 `http://` manifest URL——安装包 sha256 与文件来自**同一通道**验
- `server.js:1642-1643`：`assertPatchSignature` 在未配置 `MINERADIO_UPDATE_PUBKEY_PEM` 时**直接 return**（fail-open）→ 补丁零校验写入安装目录（`server.js:1625-1640`）
- `server.js:1317-1334`：安装包只验摘要，无签名
- `desktop/main.js:2773-2786`：`mineradio-open-update-installer` 校验「在 updates 目录内」即 `shell.openPath` 执行
- **影响**：一次镜像/MITM 篡改 = 持久化 RCE，且**不需要本地 token**（补丁路径是唯一无 token 远程入口）。
- **修复**：manifest 强制 https + 固定域名；安装包与补丁强制 ed25519/RSA 签名，**缺签名即拒绝，不设环境变量旁路**。

#### 3. 媒体代理 SSRF：host 白名单可被 302 重定向完整绕过
- `server.js:4437-4439`：`fetchProxiedMedia` → `fetchWithTimeout(mediaUrl, {headers})`，**全仓库无任何 `redirect` 配置**（已 grep 确认）→ Node fetch 默认跟随重定向
- `server.js:4416-4435`：`assertProxyableMediaUrl` 请求前校验协议 + host 后缀白名单 + DNS IP 黑名单——但一跳 302 到 `http://127.0.0.1:<port>/` 或内网即绕过全部校验，响应经 `server/routes/audio.js:130` 原样管道回客户端
- **修复**：`redirect: 'manual'`，3xx 直接拒绝；或逐跳重新跑 `assertProxyableMediaUrl`。

#### 4. AI 配置 `baseUrl` 未校验 → API Key 外泄 + SSRF
- `server/routes/ai.js:302-307`：`/api/ai/config` 接受任意字符串 baseUrl 并持久化
- `server/routes/ai.js:81-99`：`callLLM` 用该 baseUrl 拼 `/chat/completions`，带 `Authorization: Bearer <apiKey>`，且 `:85` 允许 http 明文
- **利用链**：一个 POST 改配置 + 一次生成请求 → 用户付费 LLM 密钥发往攻击者服务器，附赠内网 HTTP 探针。
- **修复**：baseUrl 限 `https:` + host 白名单，拒绝 loopback/RFC1918/169.254.0.16。

#### 5. 汽水登录凭据明文写项目根目录，且 .gitignore 未覆盖
- `qishui-qr-login.js:12`：默认文件 `path.join(__dirname, '.qishui-qr-login.json')`（项目根）
- `qishui-qr-login.js:39`：`fs.writeFileSync` 明文写含 `cookie`/`msToken` 的完整配置
- `.gitignore:22-23` 只有 `.qishui-cookie` / `.qishui-token`，**没有** `.qishui-qr-login.json`（已用 check-ignore 验证不匹配）
- **影响**：任何本地进程可读取冒用；一次误 `git add .` 即全网泄露汽水/抖音账号态。
- **修复**：写入 `app.getPath('userData')` 并走 safeStorage 加密；`.gitignore` 补一行；先检查该文件是否已被 git 跟踪。

#### 6. 登录包二维码同步监听 0.0.0.0 + CORS 通配
- `desktop/login-pack-qr-sync.js:91`：`server.listen(0, '0.0.0.0')`——含**全部五平台**登录态的加密登录包暴露到整个局域网
- `desktop/login-pack-qr-sync.js:46`：`Access-Control-Allow-Origin: *` 允许任意网页源读取
- 仅靠 URL 内 128-bit token，无速率限制，包拿到后可离线爆破 `login-session-pack.js:32` 的 scrypt 口令
- **修复**：绑 `127.0.0.1`；删 `ACAO: *`；加单 IP 失败锁定。

### P1 — 中（需要前置条件或影响面受限）

**IPC 与主进程面**

| # | 位置 | 问题 |
|---|------|------|
| 7 | `desktop/preload.js:30` → `main.js:3695-3720` | `export-login-cookie` 无 sender 校验，各平台 cookie 明文写桌面（同类 wallpaper handler 都有 `isTrustedMainWindowIpc`，唯独此类没有） |
| 8 | `preload.js:35` → `main.js:3801-3805` → `login-pack-qr-sync.js:125-165` | `login-pack-qr-import` 是**主进程 SSRF**：对渲染进程给的任意 http(s) URL 发 GET，无 host 白名单、无内网/环回/云元数据过滤、无 sender 校验 |
| 9 | `preload.js:93` → `main.js:2307-2324` | `cache-set-settings` 可把凭据/更新/beatmap 目录改到任意路径（`normalizeCacheRootPath` 只 resolve 无包含检查），无 sender 校验 |
| 10 | `preload.js:87` → `main.js:3616-3627` → `system-memory.js:379,396-404` | 渲染进程可触发 UAC 提权弹窗（`RunAs`）——钓鱼诱饵 |
| 11 | `main.js:3606-3608` → `app-memory.js:40-43` | `memory-trim-app` 接受任意 PID，可对用户态任意进程 `EmptyWorkingSet` |
| 12 | `main.js:3396-3407` | `will-navigate` 对 `file:` 协议直接放行——渲染进程失陷后可导航到任意本地 HTML，preload 随新文档重新执行、IPC 全量再暴露 |
| 13 | `main.js:3253-3257` | cookie 加密失败时**明文兜底**落盘 |
| 14 | `main.js:3362` + `3493-3499` | 生产构建 DevTools 常开（注释自述"临时诊断"）+ F12 快捷键 |

**认证与数据面**

| # | 位置 | 问题 |
|---|------|------|
| 15 | `qishui-auth-v6.js:268` | 汽水安全验证窗口 `webSecurity: false`（同源策略失效） |
| 16 | `qishui-auth-v6.js:208-216` | 强行给 `api.qishui.com` 等响应加 `ACAO: *` + `Expose-Headers: *` |
| 17 | `qishui-auth-v6/security_host.html:271,278` | API 响应里的 `decision.url` 直接 `loadVerifyScript` 进持有登录 cookie 的窗口——响应链路被动手脚即会话内任意 JS 执行 |
| 18 | `desktop/secret-store.js:18` + `main.js:3254-3256` | 无 `MR` 前缀的文件直接当密钥返回（明文兜底被无条件信任）→ 加密形同虚设 |
| 19 | `qishui-qr-login.js:42-44,130` | 登录态无过期检查，仅正则匹配 cookie 字段存在 |
| 20 | `server.js:4453` | token `===` 非常量时间比较；`server.js:199` 允许 `/api/audio`、`/api/cover` 走 `?token=`（易进日志/referrer） |
| 21 | `server.js:169` + `570` + `6611-6615` | `HOST` 可 env 覆盖；若 `0.0.0.0` 启动，静态文件不走 token 门禁 + CORS 反射任意 localhost origin（`server.js:6536-6540`）→ DNS rebinding 偷 token |
| 22 | `server.js:1477-1502` | 更新安装包下载无累计大小上限（对比补丁路径有 `PATCH_MAX_BYTES`），恶意上游可写满磁盘 |
| 23 | `server.js:4230` vs `routes/qq.js:110` | QQ cookie 自动刷新与手动保存**并发互相覆盖**（后写者赢），in-flight 去重覆盖不了手动保存路径 |
| 24 | `server.js:446-460,497-500,517-520` | 登录 cookie 默认 utf8 明文落盘，加密失败静默回退明文 |
| 25 | `spotify-api.js:172-175,198` | Spotify OAuth token 明文 JSON 写盘 |
| 26 | `server.js:4561-4569,4582-4590` | 临时诊断代码把音频内容写死 `D:/Mineradio/_qishui_audio_dump`（注释自标"确认后删除"，未删） |
| 27 | `server.js:1223` | `publicUpdateJob` 向持 token 方暴露更新包绝对路径；`ai.js:313,395`、`update.js:80` 等 `err.message` 直回客户端 |

**渲染层 XSS（均需先突破一层，故列 P1，但 28 可利用性最高）**

| # | 位置 | 问题 |
|---|------|------|
| 28 | `05-playback/03b-home-insight.js:97,112` | `onclick="...runHomeSearch(' + JSON.stringify(s.name) + ')"`——JSON.stringify 只转义 JS 字符串，**不防 HTML 属性注入**：歌名含 `"` 即闭合属性。数据源是 localStorage 听歌画像（本地导入文件名也是用户可控输入），打开画像即触发。同文件其余文本都用了 `escHtml`，唯独 onclick 通道没有 |
| 29 | `06-fx/04-liquidglass-plugin-api.js:408` | `(0, eval)(plugin.source)` 执行磁盘插件源码；`:376-377` plugin.name/description 未转义拼 innerHTML |
| 30 | `03-beat/00-tempo-worker-cache-prefetch.js:109` | `(0, eval)(code)` 执行 fetch 回来的 vendor 脚本 |
| 31 | `05-playback/05-home-track-detail.js:458,218` | 封面 `src` / 评论头像 `src` 未 `escAttr`（同文件 :262 的列表封面却用了，同文件双标准） |

**已核实为安全、不要误修的点**：静态文件路径穿越防护正确（`server.js:6603-6610` resolve + startsWith 双保险，`::$DATA`/反斜杠均拦）；`readRequestBody` 8MB 上限（`server.js:1854`）；补丁目标路径清洗完备（`server.js:1593-1604`）；beatmap key sha1 哈希；9 处 BrowserWindow 全部 `contextIsolation:true + nodeIntegration:false + sandbox:true`（唯一例外是 #15）；WE 协议 handler 有 token + 24 位 hex 白名单 + realpath 包含（`wallpaper-engine-library.js:823-882`）；`login-session-pack.js:31-65` scrypt + AES-256-GCM + 随机 salt/IV 无误用；`qishui-auth-v6.js:163-200` 本地资产服务只绑 127.0.0.1 + 白名单 Map。

---

## 二、性能问题

### P1 — 每帧/高频路径上的重活

#### 32. rAF 热路径每帧强制同步布局（全项目唯一）
- `public/js/modules/11-main-loop.js:869-892`：`liquidGlassHasActiveMirrorTargets` 每帧遍历全部 LiquidGlass 实例，逐元素 `getClientRects()`（强制 reflow）+ `querySelectorAll`
- 关键：该检查位于 stride 节流门（:917）**之前**，降频对它无效——空闲也在付帧成本
- **修复**：可见性探测节流到 4-10Hz 或改 `IntersectionObserver`，并把检查移到 stride 门之后。

#### 33. 四个虚拟列表滚动时每帧全量 innerHTML 重建，无窗口差分
- `06-lyrics/01-playlist-panel-shell.js:429`（队列面板，scroll→rAF→整体重写）
- `06-lyrics/01-playlist-panel-shell.js:446`（mini queue，同样无差分）
- `05-playback/07-search.js:254`（播客节目列表）
- `05-playback/05-home-track-detail.js:295`（专辑/歌手曲目）
- 对照 `03a-home-dashboard.js:122` 就有 `win.start === state.start` 差分写法——这四处没抄
- **修复**：重写前比较 `range.start/end`，不变直接 return。

#### 34. FX 滑块拖动时每事件全量序列化 + 同步写盘
- `07-fx/07-bindings-shelf-immersive.js:196`：滑块 `input` 事件里同步调 `saveLyricLayout()`（`02-visual/03c-lyrics-layout-settings.js:163`：整个 fx 对象 `JSON.stringify` + localStorage 同步写）
- input 在拖动时 60-120Hz → 每事件一次全量写盘，直接损伤跟手性；该面板是核心交互
- **修复**：debounce 300-500ms，或只保留 `change` 落盘。

#### 35. 四个 45s 永久轮询定时器，无登录态/可见性守卫
- `08-account/02-login-status.js:376,488,553,622`（qq/kugou/qishui/spotify 各一个），启动即建、登出不停、不查 `document.hidden`
- 单 provider 每天约 1920 次后台请求——常驻音乐播放器上的持续电池/网络消耗
- **修复**：未登录 `clearInterval`；加 hidden 守卫 + 指数退避。

### P2 — 累积型与细节

| # | 位置 | 问题 |
|---|------|------|
| 36 | `06-lyrics/05-upload-dragdrop.js:72` | `URL.createObjectURL(audioFile)` 从不 revoke，反复导入大文件累积 blob 引用 |
| 37 | `11-main-loop.js:939` | rAF 循环内周期性 `document.getElementById('custom-bg-video')`（虽被 stride 降频）——缓存到模块级变量即可 |
| 38 | `02-visual/00a-pointer-interaction.js:156` | free camera 滚轮里直接 `saveFreeCameraState()`（同步 stringify+写盘）；同文件 :93 已有防抖版 `scheduleFreeCameraStateSave` 未被使用 |
| 39 | `07-fx/00-preset-archive-data.js:319,414` | 重复定义 `renderUserFxArchives`，前一份永不生效（重名遮蔽，与已知的 89 处重名同源） |
| 40 | `05-playback/03a-home-dashboard.js:244` | `homeDashboardStableCoverRequests` 声明后从未使用 |
| 41 | `06-fx/00-liquidglass-manager.js:98-116` | `searchResults` 预设定义了但无任何引用 |

---

## 三、修复优先级建议

**第一批（1-2 天，收益/成本比最高，全部是配置级或几行改动）**
1. #5 凭据文件：`qishui-qr-login.js` 改 userData + secret-store，`.gitignore` 补一行，检查 git 跟踪状态
2. #6 登录包服务绑 127.0.0.1 + 删 ACAO:*
3. #3 代理 `redirect: 'manual'`
4. #4 AI baseUrl 限 https + host 校验
5. #2 补丁签名 fail-open 改 fail-closed
6. #32 每帧 reflow 移到 stride 门后 + 降频到 4-10Hz
7. #34 FX 滑块落盘 debounce
8. #35 轮询定时器加未登录/hidden 守卫

**第二批（3-5 天）**
9. #1 CSP + 远程库本地化（工作量最大但收益最大：切断唯一的"远程代码→主进程能力"链）
10. #7-#12 IPC sender 校验批量补齐（`isTrustedMainWindowIpc` 已有现成模式可抄）
11. #28-#31 四个 XSS 点（escAttr/事件委托）
12. #33 四个虚拟列表加窗口差分
13. #23 QQ cookie 覆盖竞态加锁
14. #22 安装包下载加上限

**第三批（择机）** — 已完成，见第七节
15. ✅ #13/#18/#24/#25 明文兜底全部改 fail-closed
16. ✅ #19 登录态过期检查
17. ◐ #15-#17 汽水验证窗口：**#17 已修**（`decision.url` 脚本域名白名单）；**#15/#16 未做**（需真实 MFA 环境验证，原因见第七节）
18. ✅ #26 删临时诊断代码；#14 DevTools 按 isPackaged 关
19. ✅ #36-#41 性能细节与死代码

---

## 四、审查方法说明

- 四个分域（服务端 / Electron 主进程 / 前端 / 凭据加密）并行通读，所有条目均带 `文件:行号`
- P0 全部 6 条 + P1 抽样 10 条已人工二次核验（读原始代码确认，非采信子代理结论）
- 未验证项：`qishui-audio-decryptor` 畸形文件 OOM（L2，只读了描述未实测）、DNS rebinding（#21，理论推演）
- 本报告只读审查，未修改任何代码

---

## 五、第一批修复记录（2026-10-17 晚，全部已实施并验证）

修改前已按项目铁律手工存档至 `_debug-archive/batch1-security-2026-10-17/`；改后 `node --check` 8/8 通过，`sync-dist-app.js` 已同步 dist（278 文件，抽验确认）。

### #5 汽水凭据加密存储 ✅
- `qishui-qr-login.js`：`readConfig/writeConfig` 改走 `desktop/secret-store`（safeStorage/DPAPI）；新增 `migratePlaintextConfigFile()` 启动时把历史明文文件原地升级为加密；`osEncryptionAvailable()` 显式探测（非 electron 上下文 safeStorage 为 undefined，secret-store 抛的是 TypeError，不能靠错误消息判断）。
- 落盘策略：**显式指定的 configFile**（env/opt，含 main.js 设的 userData 路径）→ 加密优先、加密不可用时明文兜底并警告；**默认项目根路径** → 加密不可用时拒绝落盘仅内存持有（防凭据混进仓库工作区）。默认路径解析也改为优先 electron `userData`。
- `.gitignore` 补 `.qishui-qr-login.json`（已 `git check-ignore` 验证；该文件当前未被 git 跟踪、磁盘上也不存在，无既成泄露）。
- 验证：三场景单测通过（显式路径明文兜底 / 默认路径拒绝落盘 + 内存可用 / 历史明文可读）。
- 备注：真实 App 内 `main.js:3114` 早已把 env 指向稳定 userData，此前的实际缺口是「无加密 + gitignore 遗漏」，本次补上。

### #6 登录包同步服务 ✅
- `desktop/login-pack-qr-sync.js`：移除全部 `Access-Control-Allow-Origin: *` 等 CORS 头（消费方只有手机浏览器顶层导航与另一台机器的服务端 GET，均不需要跨源读取）；监听从 `0.0.0.0` 改为绑定 `pickLanAddress()` 选定的局域网网卡，选定网卡绑定失败（EADDRNOTAVAIL/EACCES）才回退全接口；新增 `/p/` 路径单 IP 请求预算（20 次上限后 429，仅计 `/p/` 前缀命中——含错误 token 爆破，健康检查与非 /p/ 探测不占用）。
- **与报告的偏差及理由**：未改绑 `127.0.0.1`——该功能前提就是手机经局域网拉取登录包，绑环回会直接功能失效；改绑选定网卡 + 去 CORS + 速率限制是在保留功能前提下的实际收敛。残留风险：同局域网知情者仍可抢在合法手机前用 URL 取包（128-bit token + 3 分钟 TTL + 一次性消费已在位），彻底消除需换成对等码/短时配对流程，列入后续。
- 验证：冒烟测试通过（合法拉取 200 / 二次消费 410 / 25 次错误 token 后 429 / 健康检查不受影响 / 新会话恢复 200 / 无 CORS 响应头）。

### #3 媒体代理 SSRF ✅
- `server.js` `fetchProxiedMedia`：`redirect: 'manual'` + 逐跳 `assertProxyableMediaUrl` 复检（host 白名单 + DNS IP 黑名单），最多 5 跳（`PROXY_REDIRECT_LIMIT`）；合法 CDN 同白名单跳转仍可跟随。
- 验证：探针 `_proxy_redirect_verify.js`（从 server.js 原文抽取真实函数，仅桩掉 fetchWithTimeout）6/6 通过：302→127.0.0.1 拦截、302→192.168.1.1 拦截、合法跳转可跟随、循环触发上限、200 直通、初始 URL 校验。**反向对照**：同一向量在旧 `redirect:'follow'` 行为下直达 `http://127.0.0.1:9/secret`——修复前可利用、修复后拦截，双向证实。

### #4 AI baseUrl 校验 ✅
- `server/routes/ai.js`：新增 `assertSafeLlmBaseUrl`（落盘前，防线一）与 `assertSafeLlmBaseUrlSync`（callLLM 发请求前，防线二）。规则：强制 https；拒绝环回/RFC1918/链路本地/云元数据/CGNAT/TEST-NET/组播保留段（v4、IPv6、`::ffff:` 两种规范化形态都覆盖）；拒绝 URL 内嵌凭证；非环回域名额外 DNS 解析后复检 IP。
- **与报告的偏差及理由**：保留了 `http://127.0.0.1|localhost|[::1]` 的 http 例外——本地 ollama 场景密钥不出本机，无外传面；报告原文「拒绝 loopback」会误伤该场景。
- 验证：26/26 单测通过（默认火山端点/公网 https 放行；本机 ollama 放行；http 公网、各内网段、元数据端点、IPv6 各类、URL 凭证、TEST-NET 全部拦截）。
- 残留限制（已记录）：公网 https 主机名层放行，域名层无法防「密钥外传到攻击者公网主机」，需主机白名单或交互确认，列入第二批。

### #2 补丁签名 fail-closed ✅
- `server.js` `assertPatchSignature`：未配置 `MINERADIO_UPDATE_PUBKEY_PEM` 时从静默跳过改为抛 `PATCH_SIGNATURE_UNCONFIGURED`；路由层已有 try/catch，表现为可见的 500 错误而非崩溃。
- 验证：RSA 真密钥对 5/5（无公钥拒绝 / 有效签名放行 / 篡改拒绝 / 缺签名拒绝 / 错公钥拒绝）。
- **运维影响**：未配置公钥时补丁更新将不可用（显式报错）。需要启用补丁通道时按 `build/patch-sign.js` 注释设置 `MINERADIO_UPDATE_PUBKEY_PEM`。

### #32 主循环每帧强制 reflow ✅
- `public/js/modules/11-main-loop.js`：新增 `liquidGlassHasActiveMirrorTargetsThrottled`，可见性探测（含 `getClientRects()`）节流到 5Hz（200ms）；`updateLiquidGlassBackdropMirror`（rAF 热路径）改调节流版。原函数保留供包装调用。探测语义是「无可见玻璃时早退」，200ms 陈旧答案最多让玻璃刚出现/消失时镜像晚几帧。
- 说明：未按报告「移到 stride 门之后」——节流后成本已有上界，改动面更小。blit 本身的 stride 节流不受影响。

### #34 FX 滑块落盘 debounce ✅
- `public/js/modules/07-fx/07-bindings-shelf-immersive.js`：`input`  handler 里的 `saveLyricLayout()` 改走 `debounce(saveLyricLayout, 400)`（复用 `03b-lyrics-color-utils.js` 现有 `debounce`，已 grep 确认全仓唯一无重名遮蔽）；新增 `change` 监听在松手时立即落盘，不留 400ms 尾巴。拖动 60-120Hz → 最多 2 次写（松手 + 防抖尾）。
- 加载顺序已核实：index-loader 并行 fetch 后**合并单 script 求值**，`function` 声明整体提升，求值时引用 `debounce/saveLyricLayout` 安全。

### #35 登录态轮询守卫 ✅
- `public/js/modules/08-account/02-login-status.js`：四个 45s 定时器（qq/kugou/qishui/spotify）回调统一加 `document.hidden` 早退 + `!loggedIn && !wasLoggedIn` 早退（沿用该文件 QQ focus 刷新已有的作者模式）。未登录/登出后不再发轮询请求；`12a-audio-login-globals.js` 确认四个 `xxxLoginWasLoggedIn` 变量声明与生命周期（登录置 true、刷新后置 `!!loggedIn`）正确。
- 效果：单 provider 后台请求从约 1920 次/天 → 未登录 0 次、登录后隐藏期 0 次。

### 遗留与后续
- 既有测试快照唯一 FAIL：「electron-builder.internal-beta.json is required」——该文件磁盘上不存在、git 从未跟踪，属**先于本次改动存在**的问题，与第一批无关。
- 第二批候选（见第三节）：CSP + 远程库本地化、IPC sender 校验批量补齐、四个 XSS 点、虚拟列表窗口差分、QQ cookie 覆盖竞态、安装包下载大小上限。

## 六、第二批修复记录（2026-10-17 深夜，全部已实施并验证）

同样先存档至 `_debug-archive/`；改后 `node --check` 全过；`sync-dist-app.js` 已同步（295 文件，抽验确认含新增 vendor）。

### #1 CSP + 远程库本地化 ✅
- **远程脚本执行面清零**：MediaPipe（手势）与 transformers.js（AI 封面深度）原从 jsdelivr/unpkg 动态加载，现全量本地化到 `public/vendor/mediapipe/`（24MB，含 wasm/packed assets/tflite，附 NOTICE）与 `public/vendor/transformers/`（20MB，库 + 两个 ONNX Runtime wasm 变体，附 LICENSE/NOTICE）。`00-gesture-resize-ui.js` 的 CDN 列表改为本地单源（错误文案同步改为「组件加载失败」）；`05-cover-depth.js` 改 `import('/vendor/transformers/transformers.min.js')` 并覆写 `env.backends.onnx.wasm.wasmPaths` 指向本地（不改则库仍会回退 CDN 拉 wasm）。模型权重仍按需从 HuggingFace 拉取（connect-src 放行）。
- **CSP meta 三文档**（index / wallpaper / desktop-lyrics）。index.html 策略：`default-src 'self'`；`script-src 'self' 'unsafe-inline' 'unsafe-eval'`；style/font 放行 Google Fonts；`img/media-src 'self' data: blob: https: mineradio-wallpaper:`（封面直链 + Wallpaper Engine 自定义 scheme）；`connect-src 'self' https://huggingface.co https://*.huggingface.co https://fonts.googleapis.com https://fonts.gstatic.com`；`worker-src 'self' blob:`（tempo worker 是 blob + 同源 importScripts）；`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-src 'none'`。
- **两个被迫项**（均有实证，见验证）：① `'unsafe-inline'`——125 个模块合并为**单个内联 script** 注入，去掉即全站瘫痪；inline onclick/style 同样密集。② `'unsafe-eval'`——本机 Chromium 138 实测 **`'wasm-eval'` 关键字不被承认**（wasm 变体探针：仅 'unsafe-eval' 放行编译，'wasm-eval'/`wasm-src` 均被拦），MediaPipe 与 ONNX 的 wasm 编译绕不开。在 'unsafe-inline' 已必需的前提下 'unsafe-eval' 边际风险可忽略；CSP 的实效是阻断**外部资源加载链**（远程脚本/样式/连接/插件），这部分完全保留。
- **验证**（Electron 实测探针，非静态推演）：静态服务 public/ 后加载 index.html，采集 console CSP 违规 + 动态功能探测。迭代三轮各抓到真问题并修复：① wasm 编译被拦（→ 'unsafe-eval'）；② liquidglass `buildFontBlocks()` 用 **fetch** 拉 Google Fonts CSS（→ connect-src 放行 googleapis）；③ 同函数对每个 @font-face src **fetch woff2 字节**嵌光栅化 SVG（→ connect-src 放行 gstatic，942 条违规归零）。终态：**CSP 违规 0**；`Hands.initialize()` ok（wasm+assets+tflite 全本地）；transformers 导入 ok 且 wasmPaths 覆写生效（10MB ort wasm 通过 CSP 编译期，仅探针自身缺 import 对象在链接期报错）；98/476 字体 face 加载；inline handler/style、data: 图片正常。探针已删，策略注释里留了复验入口。
- **与报告的偏差**：Google Fonts 未自托管（allowlist 放行）——CSS/字体字节不构成脚本执行面，且 index.html 注释明确字体不可阻塞启动，自托管会改动启动时序与视觉回归面，收益不抵风险。

### #1-R CSP 回归修复（用户实测反馈：酷狗封面全裂、汽水正常）✅
- **根因**：酷狗封面直链是 `http://imge.kugou.com/...`（汽水是 https），而第一批写 CSP 时 `img-src` 只放了 `https:` 没放 `http:` → 所有走直链的酷狗封面（列表/队列/歌单详情/搜索结果/主封面背景）全被拦。服务端 `/api/cover` 代理本身正常（实测 200 + 真 JPEG），裂的只是前端直链路径。
- **定位方法**：真实 server + 真实 API 拉两国封面 URL 对比（酷狗 http / 汽水 https）→ 锁定 scheme 差异 → Electron 变体探针实证：挂 index.html 原样 CSP，`<img src="http://…">` 报 error + 2 条违规，加 `http:` 后 loaded + 0 违规。
- **修复**：`img-src` 与 `media-src`（对称，防首页 hero 视频同类回归）加 `http:`；wallpaper.html 同步（封面经 IPC 下发直链）。本窗口 Origin 自身是 `http://127.0.0.1`，不存在混合内容升级问题，放行 http 图片不构成新的降级面。
- **教训（已写进 index.html 策略注释）**：CSP 的 img/media allowlist 必须覆盖**各 provider 封面 URL 的真实 scheme**——静态审计只能看到代码里写了 https，看不到上游 API 实际下发 http。这类回归只有带真实数据的浏览器实测能抓到。
- 顺带修复：`sync-dist-app.js` 覆盖 dist 时目标文件带 ReadOnly 属性（npm tarball 权限位被上一次同步带进来）会 EPERM，已在 copyFile 里清只读位；源 vendor 文件只读位已清。

### #28-31 四个 XSS 点 ✅
- `05-playback/03b-home-insight.js`：`runHomeSearch(' + escAttr(JSON.stringify(s.name)) + ')`（escAttr 顺带修复了原本就存在的引号闭合 bug——歌名含单引号时属性断裂）。
- `05-playback/05-home-track-detail.js`：评论头像/详情封面 `src` 补 escAttr。
- `06-fx/04-liquidglass-plugin-api.js`：plugin name/description/id 改 escHtml/escAttr。
- 验证：恶意歌名（含 `"'><img onerror=...`）无法 break-out 属性的语义证明；`node --check` 通过。

### #33 虚拟列表窗口差分 ✅
- `06-lyrics/01-playlist-panel-shell.js`：队列/mini 队列滚动 rAF 前比较 `range.start/end + total + currentIdx`，未变则跳过重建。
- `05-playback/07-search.js`：提取 `podcastProgramVirtualRange()`，滚动 handler 差分。
- `05-home-track-detail.js`：`scheduleDetailSongVirtualRender` 签名差分（kind+length+listRect.top+clientHeight），两个列表渲染器重置 sig。
- 验证：差分逻辑 6/6 单测（同窗口跳过 / 起止变化重渲 / total 变化重渲 / 当前项变化重渲 / 滚动容器尺寸变化重渲 / 初始化必渲）。

### #7-12 IPC sender 校验批量补齐 ✅
- `desktop/main.js`：新增 `ownProcessPidSet()`（主进程 + 主窗口渲染进程 + app metrics 子进程，PID 集合动态获取，不用硬编码）；5 个高危 IPC handler 补 `isTrustedMainWindowIpc`。
- `will-navigate`：`file:` 导航仅放行 `app.getAppPath()` 目录内（此前任意 file: 可被导航加载），外部导航继续转交系统浏览器。
- 验证：`_will_navigate_verify.js` 8/8（含前缀绕过 `appPathX`、相对段穿越 `appPath/../..`、http 拒绝）；PID 过滤 3/3。

### #22 安装包下载大小上限 ✅
- `server.js`：`UPDATE_INSTALLER_MAX_BYTES = 800MB` 单包上限 + 累计上限；新增 `fatalUpdateError`（`updateFatal` 标记）——超限后**不再换镜像白下**（此前 per-candidate catch 会把超限吞掉，每个镜像重下 800MB），catch 内直接终局。

### #23 QQ cookie 覆盖竞态加锁 ✅
- `server.js`：`withQQCookieWriteLock`（Promise 链串行化「读-改-写」）+ `qqCookieEpoch` 代际校验。`refreshQQCookieSession` 写回前查代际，**进锁后再查一次**（承重墙补在锁内——排队等锁期间发生的手动保存，锁外那次校验已查完，拦不住）；锁内重读最新 cookie 再合并。
- `server/routes/qq.js`：手动保存/登出两个写入口改走写锁，且 `bumpQQCookieEpoch()` **移进锁的临界区**——原来「写盘→释放锁→bump」之间刷新可插入并覆盖（探针 T3 实测抓到这个窗口后补的）。
- 验证：`_qq_cookie_lock_verify.js`（从 server.js 抽取真实函数 + 桩依赖）**15/15**：锁串行/持锁者抛错不卡链/代际拦截（在途刷新遇手动保存、遇登出）/排队窗口拦截/代际单调/正常路径回归；**反向对照**：去掉代际拦截，旧读确实覆盖手动保存——守卫是承重墙。

### 第二批之后（第三节剩余候选）
明文凭据兜底改 fail-closed（加密不可用时拒启动而非明文落盘）、登录态过期检查、汽水验证窗口 webSecurity、`_cuefield_merge_probe/` 等历史探针目录清理、cuefield-next 与 public 下未入 git 的新模块的版本管理决策。

---

## 七、第三批修复记录（2026-10-17 第三轮，已实施并验证）

本批改动前的差异已存 `_debug-archive/batch3-security-2026-10-17/batch3.diff`（相对 git HEAD 的完整 hunks，可直接 `git apply -R` 回退）。语法检查 8/8 通过（`node --check` + 验证页内联脚本 `new Function` 解析），模块合并求值冒烟 `SMOKE_OK`（无新增 ReferenceError）。

### #13 / #18 / #24 / #25 明文凭据兜底全部改 fail-closed ✅
统一原则：**能加密才落盘，加密不可用就只保留在内存**；明文只在「本机加密可用、且下一次写入即可升级为密文」时被读取（历史文件迁移），不再被无条件信任。

- **#18 `desktop/secret-store.js`**：无 `MR` 前缀的文件不再直接当密钥返回。`safeStorage` 不可用 → 返回空（fail-closed）并 warn；可用 → 返回并 warn「legacy plaintext，下次写入会重加密」。写入侧原本就是抛错语义，未放宽。
- **#13 `desktop/main.js`**：`configureCookieStorage` 的 writeFn 删掉「加密失败 → 明文兜底」整段，改为 `_cookieLog` + `console.error` 报告「credential NOT persisted」，本次会话凭据仅存内存。启动时的迁移循环（读明文 → `writeSecretFile` 重写）保留，所以老用户的明文 cookie 仍能一次性升级。
- **#24 `server.js`**：新增 `tryEncryptSafeStorage()`（与 secret-store 同格式 `MR`+密文）与 `plaintextCookieAllowed()`（仅认 `MINERADIO_ALLOW_PLAINTEXT_COOKIE=1`）。默认 `writeCookieFile` 改为「能加密就加密，否则拒绝落盘」；默认 `readCookieFile` 不再读明文；`saveKugouCookie` / `saveQishuiCookie` 的明文兜底整段删除。
- **#25 `spotify-api.js`**：OAuth token 从明文 JSON 改为 `MR`+safeStorage 密文（`readTokenFilePayload` / `writeTokenFilePayload`），`saveSpotifyOAuthToken` / `invalidateSpotifyAccessToken` 走新写入器。加密不可用时：读历史明文 token 直接忽略、写入抛 `SPOTIFY_TOKEN_STORAGE_UNAVAILABLE`；`invalidateSpotifyAccessToken` 的写失败被单独 catch，不让「标记失效」拖垮刷新链路。
- 验证：`_verify_credential_failclosed.js` **20/20**（源文件真实函数求值 + 可控 safeStorage 桩）。覆盖：明文+不可用→拒读 / 明文+可用→可读 / 密文+不可用→拒读 / 不可用→写抛错且不产文件 / 密文不含明文子串 / token 落盘为 `MR` 密文且可读回 / 历史明文 token 在可用时被接受、不可用时被忽略 / 拒绝写入后旧文件未被覆盖 / server 默认写入器四条路径（加密、不可用拒绝、开发开关放行、历史明文默认拒读）。
- 回归：`tests/spotify-api-resilience.test.js` 原本假设 token 是明文 JSON，已加 `installSafeStorageStub()` 模拟「本机加密可用」的生产环境，测试恢复通过。

### #19 汽水登录态过期检查 ✅
`qishui-qr-login.js` 不再只靠 `/sessionid|sid_guard|sid_tt/` 正则判已登录：
- config 新增 `loggedInAt`；`updateConfig` 检测到 **cookie 变化**（新登录）时写入时间戳，清空 cookie 时归零，同值重复写入不刷新（避免被反复续期）。
- `MAX_SESSION_AGE_MS = 30 天`；`getStatus()` 返回 `loggedIn`（= cookie 在 且 未超期）、`cookieReady`（单纯 cookie 存在）、`sessionExpired`、`sessionAgeDays`。
- 历史配置没有 `loggedInAt` 时不做凭空判死（保持原行为），已经有新登录动作的才会被纳入过期判定。
- `/api/qishui/status` 本来就经 `handleQishuiStatus` 走上游真实校验，本项只修正 QR bridge 自己对外声称的那份状态。
- 验证：`_verify_qishui_session_expiry.js` **8/8**（vm 跑真实源码，stub auth/electron）：新鲜→loggedIn / 超期→不再声称 loggedIn 且 `sessionExpired=true` 仍报 `cookieReady` / 无时间戳的历史配置保持原行为 / 新 cookie 记录时间戳 / 同值不续期 / `clear()` 归零。

### #17 汽水验证页 `decision.url` 远程脚本白名单 ✅
`qishui-auth-v6/security_host.html`：`loadVerifyScript` 是页面里**唯一**的动态代码注入点，此前把 API 响应里的 `decision.url` 直接 `appendChild(<script>)`——响应链路被动手脚即在持有登录 cookie 的窗口内任意 JS 执行。现在：
- 必须 `https:`（`javascript:` / `data:` / 协议相对 / 相对路径一律拒）。
- host 必须命中白名单：`api.qishui.com`、`bff-pc.qishui.com`、`verify.zijieapi.com`、`auth.zijieapi.com`（含子域，用 `host === item || host.endsWith('.'+item)` 判断，后缀陷阱 `verify.zijieapi.com.evil.com` 拦得住）。
- 官方换 CDN 时的复位路径：`MINERADIO_QISHUI_VERIFY_SCRIPT_HOSTS=a,b` → 主进程 `did-finish-load` 注入 `window.__mineradioVerifyScriptHosts`（覆盖页面重载）；被拦时错误信息带上具体域名与这个 env 名，不静默。
- 验证：`_verify_qishui_script_allowlist.js` **14/14**（从 HTML 抽取真实 `loadVerifyScript` 求值）：4 个官方域放行、8 个恶意/降级 URL 全部拒绝、env 追加域放行且不放大到其它域。

### #26 删临时诊断代码 ✅
`server.js` `getQishuiDecryptedAudio` 里两段 `[临时诊断-确认后删除]`（把加密音频与解密产物写死 `D:/Mineradio/_qishui_audio_dump`）删除。已 grep 全仓库，只剩 `desktop/main.js` 的 devTools 一处 `[临时诊断]`（本批一并处理）。

### #14 DevTools 按 isPackaged 关 ✅
`desktop/main.js` 新增 `devToolsEnabled()`：`MINERADIO_DEVTOOLS=1` 或非打包态才为 true。`BrowserWindow.webPreferences.devTools` 与 F12/Ctrl+Shift+I 快捷键两处都走它。用户跑的 `dist/Mineradio/Mineradio.exe` 属打包态 → 默认无 DevTools；开发态 `npm start` 不受影响。

### #36-#41 性能细节与死代码 ✅
- **#36** `06-lyrics/05-upload-dragdrop.js`：新增 `_localAudioObjectUrl` + `releaseLocalAudioObjectUrl()`，新曲接管 `audio.src` 之后释放上一份 blob URL（早释放会打断仍在读旧 URL 的分析；旧 URL 在换歌后已无任何引用点）。
- **#37** `11-main-loop.js`：`#custom-bg-video` 改为 `liquidGlassBgVideoEl()` 缓存引用（`isConnected` 为 false 时重新解析），不再在 rAF 里每帧 `getElementById`。
- **#38** `02-visual/00a-pointer-interaction.js:156`：free camera 滚轮改走文件里已有但从未被使用的防抖版 `scheduleFreeCameraStateSave(400)`，不再每个 wheel 事件同步 `JSON.stringify` + 写 localStorage。
- **#39** `07-fx/00-preset-archive-data.js`：删除第一份 `renderUserFxArchives`（被后一份同名声明的遮蔽，永不生效）。删除后全文件仅剩 1 处定义，行为不变（后声明者原本就赢）。
- **#40** `05-playback/03a-home-dashboard.js`：删掉声明后从未使用的 `homeDashboardStableCoverRequests`（grep 全仓库仅此一处声明）。
- **#41** `06-fx/00-liquidglass-manager.js`：删掉无任何引用点的 `searchResults` 预设（`01-liquidglass-config.js` 只消费 `fxPanel/searchBox/homeCard/listeningToday/bottomBar`）。保留 `04-liquidglass-plugin-api.js` 的预设枚举接口不受影响。

### 补做：#20 / #21 / #27 / #29（首轮漏记，本轮补齐）✅

首轮修复漏掉了这四项，问题清单里一直挂着。本轮按「改动小、无需真机验证」优先的顺序补齐。

#### #21 HTTP 边界三件套（DNS rebinding）✅

这是本批唯一「能被远程利用」的一项，三个子问题必须一起修，缺任一项都不成立：

1. **Host 头白名单**（`server/lib/http-server.js`，`handleRequest` 最前面）
   新增 `hostHeaderIsLoopback()`：只放行 `127.0.0.1` / `localhost` / `::1`（含 `[::1]` 字面量与任意端口），其余一律 `403 BAD_HOST`，且**在 CORS 与任何响应写出之前**拒绝（连 ACAO 都不发，不给攻击者留读响应的一半条件）。
   为什么必须是 Host 而不是 CORS：rebinding 后浏览器以 `evil.com` 的 origin 发请求，**同源成立、不走 CORS 检查**，任何反射策略都救不了；只有 Host 头还留着 `evil.com`。
   `desktop/main.js:3524` 原本已强制 `HOST='127.0.0.1'`，但那只是「不绑 0.0.0.0」，挡不住 rebinding —— 这一层补的正是那个缺口。需要局域网访问时用 `MINERADIO_ALLOW_NON_LOOPBACK_HOST=1` 显式解除，默认 fail-closed。

2. **CORS 由「任意环回端口」收紧为「精确本服务 origin」**
   新增 `isOwnOrigin()`：协议必须是 `http:`、端口必须等于本服务 `PORT`、主机名必须是环回字面量。原来判据是 `/^http:\/\/127\.0\.0\.1:/`，本机任何端口的页面（包括随手起的另一个 dev server）都能拿到带 ACAO 的响应去读 token 注入页。

3. **`/` 与 `/index.html` 加 token 门禁**
   `serveIndexHtml` 会把 `API_TOKEN` 明文注入 HTML（`server.js:571`），是全站唯一的 token 出处，而静态路由原本完全不过门禁 —— `GET /` 即拿 token。现在要求 `?token=` 且用常量时间比较（`safeTokenEquals` → `crypto.timingSafeEqual`），无 token / 空期望值一律 403。
   配套必须改主进程：`loadMainWindowWithRetry` 的 `baseUrl` 原本不带 token，加门禁后不同步改就是启动白屏。已在 `desktop/main.js:3719-3723` 拼上 `&token=`（`ensureLocalServerStarted` 先于它执行，token 已就位）。
   **已知影响**：手动在浏览器开 `localhost:3000` 会 403 —— 这是有意的 fail-closed。

#### #20 token 常量时间比较 ✅
`server/lib/media-proxy.js` 的 `assertApiAuth` 改走 `tokenEqualsConstantTime`（长度不等直接 false，等长才 `crypto.timingSafeEqual`；长度本身不是秘密），并补两处 fail-closed：`if (!token) return false` / `if (!expected) return false`。原先的 `===` 在首个不同字节处提前返回，逐字节计时差可被用来还原 token —— 本服务只监听环回、攻击面有限，但比较成本几乎为零，没理由留着侧信道。
（`/api/audio`、`/api/cover` 走 `?token=` 的设计保留：这两个是 `<audio src>` / `<img src>` 直接发起的请求，没法带自定义头。已在报告中记为已知取舍。）

#### #27 错误信息不再直回客户端 ✅
`server/routes/update.js` 共 7 处：`/api/update/latest`、`/download`、`/patch` 三个 catch，beatmap 读/写，cuefield transition、cuefield feedback 读/写。全部改为稳定错误码（`UPDATE_CHECK_FAILED` / `UPDATE_DOWNLOAD_START_FAILED` / `UPDATE_PATCH_START_FAILED` / `BEAT_CACHE_READ_FAILED` / `BEAT_CACHE_WRITE_FAILED` / `CUEFIELD_TRANSITION_FAILED` / `CUEFIELD_FEEDBACK_READ_FAILED` / `CUEFIELD_FEEDBACK_SAVE_FAILED`），细节转服务端日志。
复核：`grep err.message` 后该文件只剩注释与日志行；`00-update-preview.js` 只把 `error` 当提示文本显示、无逻辑分支依赖，改稳定码不构成回归。
`publicUpdateJob` 的 `filePath` **保留**：前端「打开安装包」按钮要用，且主进程 `mineradio-open-update-installer`（`main.js:3125-3137`）已有 `isTrustedMainWindowIpc` + `path.resolve` + `startsWith(updateDir + path.sep)` 三重校验。

#### #29 插件改为「显式启用才求值」 ✅
`public/js/modules/06-fx/04-liquidglass-plugin-api.js` 的 `loadDesktopLiquidGlassPlugins` 原本无条件 `(0, eval)(plugin.source)` —— 而插件文件的 `registerPlugin` 在模块顶层就调，**求值即执行**，与开关状态无关。等于把「往 `userData/plugins/liquidglass/` 放一个 .js」直接升级成「重启即代码执行」。

改为 pending 模式：
- 首次发现的插件只 `registerPendingPlugin()` 登记元信息（`pending: true`），**不读源码**；
- 面板照常显示（否则用户永远看不到、也就永远无法启用），描述标为「未加载：点开关启用后才会读取并执行该脚本」；
- 用户在面板里点启用 → `setPluginEnabled` 里先 `evalPluginSource()` 真正求值拿到 `setupFn`，再走正常启用路径。

两个必须注意的坑（都已在代码注释里写明）：
- **不能重复跑 setup**：求值后 `registerPlugin` 会按当时的 `enabledMap[id]=true` 自己跑一遍 setup，`setPluginEnabled` 若继续往下走就是同一块 root 挂两套玻璃 —— 帧率与延迟直接翻倍。所以 pending 分支求值成功后**提前 return**。
- **`evalPluginSource` 的判据是「登记项不再是 pending」而不是「登记项存在」**：pending 占位本身也是 `pluginRegistry[id]`，光看存在会把「求值成功但压根没调 registerPlugin 的空脚本」当成加载成功。另外插件自己声明的 id 与文件名不一致时，注册会落在别的 id 上，此时要清掉文件名占位（幽灵项），否则面板多出一条永远点不开的条目。

`public/index.html` 的 CSP 含 `'unsafe-eval'`（MediaPipe / ONNX wasm 编译必需），所以这道收缩是**逻辑层**的，不是 CSP 层 —— 值得记下来，避免以后有人以为 CSP 已经挡住了。

#### 本批验证
- `node --check`：6 个改动文件全过。
- 新增 `tests/http-security-boundary.test.js`（20 条，真起 server 真发请求）：Host 放行/拒绝/缺失、拒绝时无 ACAO、`[::1]`、CORS 只回显本服务 origin、`/` 与 `/index.html` 的 token 门禁（无/错/对三种）、非首页静态资源不受影响、`/api/*` 鉴权、`assertApiAuth` 常量时间与 fail-closed、源码里不得退回 `===`、主进程导航必须带 token、插件 pending 机制与「不得重复跑 setup」。
- 新增 `scripts/check-startup-token-gate.js`：真启 Electron（支持 `--exe` 指向打包版，离线环境可用）→ 断言 URL 带 token、`#bottom-bar`/`#search-box` 渲染、`window.__MINERADIO_API_TOKEN__` 有值、用该 token 打 `/api/login/status` 得 200。**实测 PASS**（token 长度 64，`/api/login/status` 返回 200）。
- 全量 74 个测试文件：4 个失败（`home-dashboard-update` / `home-hero-mp4-platform-recommend` / `search-frontend-pagination` / `ui-default-theme-shelf-layer`），已用 `git stash` 验证为**基线既有失败**，与本次改动无关（失败数完全一致）。
- `node scripts/sync-dist-app.js` 同步 690 个文件，6 个改动文件双端 sha256 一致。

### 未实施（附原因）
- **#15 `qishui-auth-v6.js:268` `webSecurity: false`** 与 **#16 `ACAO: *` / `Expose-Headers: *`**：两者是同一个设计的两面——验证页从 `http://127.0.0.1:<port>` 发起，`window.__qishuiRequest` 直接 XHR 到 `https://api.qishui.com`，且流程依赖 cookie 随会话自动携带；一旦打开 `webSecurity`，这些请求会变成需要 CORS 的跨源请求，而注入的 `ACAO: *` 对**携带凭据**的请求本身又不合法 → 登录链路会断。要真正关掉它必须把 `__qishuiRequest` 改为主进程 `net.request`（走同一 partition 的 cookie，无 CORS），并假定官方二次验证组件在自己的 iframe 里带完整 CORS 头——这两点都只能在真实汽水账号 + 触发 MFA 的环境里验证，静态推导不足以判定。本批只切断了该窗口内**唯一**的任意代码注入点（#17），把 `webSecurity:false` 的实际暴露面从「响应被篡改即任意 JS」缩到「官方组件自身代码」。在拿不到真实 MFA 会话前，改 #15/#16 属于「交付一个可能直接让用户登不上的改动」，故不做。
