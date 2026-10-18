# 服务端拆分：进度与做法

> 目标：把 server.js 里的**领域逻辑**按依赖边界搬出去，让「哪个平台出问题」能一眼定位到文件，而不是在 6000 行里翻。
> 原则：只搬不改逻辑（verbatim move），依赖显式注入，每次搬迁都用「新旧实现同输入对拍」证明等价。

## 已完成

### 第 1 块：天气电台（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 6729 行 / 277,111 字符 | 6042 行 / 249,842 字符（-687 行 / -9.8%） |
| `server/lib/weather-radio.js` | — | 793 行 / 31 个函数 |

- 范围：原 `server.js` 2804–3555 行（`clampNumber` … `orderWeatherSongs`）。
- 依赖注入 8 项：`UA`、`requestJson`、`handleSearch`、`handleSongUrl`、`playlist_detail`、`playlist_track_all`、`mapSongRecord`、`userCookie`（以 `getUserCookie()` 传入，避免快照过期）。
- 顺带搬走 8 个只被该块使用的常量（`OPEN_METEO_*` / `WEATHER_*`），它们此前散在文件头。
- `SCENE_PRESETS` 原本夹在天气代码中间、但只被场景电台使用 → 移到场景块开头。
- 函数名与拆分前完全一致并在 server.js 解构回同一名字，**所有调用点零改动**；`routeCtx` 绑定不受影响。

**为什么选它先做**：静态依赖分析显示该块只碰 5 个外部符号（`requestJson`/`handleSearch`/`handleSongUrl`/`userCookie`/`SCENE_PRESETS`），是 server.js 里依赖面最干净的 700 行。

### 第 2 块：更新 / 补丁 / 镜像 / beatmap 缓存（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 6042 行 / 249,842 字符 | 4798 行 / 197,527 字符（-1244 行 / -21%） |
| `server/lib/update-manifest.js` | — | 430 行 / 28 个函数 |
| `server/lib/update-service.js` | — | 820 行 / 31 个函数 |
| `server/lib/beatmap-cache.js` | — | 103 行 / 6 个函数 |
| `server/lib/fetch-utils.js` | — | 71 行 / 4 个函数 |

- 范围：原 `server.js` 619–1903 行，69 个函数，**两刀切开**：
  - `update-manifest` = 纯逻辑（版本比较 / 镜像候选 / manifest 归一 / latest.yml 解析 / 摘要 / 错误分类），零 I/O，可对拍。
  - `update-service` = 执行层（拉清单 / 下载含镜像回退 / 校验 / 打补丁 / 任务态），I/O 全在这里。
- 「同源但不同域」的两块顺手归位：`promiseWithTimeout`/`readStreamChunkWithTimeout`/`fetchWithTimeout`/`fetchTextFromCandidates` → `fetch-utils`（被酷狗取址、媒体代理共用）；beatmap 磁盘缓存 → `beatmap-cache`（与更新系统无关，只是原位置相邻）。
- 注入面：`update-manifest` 只要 `{ appRoot }`；`update-service` 要 `{ manifest(15 函数), fetchUtils(2 函数), config(10 常量 + appRoot), jobs }`。

**这一块踩到的三个坑（后面每块都会遇到）**：

1. **依赖不能只按「函数调用」算**。`PATCH_MAX_BYTES`、`PATCH_ALLOWED_ROOTS` 这类常量出现在正则/路径里而不是 `name(` 形式，只扫调用会漏 10 个注入项。抽取脚本必须同时扫裸标识符 `/\b([A-Za-z_$][\w$]*)\b/g` 求并集。
2. **常量比工厂调用晚定义**。`APP_VERSION`/`UPDATE_CONFIG`/`UPDATE_FALLBACK_NOTES` 在 server.js 里位于工厂调用之后 → 直接 `{ APP_VERSION }` 会注入 `undefined`。改法：模块内部一律读 `cfg.X`（调用期求值），server.js 里保留 `const updateManifestConfig = { appRoot: __dirname }`，常量定义完再 `Object.assign(updateManifestConfig, { APP_VERSION, … })` 回填。
3. **`__dirname` 会跟着文件搬家**。`path.join(__dirname,'package.json')` 搬进 `server/lib/` 后指向 `server/lib/package.json`，`path.resolve(__dirname,…)` 的补丁落盘根同理。抽取时必须做文本替换成 `appRoot`，否则「版本号读不到」「补丁写到 server/lib/」这类问题只在运行时暴露。

### 第 3 块：酷狗协议族（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 4798 行 / 197,527 字符 | 4225 行 / ~174KB（-573 行） |
| `server/lib/kugou-protocol.js` | — | 223 行 / 15 个函数 |
| `server/lib/kugou-service.js` | — | 497 行 / 16 个函数 |

- 范围：原 `server.js` 2911–3560 行（`kugouMd5` … `handleKugouSongUrl`），31 个函数，**按层切两块**：
  - `kugou-protocol` = 签名（android/web）、设备指纹（guid/mid/mac/dev）、cookie 头拼装、gateway / cloudlist 请求封装。零业务语义。
  - `kugou-service` = 登录二维码、设备注册、歌单/云盘、曲目映射与排序、取址（trackercdn）。
- **两层是单向依赖**：`service → protocol`（9 个函数：`kugouMd5`/`kugouInitDevice`/`saveKugouAuth`/`kugouCookieMid`/`kugouCloudlistCookieHeader`/`kugouGatewayRequest`/`kugouCloudlistRequest`/`kugouSafeGet`/`kugouDeepFind`），protocol 不反向引用 service。
- 两个可变状态必须特殊处理，不能按值注入：
  - `kugouCookie`（`let`，被块外 cookie 持久化层反复重新赋值，块内只读）→ 注入 `getKugouCookie()` getter，**消息内 3 处引用改成 `getKugouCookie()`**。
  - `kugouVipProbeCache`（块内读写 + 块外 `saveKugouCookie` 也写）→ server.js 改成 holder `const kugouVipProbe = { current: … }`，模块内用 `kugouVipProbe.current`。

**这一块的教训（比前两块更硬）**：

1. **「互不引用」不能只按一张手写的外部符号表判定**。第一版分析表里只列了 `KUGOU_*` / cookie helper / `requestText` 这类外部符号，没有列**协议层函数名**，于是漏掉了 `service → protocol` 的 9 条边。`node --check` 与等价性对拍都过（那些函数不在测试用例里），**只有真起服务打 `/api/kugou/login/qr/key` 与 `/api/kugou/song/url` 才炸出 `saveKugouAuth is not defined` / `kugouCookieMid is not defined`**。判据：冒烟必须覆盖每个会走到「非纯函数」的端点。
2. **导出表不能靠正则扫 `function name(` 生成**。`kugouDeepFind` 里有**嵌套** `function walk`，正则会把它当顶层导出 → 模块加载即 `ReferenceError: walk is not defined`。导出表必须从显式分组清单取。
3. **随机函数只能比形状**。`kugouInitDevice` 缺字段时会 `crypto.randomUUID()` + 随机 mac/dev；对拍必须区分「全字段给定（逐字比）」与「缺省（比长度/字符集/键集）」。同理 `kugouRandomString`。
4. **网络路径的等价性要单独做定向对比**。对拍只覆盖纯逻辑；`handleKugouSongUrl` 这类必须打上游的，用 `_cmp_kugou_net.js` 对同一 hash 比「结果形状」（provider/playable/hasUrl/level/reason），实测新旧都返回 `login_required`。

### 第 4 块：网易同曲匹配（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 4225 行 | 3973 行 / 158,990 字符（-252 行） |
| `server/lib/netease-source-match.js` | — | 297 行 / 14 个函数 + 5 个常量 |

- 范围：原 `server.js` 1109–1370 行（`NETEASE_SOURCE_MATCH_*` 常量 … `findNeteaseSameTrackCandidates`），外加散在 970 行的 `NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS`（块外 3741 也用 → 搬进模块后解构回同名）。
- 结构：13 个纯函数（文本归一 / 时长归一 / 艺人集 / 版本标记 / 音质档 / 指纹 / 打分 / 缓存 key）+ 1 个上游入口（`findNeteaseSameTrackCandidates`）+ 纯内存 TTL 缓存。
- 注入面只有 5 个：`promiseWithTimeout`、`cloudsearch`、`song_detail`、`mapSongRecord`、`getUserCookie`（`userCookie` 是 `let`，块内 3 处只读）。

**这一块的方法论收获（对后面每块都适用）**：

1. **「打上游」的函数也能逐字对拍，靠模块解析劫持**。旧实现的 `cloudsearch`/`song_detail` 来自 `_lazyFn(_neteaseMod, …)` → `require('NeteaseCloudMusicApi')`。用 `Module._resolveFilename` 把该名字指向桩模块，两侧就吃到同一份 fixture，`findNeteaseSameTrackCandidates` 变成确定性函数，连「上游调用顺序与参数」都能比。
2. **劫持必须在调用期仍有效**。`_lazyFn` 是**首次调用时**才 require，我第一版在 require 完备份后就恢复了劫持 → 旧侧静默加载到真实模块、返回空数组。症状是「旧侧结果全为空、新侧有值」，很容易误判成拆分 bug。**旧侧结果为空时，先怀疑桩没生效，别急着改代码。**
3. **用例要能区分，不能只看「跑通」**。第一版打分用例全返回 `-1`（因为实现里 `source.id === candidate.id` 直接拒，我两边给了同一个对象），等于没验。改成不同 id 的同内容对象后拿到 `-1 / 125 / 147 / 365`，覆盖了：同 id 拒、基础分、艺人 id 命中 + 权益加成、官方替代 +240、版本标记不符、艺人不同、时长越界、名称不同。

**验证**：`_verify_netease_split.js` 纯函数 14 组 + 异步 5 组（full / missingHints / emptyId / official / noMatch）**0 差异**；`_smoke_netease_split.js` 5/5，其中 `/api/song/url?skipDirect=1` 真实走到同曲匹配（响应 `reason: url_unavailable, message: "正在继续尝试网易云站内的其它同曲版本"`）。

### 第 5 块：场景电台（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 3973 行 / 158,990 字符 | 3612 行（-361 行） |
| `server/lib/scene-radio.js` | — | 433 行 / 13 个导出（12 函数 + `SCENE_PRESETS`） |
| `server/lib/weather-radio.js` | 793 行 | 775 行（移出 34 行场景常量，补入 `buildWeatherRadio`） |

- 范围：原 `server.js` 1340–1721 行（`SCENE_PRESETS` + 12 个场景函数），外加 `buildWeatherRadio`。
- 注入 9 项：`handleSearch` / `handleKugouSearch` / `handleQQSearch` / `handleQishuiSearch` / `qishuiCookieHasLogin` / `weatherArtistKey` / 三个 cookie getter。未登录时 `sceneRadioProviders()` 只返回 `['netease']`，多音源分支要靠登录态才走到。
- `buildWeatherRadio` 归位天气域（它在场景段里，但只被 `/api/weather/radio` 用）→ `weather-radio.js` 导出 + server.js 天气解构新增该名字。

**这一块最重要的是抓出了第 1 块拆分留下的真 bug**：

> `SCENE_RADIO_ROTATE_MS` / `SCENE_RADIO_CACHE_TTL_MS` / `SCENE_RADIO_MAX_SONGS` / `SCENE_RADIO_PER_KEYWORD` / `sceneRadioCache` / `SCENE_KEYWORD_EXTRA` 这 6 个常量被第 1 块（天气）**误搬进了 `weather-radio.js`**，而那里一次都没用到它们，真正的使用方是留在 server.js 的场景函数。
> 后果：**`/api/scene/radio` 与 `/api/scene/presets` 从第 1 块拆分起必定抛 `ReferenceError: SCENE_RADIO_ROTATE_MS is not defined`**。
> 为什么前面几块没发现：它们各自的对拍与冒烟都不打场景端点；而 `node --check` 与静态依赖扫描都不会报「跨文件 symbol 被搬走」。第 5 块把常量整体归位到 `scene-radio.js` 后修复，`_audit_orphans.js` 复查 SCENE 前缀已清零。

**对拍基准的选择（方法论，后面还会遇到）**：这一块的「旧实现」不能取 `_server_before_scene_split.js`（第 4 块后的快照），因为那份快照本身就带着上面那个 bug —— 拿它当基准等于**把 bug 当真理**，第一版 `capture-old` 直接采到 41 处差异，全是 `SCENE_RADIO_ROTATE_MS is not defined`。正确做法是把基准往前退到 `_server_before_batch4.js`（第 1 块拆分**之前**的 server.js，常量还在原地）。**判据：捕获阶段旧侧出现成片 `X is not defined` 时，先怀疑快照选错，别去改新实现。**

**验证**：`_verify_scene_split.js` 纯函数 9 组（bucket / rotateSeed / shuffle / keywords / providers / lowSignal / songKey / normText / echoFamily）+ 异步 5 组（searchProvider + focus/rain/sleep 选歌 + buildSceneRadio）**0 差异**；`_smoke_scene_split.js` 6/6，其中 `/api/scene/radio?scene=focus|rain|__nope__` 全部 200 且 `ok:true`（这条就是上面那个 bug 的回归闸门）。

### 第 6 块：媒体代理 / 鉴权 / 汽水音频解密（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 3617 行 | 3273 行（-344 行） |
| `server/lib/media-proxy.js` | — | 213 行 / 11 个导出（9 函数 + 2 常量） |
| `server/lib/qishui-audio.js` | — | 231 行 / 13 个导出（10 函数 + 3 常量） |

- 范围：**物理上两段**——原 `server.js` 249–345（汽水解密 state + worker + 3 个解密函数）与 1915–2184（出站白名单 + DNS/IP 闸门 + 逐跳重定向复检 + token 鉴权 + 音频头/Range 响应）。共 20 个函数、367 行。
- **两段合并到同一个注入点（1915）**：解密段的对外符号（`getQishuiDecryptedAudio` / `qishuiAudioAuthFromUrl`）只被 3446 行的 `routeCtx` 用，代理段的符号只被 2972 / 3444–3445 / 3527 用——全部晚于 1915。这样避开「`qishui-audio` 依赖 `media-proxy`，但 `media-proxy` 若在原地注入会跑到前面」的倒序问题。**判据：搬家前把「每个导出符号的所有块外引用行号」打出来，注入点取 min() 之前即可。**
- 按层切两块（单向依赖 `qishui-audio → media-proxy`）：
  - `media-proxy` = 安全闸门 + 鉴权 + 音频响应（`PROXY_MEDIA_HOST_SUFFIXES` / `isBlockedProxyAddress` / `isBlockedProxyHost` / `isAllowedProxyMediaHost` / `assertProxyableMediaUrl` / `PROXY_MEDIA_MAX_REDIRECTS` / `fetchProxiedMedia` / `requiresApiAuth` / `assertApiAuth` / `audioProxyHeadersFor` / `audioContentTypeForUrl` / `sendAudioBuffer`）。
  - `qishui-audio` = 解密 worker（含同步回退）+ LRU 字节缓存 + inflight 去重 + 并发闸门 + 产物文件头校验。
- 两项特殊注入：
  - `API_TOKEN` 是 `let`（`ensureApiToken()` 会重新赋值）→ `getApiToken: () => API_TOKEN`，`assertApiAuth` 里改成调用期读取。
  - 解密 worker 路径含 `__dirname` → 以 `workerPath` 注入（模块在 `server/lib/`，`__dirname` 直接搬会指错）。
- `server/routes/audio.js` 与 `server/routes/netease.js` 通过 `routeCtx` 取这些名字，解构回同名后**两个路由文件零改动**。

**验证（三重，因为这块是安全闸门）**：

1. `_verify_media_split.js` — ① **逐字搬移证明**：20 个函数体 + 5 个常量在新模块里与备份逐行一致（归一化仅允许「各自最小公共缩进」+ 两处已知替换 `API_TOKEN→getApiToken()` / `new Worker(path.join(__dirname,…))→new Worker(workerPath)`）。这条覆盖了必须打真实 DNS/上游才能跑的函数（`fetchProxiedMedia`、`getQishuiDecryptedAudio`）。② **行为对拍** 127 项（主机/地址闸门 50 组、鉴权 8 组、音频头 15 组、汽水 auth/cache key 12 组、产物校验 10 组、`sendAudioBuffer` 9 组 mock res、`assertProxyableMediaUrl` 拒绝路径 11 组）**0 差异**。
2. `_proxy_redirect_verify.js` — **6/6**（302 打本机 / 打内网被拦、同白名单合法跳转可跟随、跳转循环触发上限、200 直通）。**这个脚本原来读 `server.js` 切源码，拆分后必须改读 `server/lib/media-proxy.js` 并去掉工厂内 2 空格缩进**，否则切片 marker 全部找不到。
3. `_audio_hostguard_test.js` — 真 `dist/Mineradio/Mineradio.exe` 走 `/api/audio`，**12/12**（白名单放行、后缀伪装、白名单域当子域前缀、白名单域中缀、环回、链路本地/云元数据、192.168/10 私网、ftp、file 全部 400）。
4. `_smoke_media_split.js` — **14/14**，含「缺 token / 错 token 被拒 403」「`/api/search` 不吃 query token」「`/api/cover` 吃 query token」「静态资源不需要 token」。

### 第 7 块：播客映射（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 3273 行 | 3135 行（-138 行） |
| `server/lib/podcast-map.js` | — | 186 行 / 7 个函数 |

- 范围：原 `server.js` 2452–2601（`mapPodcastRadio` … `fetchMyPodcastItems`），7 个函数。
- 注入 7 项：`mapArtists` + 5 个网易云惰性代理（`dj_sublist` / `user_audio` / `dj_paygift` / `record_recent_voice` / `sati_resource_sub_list`）+ `getUserCookie`。
- 导出 4 个对外函数（`mapPodcastRadio` / `mapPodcastProgram` / `podcastCollectionMeta` / `fetchMyPodcastItems`），`firstArrayFrom` / `mapPodcastVoice` / `mapPodcastCollectionRadio` 内部使用但也一并导出，便于对拍。
- `routeCtx`（第 3114 行）与 `server/routes/netease.js` 的 `mapPodcastRadio` 等调用点零改动。

**这一块冒烟抓到的真问题**：拆分脚本给模块注入了 `getUserCookie`，但 server.js 里**只有** `getKugouCookie` / `getQishuiCookie` / `getQQCookie` 三个（前几块的 netease 模块是内联写 `getUserCookie: () => userCookie`，没留具名绑定）→ 加载即 `ReferenceError: getUserCookie is not defined`。修法：在 cookie getter 区补 `const getUserCookie = () => userCookie;`，四个统一。**判据：抽取脚本注入的每个 getter 名字，都要在 server.js 里 `grep -c 'const getXxxCookie ='` 确认存在，不能假设「上一个模块有就一定有」。**

**验证**：`_verify_podcast_split.js` **94/94 一致**（7 个函数），其中 `fetchMyPodcastItems` 的 5 条上游分支靠 `Module._resolveFilename` 劫持 `NeteaseCloudMusicApi` 换桩全跑通（collect / created / paid / liked-sati / liked-回落 recent / liked 双失败 / unknown），并逐字比了「调了哪个接口 + 参数（剥 timestamp）」。`_smoke_podcast_split.js` **5/5**，其中 `/api/podcast/search?keywords=深夜` 真打到上游并走完 `mapPodcastRadio`（拿到 `id/rid/name/cover/desc`）。

### 第 8 块：QQ 协议族（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 3135 行 | 2083 行（-1052 行） |
| `server/lib/qq-session.js` | — | 619 行 / 18 个导出（15 函数 + 3 常量） |
| `server/lib/qq-content.js` | — | 603 行 / 22 个导出（20 函数 + 2 常量） |

- 范围：**三段**（中间只剩别的模块的注入块）——原 `server.js` 1274–1820（`parseJSONText` / `qqMusicRequest` / VIP 探测合并 / cookie 刷新链 / `getQQLoginInfo` / `qqGetJSON`）、1843–1959（歌单映射 + 用户歌单 + 单张歌单曲目）、2038–2451（曲目/搜索/取址/评论/歌词）。另有 3 处常量散在外面：851–857（`QQ_QUALITY_CANDIDATE_TEMPLATES`）、1120–1125（`QQ_MUSICU_URL` / `QQ_SMARTBOX_URL` / `QQ_HEADERS`）、2469（`QQ_VKEY_REQUEST_TIMEOUT_MS`）。共 35 函数 / 1036 行。
- 按层切两块，单向依赖 `content → session`：
  - `qq-session` = JSONP 解析、musicu.fcg 请求、VIP 探测与合并（含 `qq-vip-api` 插件桥）、cookie 刷新链（write-lock + 代际校验）、登录态与 profile 归一。
  - `qq-content` = 歌单/曲目映射、搜索（smartbox + musicu）、取址（音质模板 + 实测）、评论、歌词（musicu → `fcg_query_lyric_new` 回落）。

**这一块的三个关键判断**：

1. **注入点必须提到场景电台注入之前**。`scene-radio` 的 deps 里有 `handleQQSearch`，而 QQ 块原位置在 1274 之后；若在原地注入，1258 行就会拿到 TDZ。选在 1253（场景注入前一行）时，session 需要的 `QQ_COOKIE_FILE`(181) / `UA`(179) / 7 个 qqVip 惰性代理(140–146) 都已定义，`requestText` / `saveQQCookie` / `withQQCookieWriteLock` 是函数声明（提升），三个可变状态走 getter/转发即可。
2. **`qqCookie` 有一个写入点**：`refreshQQConfiguredCookieStore` 里 `qqCookie = readCookieFile(QQ_COOKIE_FILE)`。纯 getter 替换会把它变成 `getQQCookie() = ...` → **`ReferenceError: Invalid left-hand side in assignment`**，而且是运行时才炸（`node --check` 过）。所以必须补 `setQQCookie(v)`。**判据：把 `let` 改 getter 时，先 grep 这个变量在同块内有没有赋值，有就同时给 setter。**
3. **`qq-vip-api` 插件的导出名和 server.js 的别名不一样**：插件导出 `normalizeQQVipPayload` / `qqVipObjectLooksExpired`，server.js 用 `_lazyFn` 起名成 `...Strict`。对拍桩必须按**插件真名**导出，否则旧侧全是 `getMod(...)[name] is not a function`，13 项假差异。

**验证**：
- `_verify_qq_split.js` — ① 35 函数 + 5 常量逐字一致（只允许最小公共缩进、`qqCookie→getQQCookie()/setQQCookie()`、`qqCookieEpoch→getQQCookieEpoch()`）；② 行为对拍 **105/105**：`parseJSONText` / 歌单·曲目·艺人·评论映射 / 封面头像 / HTML 实体 / 歌词解码 / `normalizeQQSongId` / VIP 过期与合并链（`qq-vip-api` 换桩）/ `applyQQMusicKeyFields` / `extractQQRefreshPayload` / `normalizeQQProfile` / `qqMusicRequest` 与 `qqGetJSON`（`requestText` 换桩，连上游 URL、body、headers 一起比）。
- `_smoke_qq_split.js` — **12/12**，且都打到真数据：`/api/qq/search?keywords=周杰伦` 返回带 mid 的歌曲、`/api/qq/lyric?mid=0039MnYb0qxYhV` 返回《晴天》原文歌词、`/api/qq/song/comments` 返回 279 条、`/api/qq/artist/detail` 返回五月天。

### 第 9 块：HTTP 分发（2026-10-18）——最后一块

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| server.js | 2083 行 | 1987 行（-96 行） |
| `server/lib/http-server.js` | — | 135 行（2 个导出：`server` / `startHttpServer`） |

- 范围：`shaderMarketCache`(1962) + `http.createServer`(1976–2061) + `startHttpServer`(2063–2074)。
- **`routeCtx`（146 键）与 `routeMatchers`（9 个模块）故意留在 server.js**：它们是「表里有什么」的清单，属于聚合层；搬走等于把清单藏进实现里，加端点时又要回头翻两个文件。这是本块唯一保留原地的部分。
- 3 处必改替换：
  - `__dirname` → 注入 `appRoot`（否则 `public/` 与 `build/icon.ico` 会指到 `server/lib/` 下）
  - `userCookie`（`let`，会重新赋值）→ `getUserCookie()`
  - `API_TOKEN_AUTO`（`ensureApiToken()` 里赋值）→ `getApiTokenAuto()`

**这一块暴露的两个真问题**（都是 `node --check` 与逐字对拍都抓不到的）：

1. **`path` 没注入 → 所有静态资源请求必炸**。原 `server.js` 顶层的 `path` 是模块级绑定；搬进工厂后，handler 里只剩 shader-market 那条 try 里 `const path = require('path')`（块级作用域），静态资源段的 `path.resolve/join/sep` 变成自由变量。逐字对拍当然是 0 差异（文本一模一样），但真发一个 `GET /` 就是 `ReferenceError: path is not defined`。**判据：搬完的 handler，凡是依赖「原文件顶层 require」的名字，逐字一致 ≠ 能跑，必须真请求一次。**
2. 顺手挖出第 2 块的一个跨文件孤儿：`fetchTextFromCandidates` 被放进 `fetch-utils.js`，但它用 `APP_VERSION` / `updateError` / `classifyUpdateError` —— 三个只在 `update-service` 工厂作用域里可见的符号。⇒ 已**归位**到 `update-service.js`（`fetch-utils.js` 只留 `promiseWithTimeout` / `readStreamChunkWithTimeout` / `fetchWithTimeout` 三个真通用件）。用 `_verify_update_candidates.js` 6/6 证明现在这条路真的能跑。

**验证**：
- `_verify_http_split.js` — ① 3 段逐字一致（`shaderMarketCache` / 86 行 handler / 12 行 `startHttpServer`，只允许上述 3 处替换）；② **routeCtx 完整性**：9 个路由模块从 `ctx` 解构出的**每一个**名字，都必须在 `server.js` 里有本地声明；反向再查 `routeCtx` 的 146 个键是否都有声明。这是「聚合表漏一项 → 调用点 undefined」的唯一静态拦截点。
- `_smoke_http_split.js` — **44/44**，两层：
  - L1 工厂直测（注入假 `http` + 假 `res`，逐分支走）：CORS 放行（127.0.0.1 / localhost）与拒绝（`evil.com` / `127.0.0.1.evil.com`）、OPTIONS 204 且不进鉴权、403 鉴权、**9 路由轮询顺序 0..8**、短路后不再问后续路由也不碰静态、着色器市场、favicon、`/` → `serveIndexHtml`、目录穿越 403、`startHttpServer` 幂等（listen 只调一次）。
  - L2 真服务：`GET /` 200 真首页、`/js/index-loader.js` 200、`/api/discover/home` 带 token 200 / 无 token 403、OPTIONS+CORS、`/api/shader-market/list`。

> **目录穿越那条要写清**：WHATWG `URL` 会把点段规范化掉（`/../../package.json` → `/package.json`），`//C:/…` 还会被当成 authority（host 变 `c`）。真正能打到 403 的只有**单斜杠 + 盘符**：`/C:/Windows/win.ini` → `path.resolve(publicDir, 'C:/…')` 在 Windows 上跳到 C 盘。冒烟里三条都断言了，只有第三条命中 403。

## 平台插件族（qishui-api.js / kugou-api.js / spotify-api.js）

server.js 拆完后，原始诉求里点名的另外三个文件还在原地：

| 文件 | 行数 | 字节 | 顶层声明 | 状态 |
|---|---|---|---|---|
| `qishui-api.js` | 3783 | 146,406 | 225 | **三刀完成 → 132 行（纯门面）** |
| `kugou-api.js` | 2335 | 97,903 | 105 | **两刀完成 → 123 行（纯门面）** |
| `spotify-api.js` | 1530 | 58,383 | 84 | **一刀完成 → 98 行（纯门面）** |

这三个是**单文件内部的协议分层**问题，做法与 server.js 不同：
- server.js 是「按领域切」，新模块互不引用；
- 插件族是「按抽象层切」：配置/身份 → 请求与签名 → 资源映射 → 业务编排，**严格单向**，切完 `module.exports` 一个不能变（`server.js` 用 `_lazyFn` 惰性取，`desktop/`、`tests/`、5 个 harness 探针直接 require）。

### 第 1 刀：qishui-api.js → `server/qishui/config.js` + `server/qishui/http.js`（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `qishui-api.js` | 3783 行 | 3158 行（-625） |
| `server/qishui/config.js` | — | 258 行（34 个声明） |
| `server/qishui/http.js` | — | 639 行（48 个声明） |

- **config** = 环境/端点常量、设备身份（`QISHUI_PC_DEVICE_ID` 等）、OAuth 配置读写、token 文件路径。
- **http** = `createTtlCache` + 10 个 cache 实例、`requestText`/`requestJson`/`requestTextWithMeta`、PC 签名（`qishuiPcUrl`/`qishuiPcPassportParams`/`qishuiOrderedForm`）、cookie 与鉴权头构造、cookie 归一、web/pc 请求封装。
- **不用工厂，保持模块级声明 + `module.exports = {…}`**：函数体一行都不用改缩进 → 逐字对拍可以做到 0 容差；`qishui-api.js` 顶部 `const { … } = require('./server/qishui/config')` 解构回同名，调用点零改动。

**分层怎么定的**：`_layer_analyze.js` 对文件做「顶层声明 → 依赖边 → 拓扑层」。
三个坑依次踩过来：
1. 一见 `(` 就开始配平 → 函数签名的参数列表立刻归零，每个函数判成 1 行，出边全 0；
2. 只看括号平衡 → `const X = (a)\n  .split(',')\n  .filter(Boolean);` 第一行就平衡，续行全丢；
3. **括号配平在这里根本不可用** —— `strip()` 只剥字符串不剥**正则字面量**，而本文件有 `/[（(【\[]/` 这种带括号的正则，计数必然失衡，`getQishuiOAuthConfig` 的「出边」一度列了 45 个函数（覆盖检查还照样通过，因为并集不变）。
→ 最终改用「**下一个顶层声明的起始行 − 1**」。前提是顶层声明连续排列，而这个前提本身可以验证：除 `'use strict'` 外，没有任何非空非注释行落在声明之外。

**依赖方向断言**：`config` 只依赖自身；`http` 只依赖 config/自身；留在原文件的 rest 被前序依赖才合法。第一次跑出 7 处倒序，全是 http 引用了判给 rest 的底层工具 → 把 `normalizeText` / `qishuiAccessTokenInfo` / `qishuiAccessToken` / `qishuiQrErrorCode` / `qishuiPcStatusError` 一并下沉到 http，环消失。

**这一刀最险的 bug（测试只表现为「VIP 被降级」）**：
生成 `http.js` 时判断「该 require 哪些内置模块」用的是 `/\bhttps\./` —— 而 `requestText` 里是**裸标识符**：

```js
const lib = u.protocol === 'https:' ? https : http;
```

于是 `http.js` 根本没 `require('http'|'https')`，所有出站请求抛 `ReferenceError`，被 `handleQishuiSongUrl` 的 catch 吞成 `playable:false`、被 search 吞成空列表。`test:quick` 全绿、逐字对拍 0 差异、导出面一致 —— 只有「真实端点的业务断言」能抓到它（`tests/qishui-entitlement-cache.test.js` 报 `verified VIP must not be downgraded`，`tests/provider-entitlement-boundary.test.js` 报 `must receive vip_required`）。
**判据：生成的模块里，内置模块必须按「裸标识符」检测，不能按 `X.` 前缀检测。**

**22 处文本守卫**：`scripts/quick-check/guards.js`（2 处）、`electron-runtime.js`（1 处）、`tests/qishui-local-official-merge.test.js`（1 处）都是 `readFileSync('qishui-api.js')` 后做正则断言。搬走常量后全假失败。
→ `helpers.js` 加 `readQishuiSources()`：`qishui-api.js` + `server/qishui/*.js`（按文件名排序）拼接。
**断言的语义是「这个能力还在代码里」，不是「在第几行」**，所以按族读是对的；但 `guards.js:1228` 那种靠 `indexOf` 切「`fetchQishuiWebLibrary` → `handleQishuiStatus`」的相对位置断言，要求拼接顺序稳定 —— 这两个函数都还在 `qishui-api.js`，顺序不变，切片仍成立。**以后每搬一个函数进 server/qishui/，都要确认没有守卫靠它和另一个函数的前后关系。**

**基线对照**：改完先跑三个汽水测试，全红；把 `qishui-api.js` 临时换回备份再跑，全绿 → 证明是这一刀造成的，不是既有失败。**不做这一步就会把「我改坏的」当成「本来就坏的」。**

**验证**：
- `_verify_qishui_split1.js` — ① 逐字：config 34/34 + http 48/48 个声明本体一致（config 只允许 `__dirname → PROJECT_ROOT`）；② 导出面：27 个键（含 `_test` 13 个子表）的 key / typeof / arity 全等；③ 行为：`_test` 13 个纯函数 17 组用例；④ 位置敏感：`DEFAULT_QISHUI_TOKEN_FILE` 与 OAuth 候选路径仍在项目根、`clearQishuiRuntimeCaches` 真能清 cache。
- `_smoke_qishui_split1.js` — **10/10**，其中 `/api/qishui/search` 真打到上游 public fallback（`publicCatalog:true` 且有歌），这是 `requestText` 链路通了的唯一硬证据。

### 第 2 刀：qishui-api.js → `server/qishui/mapping.js`（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `qishui-api.js` | 3158 行 | **1901 行**（-1257，累计 -1882） |
| `server/qishui/mapping.js` | — | 1461 行（85 个声明） |

- **mapping = 资源映射层（纯函数）**：歌词归一与转换、图片/`profile` 归一、会员判定（显式布尔 / 等级 / 到期 / 对象态）、音质档位与流候选（`qishuiQualityRank` / `qishuiBestStreamCandidate*` / `qishuiStreamFromObject` / 三种 bitrate 推断）、媒体与曲目映射（`mapQishuiMedia` / `mapQishuiMediaList` / `dedupeQishuiSongs` / video-model 流）、歌单卡片（`extractQishuiPlaylistCards` / `buildQishuiVirtualPlaylist` / 5 个 `*FromItem`）、公开搜索（`mapQishuiPublicItem` / `parseQishuiPublicOriginalInfo` / `qishuiSearchComparable` / `qishuiPublicSearchScore` / `rankQishuiPublicSongs`）、评论、`track_v2` 归一。
- **零 I/O**：唯一状态是歌词缓存，且**不自己持有实例** —— `cacheQishuiLyric` 写的是 `http.js` 的 `qishuiLyricCache`。所以本模块单向依赖 `./http` 的 3 个符号（`qishuiLyricCache` / `normalizeText` / `qishuiRestriction`），不 require 任何内置模块。
- **依赖方向**：mapping 只依赖 http；留在 `qishui-api.js` 的业务编排依赖 mapping。无倒序，无环。

**「清缓存」的既有行为别误判成 bug**：`clearQishuiRuntimeCaches()` **不清 `qishuiLyricCache`**（歌词缓存 30min TTL 独立过期）。写对拍脚本时若断言「清完必须为空」会得到一条假 FAIL —— 判定方式是拿 `_qishui_before_split1.js` 的源码逐字对照，而不是靠猜语义。

**验证**：
- `_verify_qishui_split2.js` — ① 逐字：85/85 个声明本体与备份一致；② 导出面：27 个键（含 `_test`）的 key / typeof / arity / 子表全等；③ 行为：`_test` 17 组用例；④ **跨模块缓存同实例**：用探针包住 `qishuiLyricCache.set`，断言 `cacheQishuiLyric` 的写入**确实发生在这个实例上**、`get` 回来的**是同一个 payload 对象**、`clear` 后重写仍落在同一 store，外加「`clearQishuiRuntimeCaches` 与拆分前逐字一致」的源码对照。
- `_smoke_qishui_split2.js` — ① **差分对拍 48 个函数 / 776 组用例**：同一批 fixture 分别喂给「拆分前的整份 `qishui-api.js`」和新的 `mapping.js`，逐字段比返回值与异常；② 6 个导出常量（含 RegExp 源码与 flags）一致；③ 缓存同实例；④ 真上游 5 个 mapping 密集端点 5/5，无未定义符号。

**这刀的对拍方法（值得复用）**：第 2 刀之前这些函数在 `qishui-api.js` 里是**模块内私有**的，`module.exports` 里根本没有（正是这一刀把它们变成可单独 require 的模块）→ 无法 `require(备份文件)` 取函数。解法是把两份源码各自包进 `new Function('require','module','exports','__dirname','__filename','__CAPTURE__', src + tail)` 执行，`tail` 用 `{ "名字": typeof 名字 === "undefined" ? undefined : 名字 }` 把**所有顶层词法名**（`function` 声明与 `const`/`let` 都算）抓出来。这样不仅能对拍 85 个声明，还完全不依赖导出面。

**闸门自证**（这条和第 1 刀同等重要）：写完先故意改坏，看它报不报。
- 第一次手写 fixture 时把 `svip` 从 `qishuiExplicitPositive` 的正名单删掉 → **冒烟全绿**（没覆盖到那个词），说明「手写样例」不足以守住白名单；
- 改成**词表驱动**：把这些函数正则里出现的词全部收进词池逐词跑，同一突变立刻报 `qishuiExplicitPositive("SVIP") true ≠ false`；
- 再改 `qishuiQualityRank` 的 hires 档 `110→105` → 报 5 条 `qishuiQualityRank("hires","flac",0) 110 ≠ 105`；
- 改常量 `QISHUI_TRACK_VIP_KEYS` → 报 Set 元素差异。
**「0 FAIL」必须先证明「不是永远 0 FAIL」。**

### 第 3 刀：qishui-api.js → 7 个业务领域模块（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `qishui-api.js` | 1901 行 | **132 行**（纯门面：7 个 require + 原样的 `module.exports`） |
| `server/qishui/account.js` | — | 163 行 / 4 声明（账号态：status、播放会员、会员缓存 TTL、曲库缓存失效） |
| `server/qishui/auth.js` | — | 344 行 / 12 声明（PC 扫码、OAuth 换 token、token 存取） |
| `server/qishui/library.js` | — | 581 行 / 9 声明（web 曲库、歌单曲目、用户歌单、首屏 feed） |
| `server/qishui/search.js` | — | 251 行 / 5 声明（公开搜索、PC 搜索、SEO 单曲） |
| `server/qishui/write.js` | — | 238 行 / 10 声明（喜欢、收藏、加歌、最近播放、评论） |
| `server/qishui/playback.js` | — | 385 行 / 12 声明（歌词、track_v2、player、下载信息、song-url） |
| `server/qishui/status.js` | — | 47 行 / 1 声明（`/api/qishui/status` 聚合响应） |

**依赖方向（DAG，脚本断言，不靠人看）**：

```
account  → （无）
auth     → account
library  → account
search   → account
write    → account, library
playback → account, search
status   → account, library
```

**`status.js` 只放一个函数的原因**：`handleQishuiStatus` 同时调 `getQishuiStatus()`（account）和 `fetchQishuiWebLibrary()`（library），留在 account 里会让 account ↔ library 成环 —— 这是整张图里唯一的环，`_qishui_rest_graph.js` 一跑就露出来了。

**门面必须保留原样的 `module.exports`**：拆分用「删声明 + 顶部加 require 解构」，导出表一个字没改（65 行），所以 `server.js` 的 `_lazyFn`、`desktop/`、`tests/`、harness 探针全部无感。**这也是最省事的等价性证明方式：导出表不动 → 导出面天然一致。**

#### 这一刀的两个真 bug（都被运行时抓到，静态全绿）

**① 生成器漏了「对象展开」的依赖边 —— 唯一一个会真正炸业务的**

`clearQishuiAccessToken` 里是：

```js
return { ...getQishuiStatus(), ok: true };
```

依赖检测的匹配式是 `(^|[^.\w$])名字\b`，而 `...` 以 `.` 结尾 → 名字前面是 `.` → **不被当成引用**。于是 `auth.js` 没有 `import getQishuiStatus`，`/api/qishui/logout` 直接 `ReferenceError: getQishuiStatus is not defined`。

这一刀当时的状态是：逐字 53/53 一致、导出面 27 键全等、纯函数差分 61 组全等、`node --check` 全过、`test:quick` ALL PASSED —— **只有真打端点才发现**。修法：先把 `...` 摊成空格再匹配（3 字符 → 3 空格，长度不变，切片下标仍对齐）。

**② 自由变量审计器有同一个盲区，所以「全仓库 0」曾经是假的**

`_audit_freevars.js` 的引用匹配式同样是 `(^|[^.\w$])`，`...foo()` 里的 `foo` **连捕获都捕获不到**，后面「是不是属性访问」的判断根本不可达 → 上面那个 `getQishuiStatus` 它报不出来。
摊平 `...` 还不够：摊平后「对象方法简写」规则（前面是 `{`/`,` 且后面紧跟 `(`）会把 `{ ...foo() }` 误判成 `foo() {` 的方法定义而排掉 —— 于是还要额外记住「这个名字原本前面是不是 `...`」，是就不许走方法简写分支。

**判据（这是本轮最重要的一条）**：任何「找未声明标识符」的工具，正例必须包含 `{ ...name() }` 与 `[...name]` 两种形态；负例必须包含 `obj.name()`、`obj?.name()`、`{ name: 1 }`、`{ name() {} }`、`get name() {}`。正负例都过才敢说「0 命中」。

#### 验证

- `_verify_qishui_split3.js` — ① 逐字：53/53 个声明跨 7 个模块与备份一致；② 覆盖唯一：每声明只出现一次、门面里不再定义它们（防「重复定义后者胜出」）；③ 导出面：27 键 + `_test` 13 子表 key/typeof/arity 全等；④ 门面结构：≤200 行、零函数定义；⑤ 依赖 DAG：无环且 account 无出边。
- `_smoke_qishui_split3.js` — ① 纯函数差分 11 个 / 61 组（按「哪个模块声明它」取新侧，不能一律从门面拿 —— 32 个名字按原样不对外导出）；② 2 个常量；③ 引用同一性：门面导出的 21 个名字与领域模块是**同一个对象**；④ `invalidateQishuiLibraryCaches` 清的是 http 层 3 个曲库缓存实例，且**不**波及会员缓存；⑤ **18 个汽水端点真打** 18/18。
- **既有失败要留证**：`/api/qishui/login/qrcode` 恒 500（`qishui-auth-v6.js:249` 读 `undefined.isReady`）。取证方式是把 `qishui-api.js` 换回 `_qishui_before_split3.js` 再打同一个端点，得到同一 status / 同一 message / 同一栈帧 → 与本轮无关。冒烟里写成「必须与基线签名**完全一致**才放行」的白名单，形状一变（换 message、换行号、变成 `is not defined`）照样 FAIL —— 不是把错误关键字整个豁免掉。

### 第 4 刀：kugou-api.js 第 1 刀 → `server/kugou/{config,http,mapping}.js`（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `kugou-api.js` | 2341 行 | **1420 行**（门面 + 尚未搬的 37 个业务声明） |
| `server/kugou/config.js` | — | 102 行 / 27 声明（appid / clientver / salt / RSA 公钥 / 各类 base url） |
| `server/kugou/http.js` | — | 528 行 / 38 声明（requestText 薄封装、签名、cookie 解析、网关参数、dfid 注册状态机） |
| `server/kugou/mapping.js` | — | 659 行 / 47 声明（搜索/歌单/歌词 payload → 内部结构，零 I/O） |

**依赖方向（DAG，脚本断言）**：

```
config  → （无）
mapping → （无）
http    → config, mapping
```

**这一刀能切干净的三个前提**：

1. **`requestText` 归 http**。它原本是 `kugou-api.js` 顶层 `require('./server/lib/http-request')` 拿的，是 config/mapping 之外唯一一个「外部 I/O 出口」。留在门面会让 `http.js` 反向依赖门面 → 环。列进 `EXTRA` 组搬走。
2. **cookie 解析归 http，不归 business**。`extractKugouAuth` 被 4 个网关函数 + 4 个设备注册函数调用，按「谁调它」直觉会放进 business —— 但 `buildKugouRequestCookie` / `buildKugouGatewayParams` 这些 http 层函数也要用它，于是 http ↔ business 成环。判据是「它读的是 cookie 字符串，产出的是身份四元组」→ 身份解析层，归 http。`kugouCookieUserId` / `kugouCookieNickname` / `kugouCookieHasLogin` / `kugouCookieHasPlayback` 四个同理一起搬。
3. **dfid 三件套（cache / pending / persistHook）只能有一份**。`var kugouDfidCache` 是可变的跨请求状态，如果门面和 http 各留一份就有两个缓存。`_verify_kugou_split1.js` E 段断言这三个名字**只在 `http.js` 出现**，业务侧只能走导出的 `getKugouDfid` / `setKugouDfidPersistHook`。

**切分依据不是靠读代码**，是 `_split_graph.js` 跑出来的：把剩余声明之间的真实边全画出来，按 `_kugou_groups.js` 分 4 组，然后算组间环 + 拓扑序。第一版分组把 `extractKugouAuth` 放在 business，脚本直接报 `http → business → http` 环；`parseKugouListId` 入边 3 出边 0，第一版漏在分组外。**这两个都是脚本发现的，不是看代码看出来的。**

#### 这一刀踩到的两件事

**① 文本守卫挂在门面上，跟 qishui 第 3 刀同一类**。`checkKugouCloudlistIdentityGuard()` 用 `fs.readFileSync('kugou-api.js')` 读单文件，断言 `const KUGOU_LITE_APPID = '3116'` 等 5 条身份常量还在里面 —— 常量搬进 `config.js` 后 `test:quick` 立刻红。修法与 qishui 那边一致：**按族读**（`kugou-api.js` + `server/kugou/*.js` 拼接，文件名排序固定拼接顺序）。守卫语义是「能力还在代码里」，不是「在第几行」。改完用「把 `3116` 改成 `3117`」突变自证它照样报，且报的是改后措辞。

**② 冒烟首版 4 处 FAIL，全是「内部现生成随机 mid」**。`buildKugouRequestCookie` 在 cookie 里没有 `kg_mid` 时调 `createKugouMid('mineradio')` 现算一个；`buildKugouGatewayParams` / `buildKugouH5Params` 在 `auth.mid` 缺失时同理。两侧各生成一个随机值 → 永远不等。

修法不是「把这几个函数从差分表里删掉」（那是把覆盖砍掉），而是分两层：

- **确定性路径进主表**：fixture 给足 `kg_mid` / `mid`，让它走「用给定值」的分支 → 直接比字符串。
- **随机路径单独一段 A2**：验证三件事 —— ① 生成的字段是 32 位小写 hex；② 两次调用不同（真的随机，不是写死）；③ 把该字段抠掉之后其余字段与备份逐项相等（证明只差随机那一处）。

同时 `buildKugouH5Params` / `buildKugouGatewayParams` 的 `clienttime` / `uuid` 取自当前时间，两次调用跨毫秒就假 FAIL → A 段临时冻结 `Date.now`，进 B 段（真端点）前还原。**不要靠往 `TS_KEYS` 里加 `clienttime` 混过去**，那等于把「时间字段不同」这个真差异一起豁免了。

#### 突变自证（三个闸门都证明拦得住）

| 闸门 | 突变 | 期望 | 实际 |
|---|---|---|---|
| A 段差分 | `sanitizeCookieValue` 的 `[\x20-\x7E]` → `[\x20-\x7D]` | 报 `~` 字符差异 | **第一次没报** —— 用例里没有 `~`。补 7 组（`~del~` / `听众` / `\t` / `\n` / `\x7F` / `\x00\x1F` / U+2E80）后报 `sanitizeCookieValue "~del~" ≠ "del"` |
| A2 段 | `createKugouMid` 删掉 `+ Math.random()` | 报「两次相同」 | 8 处 FAIL（1 + 3 + 2 + 2） |
| B 段 | `extractKugouAuth` 里插一句引用不存在的 `KUGOU_PROBE_MISSING_IMPORT` | 报未定义符号 | 4 个端点报 `is not defined`，B 段 11/15 |

第三个突变顺带暴露一件事实：**未登录态下 `login/status` / `user/playlists` / `playlist/tracks` / `song/url` 都在 `extractKugouAuth` 之前就 return 了**，所以它们抓不到这个符号错误 —— B 段的覆盖面依赖「有没有 cookie」。这条写在冒烟注释里，不要以为 15/15 就等于走过了全部鉴权路径。

#### 验证

- `_verify_kugou_split1.js` — ① 逐字：112/112 个声明跨 3 个模块与备份一致；② 覆盖唯一：门面里不再定义它们；③ 导出面：31 键 + `_test` 4 子表 key/typeof/arity 全等；④ 依赖 DAG：config / mapping 零出边、http 只依赖前两者；⑤ dfid 三件套只在 `http.js` 声明。
- `_smoke_kugou_split1.js` — ① 差分 54 个函数 / **587 组**（词表驱动 14 个归一函数）；② A2 随机兜底 4 项；③ 引用同一性：门面导出的 20 个名字与领域模块同一对象，另 92 个按原样不对外导出；④ **15 个酷狗端点真打** 15/15。
- `_split_graph.js` — 通用切分依据工具：`node _split_graph.js kugou-api.js --domains=_kugou_groups [--edges] [--why=X]`，输出依赖边、组间环、拓扑序。
- `_split_apply.js` — 通用按组搬迁工具（这次抽出来的复用件，qishui 那三刀是手写脚本）。
- `_split_lib.js` — `strip` / `parseDecls` / `uses` / `usesSelfTest`，`uses()` 自带正负例自证（正例含对象展开，负例含属性访问 / 可选链 / 前缀相同的另一个名字）。

### 第 5 刀：kugou-api.js 第 2 刀 → 6 个业务领域模块（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `kugou-api.js` | 1420 行（第 1 刀后） | **123 行**（纯门面：9 个 require + 原样的 `module.exports`） |
| `server/kugou/search.js` | — | 97 行 / 2 声明（关键词搜索） |
| `server/kugou/play.js` | — | 409 行 / 7 声明（取址四条通道 + 候选 hash + 播放态） |
| `server/kugou/lyric.js` | — | 123 行 / 5 声明（歌词搜索 / 候选 / 时长筛选 / 下载解密） |
| `server/kugou/account.js` | — | 331 行 / 6 声明（登录态 / 会员判定 / 资料 / 用户歌单列表） |
| `server/kugou/favorite.js` | — | 360 行 / 13 声明（收藏歌单 id / like fileid 记忆 / 喜欢检查·加歌·删歌·切换） |
| `server/kugou/recommend.js` | — | 178 行 / 4 声明（FM / 每日推荐 / 猜你喜欢） |

**依赖方向（DAG，脚本断言，无环）**：

```
config / mapping  → （无）        ← 第 1 刀
http              → config, mapping
search            → （无）
lyric             → （无）
account           → （无）
favorite          → （无）
play              → account
recommend         → account, favorite
```

四个「零出边」的组是刻意选的：`account`（会员判定）与 `favorite`（收藏/like fileid 记忆）是两个被复用的底座，`search` / `lyric` 本来就不该知道会员和收藏。整张图里唯一的两个跨组边都指向它们。

体积最均衡的一组是 `play`（409 行 / 最大 `handleKugouSongUrl` 155 行），`search` 只有 97 行 —— 但没有合并，因为它的语义边界（关键词 → 上游 → 前端结构）和 `play` 的（hash → 四条通道降级 → 可播地址）完全不同，合起来读反而更绕。

#### 这一刀踩到的四件事（全是 `_split_apply.js` 的通用缺陷）

前四刀都是手写抽取脚本，这一刀第一次用通用件 `_split_apply.js`，于是它的缺陷一次性全暴露了。**每一个都只有特定检查能抓到**：

**① 门面的 `preludeEnd` 判错 → `Identifier 'crypto' has already been declared`**

门面里的 require 从「单行」变成了「多行解构」（`const {\n KUGOU_SEARCH_URL,\n …\n} = require(…)`）。原来的判据是「第一个非 SKIP 声明之前找最后一个 require 行」，而 `parseDecls` 对 `const {` 这种开头给不出可信边界 —— `firstRealDecl.start` 落进解构块内部，`preludeEnd` 退到 `-1`，旧解构被留在 `keptBody` 里和新解构重复声明。

改成按**行形态**扫，不看声明边界：单行 require 与多行解构的收尾行 `} = require(…)`。

**② 门面的 require 只覆盖本轮组 → 113 个符号 ReferenceError**

导出表是全量列出的（31 个键，`_test` 里还有一堆），而 `needInFacade` 只从本轮的 `SET_OF`（37 个）里算 → 门面引用了 112 个第 1 刀搬走的符号却没 require 它们。`node -e "require('./kugou-api.js')"` 直接 `ReferenceError: kugouCookieObject is not defined`。

修法是在分组表里显式声明 `PRIOR`（组名 → 模块文件 → 名字清单），门面的 require 清单 = 本轮 + `PRIOR`。**不能自动从 `G.CONFIG/HTTP/MAPPING` 推**：`BUSINESS` 与它们长得一模一样（都是字符串数组），推错就会去 require 一个不存在的 `business.js`。

**③ 新模块没 import 底座符号 → 静态六段全绿、只有真端点炸**

`classify()` 只查本轮 37 个名字之间的依赖，完全没管 `config / http / mapping` 的符号。于是 `favorite.js` 不知道 `extractKugouAuth`、`lyric.js` 不知道 `requestJson`、`search.js` 不知道 `kugouSearchCache`。

当时的完整证据：`node --check` 全过、`_verify_kugou_split2.js` **A~F 六段全绿**（逐字 37/37、导出面 31 键、依赖 DAG、门面纯净、状态单份）、`Object.keys(require('./kugou-api.js'))` 31 键 —— 然后冒烟 B 段 10/15，日志里三行 `is not defined`。

这就是第 1 刀 `_audit_freevars.js` 那条教训的同一个形态：**「声明逐字一致」+「导出面一致」+「DAG 无环」三件事加起来，仍然不等于「模块能跑」**。

修法双管齐下：`classify()` 加一遍 `priorOwner` 检测；`_verify_kugou_split2.js` 加 G 段，**把 `_audit_freevars.js` 焊进 verify 就地跑** —— 事实是这个审计器当时就能报（把 `favorite.js` 的 `extractKugouAuth` import 删掉 → `!! server\kugou\favorite.js：1 个自由变量 / extractKugouAuth ×5 首处 行29`），只是我没在拆完后跑它。**闸门存在但没被执行，等于没有闸门。**

**④ 前置注释漂在门面里 → 40 行「像还有代码」的空注释**

`parseDecls` 的 `start` 是声明行本身，不含上方注释。37 个声明全搬走后，它们的文档注释还留在门面，压成一片空行。第一版门面 261 行里有 40 行是这种孤儿注释。

修法：`extStartOf(d)` 向上吸收连续的「注释 / 空行」，上界是上一个声明末尾与 `preludeEnd`；`movedLines` 改用吸收后的范围（不能再用 `d.start + slice.length`，那是旧起点推的）；`keptBody` 最后做一次连续空行压缩。改完门面 261 → 123 行。

#### 突变自证（四段都证明拦得住）

| 闸门 | 突变 | 实际 |
|---|---|---|
| A 段差分 | `filterKugouLyricCandidatesByDuration` 的 `20000` → `19000` | **第一次没报** —— fixture 里没有落在 19000~20000 之间的差值。补三组（差正好 20000）后报 2 处 `键 ["0","1"] ≠ ["0"]` |
| C 段引用同一 | 删掉 `favorite.js` 的 `handleKugouLikeToggle` 导出 | 报「favorite.handleKugouLikeToggle 模块没导出」 |
| D 段独立加载 | 同上 | 报「favorite.js 导出不全：缺 handleKugouLikeToggle」 |
| G 段自由变量 | 删掉 `favorite.js` 的 `extractKugouAuth` import | 报 `!! server\kugou\favorite.js：1 个自由变量` |
| B 段端点 | 不需要人造突变 | **③ 那个真 bug 就是它的自证** —— 三行 `is not defined`，B 段 10/15 |

#### 验证

- `_verify_kugou_split2.js` — A 逐字 37/37；B 覆盖唯一（37 个各一次、整个 `server/kugou/` 里各只定义一次、门面零定义、6 模块各自导出全量）；C 导出面 31 键 + `_test` 4 子表 typeof/arity；D 依赖（四个底座零出边、`play → account`、`recommend → account+favorite`、无环、不反向 require 门面）；E 门面（零函数、123 行、require 全相对、**require 的每个名字都真在对应模块导出里**）；F 跨模块状态（收藏缓存 / like fileid 记忆各只在 `favorite.js`）；G 自由变量。
- `_smoke_kugou_split2.js` — A 差分 6 个函数 / 27 组（含时长容差边界）；C 引用同一（门面 10 个 === 模块对象，27 个按原样不外导）；D 独立加载（清 `require.cache` 后逐个 require，导出齐全、无 undefined）；**B 15 个酷狗端点 15/15**。
- `_kugou_groups2.js` — 第 2 刀的单一事实源：6 组清单 + `PRIOR`（第 1 刀的 3 组 → 模块文件映射）+ 新门面注释。
- `_split_graph.js` 新增 `--sizes`（每组声明数 / 行数 / 最大声明）与 `G.MOVED` 支持（区分「上一刀已搬走」和「名字写错了」）。

### 第 6 刀：spotify-api.js → 4 个模块（2026-10-18）

| 项目 | 拆分前 | 拆分后 |
|---|---|---|
| `spotify-api.js` | 1530 行 / 84 声明 | **98 行**（纯门面：4 个 require + 原样的 `module.exports`） |
| `server/spotify/config.js` | — | 213 行 / 33 声明（端点常量 / 2 个 const Map / 文本工具 / 配置文件读写 / token 文件 I/O） |
| `server/spotify/http.js` | — | 466 行 / 28 声明（4 个 let 可变槽 / token 生命周期 / 请求封装 / 限流退避 / 重试 / 测试复位） |
| `server/spotify/mapping.js` | — | 120 行 / 6 声明（图片、曲目、歌单、资料、库 URI） |
| `server/spotify/business.js` | — | 620 行 / 17 声明（搜索 / 推荐 / 歌单 / 专辑 / 库操作 / 取址 / 歌词 / OAuth） |

**依赖方向（DAG，脚本断言，无环）**：

```
config  → （无）
http    → config
mapping → config
business → config, http, mapping
```

#### 三个只有这一刀才会遇到的判断

**① `spotifyUrl` 归 config，不归 http**。第一版把它放进 http，结果 `mapSpotifyTrack` / `mapSpotifyPlaylist` 用它 → `mapping → http` + `http → config` + `business → …`，虽然无环但语义是反的（映射层反过来依赖请求层）。它只是拼 `SPOTIFY_API_BASE + path + query` 的纯字符串函数，零出边，放 config 才对。

**② `__dirname` 必须换基准（本次搬迁唯一允许的替换）**。`DEFAULT_SPOTIFY_CONFIG_FILE` / `DEFAULT_SPOTIFY_TOKEN_FILE` / `spotifyConfigFileCandidates()` 里的 `path.join(__dirname, …)` 原来落在项目根，搬进 `server/spotify/` 后会整批改落到子目录 —— 用户的登录态「凭空消失」，而代码看起来完全正常（`fs.existsSync` 只是返回 false）。同一个失效模式 qishui 第 1 刀、server.js 第 9 块都踩过。做成可重放脚本 `_spotify_rebase_root.js`（幂等、断言「恰好 3 处」），verify H 段断言三个路径的 `dirname` 仍等于项目根。

**③ 4 个 `let` 槽必须和「所有写入者」同模块 —— 这一条是运行时炸出来的**。

`spotifyClientTokenCache` / `spotifyClientTokenRefreshPromise` / `spotifyUserTokenRefreshPromise` / `spotifyProfileCache` 都是 `let`，在 http 层被反复重新赋值（`spotifyUserTokenRefreshPromise = null`、`spotifyProfileCache = {...}`）。第一版按「配置/缓存」把它们全放进 config，于是：

```
TypeError: Assignment to constant variable.
  at refreshSpotifyUserToken (server/spotify/http.js:196)
```

因为 `const { spotifyUserTokenRefreshPromise } = require('./config')` 解构拿到的是**值**（`null`），不是绑定。静态六段（逐字 84/84、导出面 22 键、DAG 无环、门面纯净、自由变量 0）**全绿** —— `_audit_freevars.js` 也报不出来，因为它只查「未声明的标识符」，而这个标识符声明得好好的。

修法是按写入者重新归组：4 个 let 槽 + `readStoredSpotifyToken` / `saveSpotifyOAuthToken` / `clearSpotifyToken` / `getSpotifyConfig` / `resetSpotifyRuntimeStateForTests` 一起进 http。其中 `getSpotifyConfig` 必须跟着走，否则 `config → http`（它依赖 `readStoredSpotifyToken`）与 `http → config` 立刻成环 —— 第一次重排分组后 `_split_graph.js` 报的正是 `config → http → config`。

`spotifySearchCache` / `spotifySearchInflight` 留在 config，因为它们是 `const Map`，跨模块只调 `.set()` / `.clear()`，改的是内容不是绑定。

verify 为此加了两条通用断言：4 个 let 槽的位置 + **「任何 let/var 顶层状态不许在别的模块里被赋值」**（这条能直接拦截上面那个 TypeError 的形态，且不需要运行代码）。

#### 突变自证

| 闸门 | 突变 | 实际 |
|---|---|---|
| A 段差分 | —— | 84/84 逐字（其中 3 个按 `__dirname` ⇄ `PROJECT_ROOT` 归一化后相等） |
| B 段端点 | 删掉 `business.js` 的 `getSpotifyConfig` import | 7 个端点报 `getSpotifyConfig is not defined` |
| F 段可变绑定 | 在 `business.js` 放一个函数体 `spotifyProfileCache = null;` | 报「声明在 http.js，却在 business.js 里被赋值」 |
| H 段路径基准 | `PROJECT_ROOT = path.resolve(__dirname)` | 报 3 处「落在 server\spotify，应该是项目根」 |

#### 既有 500（与本轮无关，按签名匹配放行）

`album/detail` → 500 `SPOTIFY_CREDENTIALS_REQUIRED`；`song/like/check` 与 `album/like/check` → 500 `SPOTIFY_REFRESH_TOKEN_MISSING`。取证方式：把 `spotify-api.js` 换回 `_spotify_before_split1.js` 跑同一批端点，status / error 码 / message 三者完全一致。冒烟里连同「状态码 + error 码」一起写进白名单，形状一变照样 FAIL；并加了反向提示：白名单里的端点若不再 500，说明被修好了，该删白名单。

#### 验证

- `_verify_spotify_split.js` — A 逐字 84/84（+ 3 处基准替换归一化）；B 覆盖唯一；C 导出面 22 键 + `_test` 11 子表；D 依赖（config 零出边 / http → config / mapping → config / business → 三者 / 无环 / 不反向 require 门面）；E 门面 98 行零函数 + require 名字全在模块导出里；F 可变状态归属 + 跨模块赋值；G 自由变量；H 路径基准。
- `_smoke_spotify_split.js` — A 差分 17 个函数 / **124 组**（词表驱动 4 个归一函数）；C 引用同一（门面 21 个 === 模块对象，63 个按原样不外导）；D 独立加载；**B 17 个端点 17/17**（其中 3 个是上述已知 500）。
- `_spotify_groups.js` — 单一事实源：`CONFIG`(33) / `HTTP`(28) / `MAPPING`(6) / `BUSINESS`(17)。
- `_spotify_rebase_root.js` — `__dirname` → `PROJECT_ROOT` 的可重放替换（幂等、断言 3 处）。

## 自由变量审计：一次挖出 4 个静默 bug

拆分做对了「文本一致」，不代表「符号有来源」。`_audit_freevars.js` 就是补这个缺口：
**引用但从未声明、也不是全局内建的标识符**。

`_audit_orphans.js` 只抓全大写常量（`APP_VERSION` / `SCENE_RADIO_*` 那种），**驼峰是它的盲区** ——
而 `https` / `once` / `playlist_detail` 恰好全是驼峰。

### 它挖出来的 4 个 bug

| 文件 | 符号 | 归属 | 为什么一直没被发现 |
|---|---|---|---|
| `server/lib/weather-radio.js` | `playlist_detail` / `playlist_track_all` | **第 1 块造成** | deps 传的是驼峰 `playlistDetail`，函数体用下划线原名 → 只解构驼峰没起别名。两处都在 `typeof x === 'function'` 守卫里，**`typeof` 对未声明变量返回 `'undefined'` 而不抛错** → 两条「播客歌单兜底取曲」分支从第 1 块起就没执行过 |
| `server/lib/update-service.js` | `once` / `fileURLToPath` | **第 2 块造成** | 原文件顶层 `const { once } = require('events')` / `{ fileURLToPath } = require('url')` 没跟着进工厂。`await once(writer,'drain')` 只在背压时走、`fileURLToPath` 只在 `file:` 清单时走 |
| `kugou-api.js` | `KUGOU_VIP_ROLEINFO_URL` | **既有**（v3.1.0 起就带着） | 全仓库只有 1 处引用、0 处声明。调用点是 `await fetchKugouWebVipInfo(...).catch(() => kugouUnknownWebMembershipPayload())` —— **`.catch` 把 ReferenceError 吞了**，于是网页端 roleinfo 这个「unionVip 漏判时的补充源」从来没生效，会员判定永远停在「未知」 |

### 为什么之前的验证全没抓到

- **逐字对拍**只证明「文本一样」，不看符号有没有来源（缺 require 的模块文本完全一致）；
- **冒烟**只走默认分支：`file:` 清单、背压 drain、`typeof` 守卫、`.catch` 兜底全都不触发；
- **`node --check`** 只管语法，自由变量是运行时错误；
- `typeof undeclared` 与 `.catch(() => fallback)` 这两条语言特性会把错误**变成静默降级**。

### 扫描器自己先要证明不误报

第一版报 92 + 16 + 9 个，全是噪音。逐个修掉 7 类漏收/误判：
1. **不剥正则字面量** → `/sid_guard=([^;]+)/` 里的内容全被当标识符（`sid_guard`、`uid_tt_ss`…）。判据：`/` 前一个有意义的字符是运算符/开括号/行首（或 `return`/`typeof`/`case`… 之后）才是正则起始；
2. **`return` 后带空格**时 `prevWord` 匹配不上（`/\b(return)\s*$/` 要先把尾部空白去掉）—— 于是 `return /re/` 里的正则没被剥；
3. **模板串 `${...}` 没递归剥** → `${typeof x === 'object'}` 里的字符串被当标识符；
4. **对象方法简写** `clear() {}` / `get FAKE() {}` 被当引用；
5. **数组解构** `const [a, b] =` / `for (const [k, v] of ...)` 没收集；
6. **逗号分隔多变量** `const g1 = ..., g2 = ...` 只收了第一个；
7. **三元表达式的冒号** `cond ? https : fs` 里的 `https` 被当成对象键排掉 —— **这条最要命**：它恰好会漏掉「未声明模块出现在三元里」这个真实形态（第 1 刀那个 bug 就是这个形状）。

**修完必须用合成用例证明它拦得住**：一个文件里同时放「模板串里的 `APP_VERSION`」「三元里的裸 `https`」和 6 个干扰项（字符串、正则、方法简写、getter、对象键、嵌套箭头参数、for-of），跑出来只报前两个。
**「0 命中」必须先证明不是「永远 0 命中」。**

### 修复后

全仓库（`server.js` + `server/**/*.js` + 4 个插件）自由变量 **0 处**。
`server/lib/weather-radio.js` 的两条兜底分支补别名后实测能执行：
`fetchWeatherPlaylistSongs({id:'pl1'})` → `[{id:1,name:'S'}]`（走 `playlist_track_all`）。
`kugou-api.js` 的常量补为 `https://vip.kugou.com/recharge/roleinfo`
（依据：本文件 213 行注释 + `tests/provider-entitlement-boundary.test.js:71` 的 pathname 断言）。

## 做法（每块都照这个流程）
1. `cp server.js _server_before_<块名>.js` 留原始副本（`_*.js` 已被 gitignore）。
2. 用一个一次性脚本按**行号切片**搬代码，脚本同时算出「块内声明 / 块外依赖」，避免手抄漏改。
3. 新模块用工厂函数 + 依赖注入，**不 require server.js**（防循环依赖）。
4. 在 server.js 原位置换成 `const { … } = require('./server/lib/xxx')({ … })`，名字与原来逐一对齐。
5. `node --check` 两个文件。
6. **等价性对拍**：给备份文件追加 `module.exports.__probe = { … }` 拿到旧函数，与新模块喂同一套确定性输入，逐项比对输出（剥离 `Date.now()` 类字段）。示例：`_verify_weather_split.js`，19 组用例覆盖 103 个天气码 / 24 组心情 / 9 组选歌路径。
7. **运行时冒烟**：真起 server（`MINERADIO_API_TOKEN` 固定、`PORT` 换端口），打该领域的真实端点，确认没有 `ReferenceError` / 未定义符号——语法检查抓不到这类问题。示例：`_smoke_weather_split.js` 3/3。
8. `node scripts/sync-dist-app.js`（`server/**/*` 已在 `build.files` 与同步白名单里，新增文件不需要改配置）。

## 剩余候选

**本表已清空**——9 块拆完后，`server.js` 从 6729 行降到 1987 行，剩下的部分是聚合层本身：

| server.js 内位置 | 内容 | 为什么不拆 |
|---|---|---|
| 1–~250 | require / 常量 / `_lazyFn` 插件代理 / cookie getter / 各模块注入区 | 注入区就是「谁依赖谁」的可读文档，拆走反而更难追 |
| ~250–~1900 | 搜索与发现 / 取址 / 登录态 / 工具映射 | 每块 <500 行且互相咬合（跨域调用密度高），强行切会造出双向依赖 |
| ~1900–1987 | `routeCtx` + `routeMatchers` + 导出面 | 聚合清单，见第 9 块说明 |

> 真要继续压行数，方向不是「再切领域」，而是**把 9 个 `server/routes/*.js` 从 `ctx` 解构改成按需取**——但那是改设计，不是搬家，收益和风险都要重算。

另外两个独立巨石（`qishui-api.js` 146KB / `kugou-api.js` 97KB）是**单文件内部的协议分层**问题，做法不同：按「签名与设备 / 请求封装 / 资源映射 / 业务编排」四层切，切完各自的导出面保持不变。

三块全部完成：qishui 三刀 → 132 行 / kugou 两刀 → 123 行 / spotify 一刀 → 98 行。原始诉求点名的四个巨石（server.js + 三个插件）到此清空。

## 验证脚本（根目录，`_*.js` 已被 gitignore）

- `_verify_weather_split.js` — 新旧实现对拍（`capture-old` 采集 + `compare` 比对），19 组用例
- `_smoke_weather_split.js` — 起服务打真实端点，3/3
- `_verify_update_split.js` — 46 个函数 / 38 组用例对拍 + beatmap 往返 / 损坏自愈
- `_smoke_update_split.js` — 更新域 8 个端点真打，8/8
- `_verify_kugou_split.js` — 31 个函数 / 21 组用例对拍（新模块的注入依赖全部取自同一份旧备份）
- `_smoke_kugou_split.js` — 酷狗域 6 个端点真打，6/6（含未定义符号日志扫描）
- `_cmp_kugou_net.js` — 网络取址路径的新旧定向对比（同一 hash 比结果形状）
- `_verify_netease_split.js` — 14 个函数 / 纯函数 14 组 + 异步 5 组对拍（劫持 `NeteaseCloudMusicApi` 换桩，上游也可对拍）
- `_smoke_netease_split.js` — 网易域 5 个端点真打，5/5（含 `skipDirect=1` 强制同曲匹配）
- `_verify_scene_split.js` — 12 个函数 / 纯函数 9 组 + 异步 5 组对拍（基准取 `_server_before_batch4.js`，见第 5 块说明）
- `_smoke_scene_split.js` — 场景 + 天气域 6 个端点真打，6/6（含 `/api/scene/radio` 回归闸门）
- `_verify_media_split.js` — 20 个函数 + 5 个常量**逐字搬移证明** + 行为对拍 127 项 0 差异
- `_smoke_media_split.js` — 媒体代理/鉴权 14 个端点真打，14/14（全部不依赖上游网络）
- `_verify_podcast_split.js` — 7 个函数对拍 94 项 0 差异（`fetchMyPodcastItems` 的 5 条上游分支靠劫持 `NeteaseCloudMusicApi` 换桩）
- `_smoke_podcast_split.js` — 播客域 5 个端点真打，5/5
- `_verify_qq_split.js` — 35 个函数 + 5 个常量**逐字搬移证明** + 行为对拍 105 项 0 差异（`qq-vip-api` 与 `requestText` 双换桩）
- `_smoke_qq_split.js` — QQ 域 12 个端点真打，12/12（搜索/歌词/评论/艺人详情都是真上游数据）
- `_verify_http_split.js` — 3 段逐字一致 + **routeCtx 完整性**（9 个路由模块的每个 ctx 需求 vs server.js 本地声明，双向 146 键）
- `_smoke_http_split.js` — HTTP 分发 44/44 两层（工厂直测分支 + 真服务端点）
- `_verify_update_candidates.js` — `fetchTextFromCandidates` 归位后 6/6（失败码累积 / 首候选成功 / UA 带 APP_VERSION / 非 2xx 归类）
- `_verify_qishui_split1.js` — 插件族第 1 刀：逐字 34/34 + 48/48、导出面 27 键、`_test` 17 组、位置敏感（token 路径仍在项目根）
- `_smoke_qishui_split1.js` — 第 1 刀 10/10，含**真打上游** `/api/qishui/search`（`requestText` 通了的唯一硬证据）
- `_verify_qishui_split2.js` — 第 2 刀：逐字 85/85、导出面、`_test` 17 组、跨模块缓存同实例（探针包 `set`）、`clearQishuiRuntimeCaches` 源码对照
- `_smoke_qishui_split2.js` — 第 2 刀差分对拍 **48 个函数 / 776 组** + 6 个常量 + 真上游 5/5。**词表驱动用例**，用来兜住「正则白名单里的某个词被改动」
- `_verify_qishui_split3.js` — 第 3 刀：逐字 53/53、覆盖唯一（门面不再定义）、导出面 27 键、门面 ≤200 行零函数、依赖 DAG 无环
- `_smoke_qishui_split3.js` — 第 3 刀：纯函数差分 11/61 组 + 引用同一性 + 缓存失效边界 + **18 个汽水端点 18/18**（含一条与基线签名严格匹配的既有失败白名单）
- `_qishui_rest_graph.js` — 第 3 刀的切分依据：剩余 53 个声明之间的真实依赖边 + 「按领域分 7 组后组间有没有环」+ 拓扑序
- `_verify_kugou_split1.js` — 插件族 kugou 第 1 刀：逐字 112/112、覆盖唯一、导出面 31 键 + `_test` 4 子表、依赖 DAG（config/mapping 零出边）、dfid 三件套只在 `http.js`
- `_smoke_kugou_split1.js` — 第 1 刀：差分 54 个函数 / **587 组** + A2 随机兜底 4 项（32 位 hex / 两次不同 / 抠掉该字段后其余全等）+ 引用同一性 + **15 个酷狗端点 15/15**。A 段冻结 `Date.now`，进 B 段前还原
- `_kugou_groups.js` — kugou 的单一事实源：`CONFIG`(27) / `HTTP`(38) / `MAPPING`(47) / `BUSINESS`(37) + `EXTRA`（`requestText`）
- `_split_lib.js` — 插件族拆分通用件：`strip` / `parseDecls` / `uses` / `usesSelfTest`（`uses()` 自带正负例自证）
- `_split_graph.js` — 通用切分依据工具：`node _split_graph.js <file> --domains=_kugou_groups [--edges] [--why=X]`，输出依赖边 / 组间环 / 拓扑序
- `_split_apply.js` — 通用按组搬迁工具（qishui 三刀是手写脚本，kugou 起改为通用件）。第 2 刀暴露它 4 个缺陷：`preludeEnd` 对多行解构判错、门面 require 只覆盖本轮组、新模块不 import 底座符号、前置注释漂在门面里 —— 见「第 5 刀」章
- `_verify_kugou_split2.js` — kugou 第 2 刀：逐字 37/37、覆盖唯一、导出面 31 键 + `_test` 4 子表、依赖 DAG（4 个底座零出边 / play→account / recommend→account+favorite / 无环 / 不反向 require 门面）、门面 123 行零函数、跨模块状态单份、**G 段把 `_audit_freevars.js` 焊进来就地跑**
- `_smoke_kugou_split2.js` — 第 2 刀：差分 6 个函数 / 27 组（含时长容差边界 20000）、引用同一性、独立加载（清 cache 逐个 require，导出无 undefined）、**15 个酷狗端点 15/15**
- `_kugou_groups2.js` — 第 2 刀的分组表：6 组清单 + `PRIOR`（第 1 刀 3 组 → 模块文件映射）+ 新门面注释
- `_verify_spotify_split.js` — spotify：逐字 84/84（3 个按 `__dirname`⇄`PROJECT_ROOT` 归一化）、覆盖唯一、导出面 22 键 + `_test` 11 子表、依赖 DAG、门面 98 行零函数、**可变状态归属 + 跨模块赋值检查**、自由变量、**路径基准**
- `_smoke_spotify_split.js` — spotify：差分 17 个函数 / 124 组、引用同一性、独立加载、**17 个端点 17/17**（含 3 个按「状态码 + error 码」签名放行的既有 500）
- `_spotify_groups.js` — spotify 的单一事实源：`CONFIG`(33) / `HTTP`(28) / `MAPPING`(6) / `BUSINESS`(17)
- `_spotify_rebase_root.js` — `path.join(__dirname, …)` → `path.join(PROJECT_ROOT, …)` 的可重放替换（幂等 + 断言恰好 3 处）；重跑 `_split_apply.js` 之后必须跟跑
- `_audit_freevars.js` — 自由变量审计（全仓库扫描 `server.js` + `server/**/*.js` + 各插件），挖出 4 个静默 bug 后归零
- `_layer_analyze.js` — 顶层声明 → 依赖边 → 拓扑分层，定「按层切」的边界（**不要用括号配平**，见下）
- `_qishui_groups.js` — 单一事实源：`CONFIG`(34) / `HTTP`(48) / `MAPPING`(85) 三组清单，split 脚本与 verify 脚本共用
- `_split_qishui_1.js`、`_split_qishui_2.js` — 插件族一次性抽取脚本（带依赖方向断言 + `--dry`）
- `_proxy_redirect_verify.js` — SSRF 逐跳重定向闸门，6/6（**读 `server/lib/media-proxy.js`**，不再是 `server.js`）
- `_audio_hostguard_test.js` — 真 exe 走 `/api/audio` 白名单闸门，12/12
- `_audit_orphans.js` — 孤儿常量审计（找「被搬走但使用方还在原处」的跨文件 symbol）。**已重写**：旧版把 raw 源码丢给正则，注释里的大写词（`NOT` / `VIP` / `OPTIONS` / `TDZ`）全被当引用，90+ 行噪音把真命中埋了；现在先剥字符串（含模板表达式保留）再剥注释，并排除属性访问 / 对象键 / getter 键。可传文件列表，默认只查 `server.js`：
  ```
  node _audit_orphans.js                   # 跨文件孤儿（server.js 引用了已搬走的常量）
  node _audit_orphans.js server/lib/*.js   # 各模块内部
  ```
- `_split_weather_radio.js`、`_split_update.js`、`_split_kugou.js`、`_split_netease.js`、`_split_scene.js`、`_split_media.js`、`_split_podcast.js`、`_split_qq.js`、`_split_http.js` — 一次性抽取脚本（留档，说明这次搬了哪些行）

## 踩过的坑（对拍脚本侧）

- **状态容器不是函数**。`updateDownloadJobs` 是 `Map` 而非函数，混进「缺函数」检查会直接抛错。函数清单与状态导出要分开列，状态只校验类型与初始值。
- **跑两次必然不一致的量必须归一**。时间戳字段（`savedAt`/`updatedAt`/`at`）+ **临时目录名**（`os.tmpdir()` 每次 `mkdtemp` 都变）。只剥时间戳不够，路径里嵌的 tmp 名会让 `beatCacheRootInfo().dir` 恒判不等。
- **Buffer 过不了 JSON 往返**。golden 里存的是 `{"type":"Buffer","data":[…]}`，新实现直接返回真 Buffer；若中间有 `Object.entries` 重建对象的步骤，会退化成 `{"0":97,…}`。归一化要同时认 `Buffer.isBuffer` 与 JSON 化后的 `{type:'Buffer'}` 两种形态。
- **fire-and-forget 的副作用要轮询**。`readBeatMapCache` 命中损坏 JSON 时 `fs.promises.unlink(...).catch(()=>{})` 不等结果，紧跟其后 `existsSync` 断言会假失败。改成轮询最多 1s。
- **对拍基准要选「bug 之前的版本」，不是「上一块的快照」**。上一块若有跨文件 symbol 搬错，快照里就是坏的；拿它当基准会把 bug 固化成「等价」。判据：捕获阶段旧侧成片 `X is not defined` → 退回更早的备份（第 5 块从 `_server_before_scene_split.js` 退到 `_server_before_batch4.js`）。
- **注入点的位置 = 「所有导出符号的块外引用行号」的最小值之前**。物理上不连续的两段可以合到一个注入点，只要注入点在 min(引用) 之前；否则会出现在「模块 A 依赖模块 B，但 B 在文件里更靠后」的倒序问题。
- **函数体逐字对拍要按「各自的最小公共缩进」归一化**，不能固定 `replace(/^ {2}/)`——旧侧顶层函数体内还有二级缩进，新侧整体 +2 后逐行错位，会报一堆假 DIFF。写成「先算非空行的最小缩进，再统一砍掉」两边都能对齐。
- **从源码切片做验证的脚本会跟着搬家一起失效**。`_proxy_redirect_verify.js` 原来 `indexOf('const PROXY_MEDIA_HOST_SUFFIXES = [')` 找 `server.js`，搬进工厂后既换文件又多 2 空格缩进 → 必须改路径 + `replace(/^ {2}/gm,'')`。**这类脚本要在搬完的同一轮就改掉，否则下次有人跑它只会看到「marker not found」。**
- **`let` 改 getter 前先 grep 它在块内有没有赋值**。QQ 的 `qqCookie` 在 `refreshQQConfiguredCookieStore` 里有一处 `qqCookie = readCookieFile(...)`，纯 getter 替换会变成 `getQQCookie() = ...` → 运行时 `Invalid left-hand side in assignment`（`node --check` 完全看不出来）。有写入就必须同时给 `setXxx()`。
- **换桩要按「被 require 那个模块的真名」导出，不是 server.js 的别名**。`qq-vip-api` 导出 `normalizeQQVipPayload` / `qqVipObjectLooksExpired`，server.js 用 `_lazyFn` 起了 `...Strict` 的别名；桩按别名写 → 旧侧全 `getMod(...)[name] is not a function`，13 项假差异。
- **验证脚本自己的解析 bug 会冒充「拆分出错」，先验脚本再验代码**。`_verify_http_split.js` 报 `ai.js` 11 项 / `audio.js` 3 项 ctx 缺失，实际是 `/const\s*\{([\s\S]*?)\}\s*=\s*ctx/` 的**非贪婪从文件里更早的 `const {` 开始匹配**，一路吃到 register 顶部那个 `} = ctx`，把中间的 `const { apiKey, model } = cfg`、`const { enc } = res` 全算成 ctx 依赖。修法：先锚定 `module.exports = function register(ctx) {`，再从其后找第一个 `} = ctx`。**判据：报出来的名字里出现 `null` / 单字母 / 明显是局部变量的（`res` / `err` / `reason`）→ 先怀疑解析，不要改代码。**
- **逐字对拍要覆盖「注释边界」**。`shaderMarketCache` 的旧侧切片取到了它上面那行注释，而模块里注释措辞重写过 → 报 1 处假 FAIL。切片只取声明行，注释不进对拍范围。
- **审计工具本身要能证明拦得住**。`_audit_orphans.js` 重写后用一个合成用例验过：注释里的 `SCENE_RADIO_MAX_SONGS`、字符串里的 `SCENE_RADIO_PER_KEYWORD`、`get FAKE_GETTER()`、对象键 `ALSO_NOT:` 四个干扰项全部被排除，只报真孤儿 `SCENE_RADIO_CACHE_TTL_MS`。**「0 命中」必须先证明不是「永远 0 命中」。**
- **手写 fixture 守不住「正则白名单」**。`qishuiExplicitPositive` 的 `/^(…|vip|svip|premium|…)$/` 删掉 `svip` 后，手写用例（`true` / `1` / `'true'` / `false` / `null`）**全绿**。改成把正则里的词全部收进词池逐词跑才抓得住。凡是「白名单 / 就近词表 / 阈值」这类判定函数，用例要从实现里的词表生成，不能凭印象挑几个。
- **`Object.keys` 对 `Set` / `Map` 恒为空**。通用深度对拍把 `Set` 当普通对象走 → 两边都是 `[]` → 判「相等」。`QISHUI_TRACK_VIP_KEYS` 这类 `new Set([…])` 常量必须先按 `[...set]`/`[...map.entries()]` 展开再比。同理 `RegExp` 要比 `String(re)`（含 flags），`Date` 要比 `String()`。
- **时间戳字段要按白名单剔除，不能整树删**。`cachedAt` / `at` / `timestamp` 每次调用都不同，但只该跳这些 key；一刀切「跳过所有数字」会把真差异一起跳过。
- **模块内私有的函数不能靠 `require(备份)` 拿到**。插件族切出来的层在原文件里往往没有导出，`module.exports` 里查不到；用 `new Function(...)` 包住源码 + 尾部 `typeof` 守卫的对象字面量把顶层词法名抓出来，既不依赖导出面，也能同时覆盖 `function` 声明与 `const`/`let`。
- **`...name` 会被「属性访问」的排除规则吃掉，而排除规则是每一个这类工具的第一行**。`{ ...getQishuiStatus() }` 里名字前面是 `.` → 匹配式 `[^.\w$]` 直接不捕获；就算摊平 `...`，后面「对象方法简写 `name() {`」那条又会把它当方法定义排掉。**修法：摊平 `...`（长度不变，下标仍对齐）+ 单独记住「原本是不是展开」再跳过方法简写分支。** 第 3 刀因此漏了 `auth.js` 对 `getQishuiStatus` 的 import，静态全绿、只有 `/api/qishui/logout` 炸；审计器当初也没报，说明它的「0 命中」一直是含这个盲区的 0。
- **「生成 import 表」的检测器必须自带正负例自证**。正例：裸调用、括号内、箭头体、模板 `${}`、数组、**对象展开**；负例：属性访问、可选链、前缀相同的另一个名字。检测器过不了自证就不许往下生成代码 —— 这比事后再对拍便宜得多（对拍 100% 通过也发现不了「少 import 一个符号」这种形态）。
- **未处理的 promise 拒绝会把冒烟进程直接带走**。差分表里混进一个「名字像纯函数、实际会发请求」的函数（`qishuiResolvePcQrLoginCookie`）→ `new URL('[object Object]')` 抛在异步里 → 整个进程退出，后面的段一条结论都拿不到。加 `process.on('unhandledRejection')` 记 FAIL 继续跑，且拆纯函数前先看一眼函数体有没有 `requestText*`。
- **既有失败要按「签名完全一致」放行，不能按错误关键字整体豁免**。`/api/qishui/login/qrcode` 的 500（`qishui-auth-v6.js:249`）拆之前就存在，取证方式是换回备份 façade 打同一端点比对 status / message / 栈帧；白名单写成「500 + `QISHUI_QR_CREATE_FAILED` + `reading 'isReady'` + `qishui-auth-v6.js:249:14`」四条同时成立才 WARN，换行号或变成 `is not defined` 照样 FAIL。
- **`0 FAIL` 可能只是「用例集太窄」，不是「代码没问题」**。`sanitizeCookieValue` 把字符范围从 `\x7E` 收窄到 `\x7D`（`~` 变成非法）→ 580 组用例**全绿**，因为 fixture 里一个 `~` 都没有。凡是「按字符集 / 词表 / 阈值」判定的函数，fixture 必须覆盖边界字符本身：`~`(0x7E) / `\x7F` / `\t` / `\n` / `\x00` / 一个 CJK 字符。**突变没报，先怀疑用例，再怀疑代码。**
- **「内部现生成随机值」的函数不能整条从差分表删掉**。`buildKugouRequestCookie` 缺 `kg_mid` 时会 `createKugouMid()` 现算 → 两侧永不相等。删掉它等于把覆盖砍了。分两层：确定性路径（fixture 给足 mid）进主表比字符串；随机路径单独一段验「格式 + 两次不同 + 抠掉该字段后其余全等」——**证明只差随机那一处，比删掉更强**。
- **时间取值要冻结，不要塞进白名单**。`buildKugouH5Params` / `buildKugouGatewayParams` 的 `clienttime` / `uuid` 取自 `Date.now()`，跨毫秒就假 FAIL。把 `clienttime` 加进 `TS_KEYS` 等于把「时间字段不同」这个真差异一起豁免；正确做法是差分期间 `Date.now = () => 固定值`，进真端点段之前还原。
- **`let` 槽跨模块 = 运行时 `Assignment to constant variable`，而所有静态检查都是绿的**。`const { x } = require('./config')` 拿到的 `x` 是**值**不是绑定；`x = null` 立刻 TypeError。spotify 的 4 个 token/profile 槽这么炸过一次：逐字 84/84、导出面 22 键、DAG 无环、门面纯净、`_audit_freevars.js` 0（标识符声明得好好的，不在它的检查范围）。判据是**「谁写入谁持有」**：被重新赋值的状态必须和所有写入者同模块；跨模块只允许 `.set()`/`.clear()` 这种改内容的操作（`const Map` 可以留底座）。给 verify 加一条不跑代码就能判的断言：任何 `let`/`var` 顶层状态不许在别的模块里被赋值。
- **`__dirname` 是这个仓库最贵的坑，出现就要单独设一道闸门**。搬文件改 `__dirname` 的落点，后果是「用户的凭据/登录态凭空消失」而不是报错 —— `fs.existsSync` 只返回 false。踩过三次（qishui 第 1 刀、server.js 第 9 块、spotify）。做法：可重放替换脚本 + verify 里断言「路径常量的 dirname 等于搬之前的位置」，并做突变自证。
- **文本守卫要跟着拆分一起改，而且是「按族读」不是「改文件名」**。`checkKugouCloudlistIdentityGuard()` 读 `kugou-api.js` 单文件断言 5 条身份常量，常量搬进 `server/kugou/config.js` 后 `test:quick` 立刻红。改法是 `kugou-api.js` + `server/kugou/*.js` 拼接（文件名排序固定顺序），与 `readQishuiSources()` 同一套。改完要突变自证（`3116` → `3117` 必须照样报），否则不知道新守卫是不是永远空转。

## 收尾：把测试闸门改成按族读（2026-10-18）

### 先纠正一条错记

上一轮我把 24 个 `tests/` 的失败记成「6 个，全是既有失败」。用 `git HEAD` 建工作树取真基线后，结论是：

| | tests | pass | fail |
|---|---|---|---|
| HEAD（拆分前） | 97 | 81 | 16 |
| 当前（拆分后） | 97 | 81 | 16 |

**失败条数一致 ≠ 失败集合一致**。必须逐条比对 `not ok` 行（`comm -13 baseline.fails current.fails`），首版比对抓到 **9 条新增失败**：

| 测试文件 | 条数 | 真因 |
|---|---|---|
| `tests/kugou-cloudlist-identity-guard.test.js` | 8 | 读 `kugou-api.js` 单文件断言身份常量 / cloudlist 通道 / 设备注册函数体，第 1、2 刀把这些搬进 `server/kugou/{config,http,account}.js` |
| `tests/qq-vip-entitlement.test.js` | 1 | 读 `server.js` 单文件断言 `QQ_VKEY_REQUEST_TIMEOUT_MS = 6000` 等，第 8 块把 QQ 协议族搬进 `server/lib/qq-content.js` / `qq-session.js` |

两条都不是既有失败，是我自己造成的。

基线取法（可复跑，不要用「我记得」代替）：

```bash
git worktree add /d/Mineradio/_baseline-head HEAD --detach
cd /d/Mineradio/_baseline-head && node --test "tests/*.test.js"   # 97 / 81 / 16
git worktree remove /d/Mineradio/_baseline-head --force
```

`node --test tests/` 在 Node 22 上会把目录当模块解析（`Cannot find module .../tests`），必须用 glob `"tests/*.test.js"`。

### 改法：族读收口到 `scripts/quick-check/helpers.js`

原来只有 `readQishuiSources()`；这轮抽成通用的 `readPluginFamilySources()` 并补齐三族 + server.js 主体：

| 函数 | 组成 |
|---|---|
| `readQishuiSources()` | `qishui-api.js` + `server/qishui/*.js`（按名排序） |
| `readKugouSources()` | `kugou-api.js` + `server/kugou/*.js` |
| `readSpotifySources()` | `spotify-api.js` + `server/spotify/*.js` |
| `readServerEntrySources()` | `server.js` + `server/lib/*.js` |

**否定式断言不能跟着放宽，必须继续守单文件** —— 这是这轮最容易做错的一处：

- `kugou-cloudlist-identity-guard` 里 `assert.doesNotMatch(serverSource, /OIlwieks28dk2k092lksi2UIkp/)`（标准 android 盐）守的是「`server.js` 自己不许硬编码标准身份」。而标准盐**合法地**存在于 `server/kugou/config.js:40`（非 cloudlist 通道要用），按族读会把这条否定断言变成**恒假**。
- `qq-vip-entitlement` 里 `assert(!/member-track-playback/)` / `assert(!/vipEvidence:\s*playbackVipEvidence/)` 相反：全 `server/` 搜过都是 0 命中，语义是「服务端任何地方都不许有」，按族读才是正确且更强的。

判据：**肯定式断言按族读，否定式断言先 grep 确认族内无合法命中再决定范围**。

### 两处「符号搬家 + 使用点搬家」要分开读

- `kugou-cloudlist-identity-guard` 最后一条：`KUGOU_ID` 的 getter 定义留在 `server.js`（`assert.match(serverSource, /KUGOU_LITE_APPID/)` 仍成立），但 `KUGOU_ID.APPID` 之类的**使用点**搬进了 `server/lib/kugou-protocol.js` / `kugou-service.js` → 那条断言改用 `serverEntryFamilySource`。
- 距离型断言（`/membershipUnknown[\s\S]{0,500}vipSyncState:\s*authIncomplete/`）在拼接文本里仍然成立（两个符号都在 `server/lib/qq-session.js`，最近的一处 `membershipUnknown` 距 `vipSyncState: authIncomplete` 在 500 字符内）。这类断言改成族读前必须**实测一次**，不能假设。

### 跳过列表掩埋了一条真红

`checkQQVipStatusSyncGuard` 在 `scripts/quick-check/index.js` 的跳过列表里，注释只写「QQ VIP 状态同步」。它的 `serverText` 也是读 `server.js` 单文件 —— 第 8 块之后**它本身已经红了**，只是没人跑。

取证（不是推测）：把 `readServerEntrySources(appRoot)` 临时改回 `fs.readFileSync(server.js)` → 守卫立刻

```
RESULT: FAIL -> QQ login status must include an explicit forceable VIP probe instead of relying only on profile fields
```

改成族读后 `RESULT: PASS`，已从跳过列表解绑，`test:quick` 里能看到它真的执行（`== QQ VIP status refresh guard ==` + `[OK]`）。**`[SKIP]` 和 `[OK]` 在日志里长得一样地安静，但一个是没跑。**

### 突变自证

`.workbuddy/harness/mutate-family-guards.js`：6 个突变全部被拦下（备份 → 改一处 → 跑测试 → 校验首条错误 → 字节级还原）：

```
ok BLOCKED  QQ 预算常量 6000 → 7000（越过 15s 渲染超时）
ok BLOCKED  server/lib 里重新引入被禁的 member-track-playback 标记
ok BLOCKED  server/lib 里重新引入 vipEvidence: playbackVipEvidence 形态
ok BLOCKED  kugou lite appid 3116 → 3117（身份漂移）
ok BLOCKED  get_all_list 绕开 cloudlist 通道（追加一条网关直调）
ok BLOCKED  server.js 重新硬编码标准 android 盐（否定断言必须仍然拦）
```

最后一条是关键：它证明「否定式断言继续守单文件」这个决定仍然拦得住重新硬编码标准盐。

## 未处理的已知遗留

### `tests/` 剩下的 16 条失败：全部是 HEAD 基线就有的

以 `git HEAD` 工作树为准（同一条命令、同一批文件：`node --test "tests/*.test.js"`），**拆分前 16 条、拆分后同样 16 条、失败集合逐条一致（`comm -13` 为空）**。它们和本轮拆分无关：

| 测试文件 | 条数 | 现状 |
|---|---|---|
| `home-dashboard-update.test.js` | 6 | 读 `home` 发现条 / hero 视频链路，本版前端模块号不同 |
| `search-frontend-pagination.test.js` | 5 | 读 `legacy search histories migrate` 等前端实现 |
| `ui-default-theme-shelf-layer.test.js` | 3 | 读 `00-state/04-fx-defaults.js`（本版不存在） |
| `platform-account-sync-guard.test.js` | 1 | `ENOENT public/js/modules/05-playback/02-listen-stats.js` |
| `playback-audio-graph-recovery.test.js` | 1 | 缺 `replaceAudioElementForGraphRecovery` |

这些是「测试写死作者版前端路径」的既有债，不是服务端拆分引入的。要修得先决定是改测试还是补模块，属另一件事。

- ~~`server/lib/http-request.js`（3.5KB，带超时/退避重试的 `requestText`）全仓库无人 require~~ → **已更正**：它一直是 `kugou-api.js` 顶层 require 的，kugou 第 1 刀之后由 `server/kugou/http.js` require（`const { requestText } = require('../lib/http-request')`），不是无人使用的半成品。与 `fetch-utils.js` 的职责重叠仍然存在（一个给酷狗用，一个给其余域用），但两者都在跑，不构成噪音。
- ~~`tests/qishui-provider-distribution.test.js` 报 `openQishuiMusicLoginWindow` 不存在~~ → **已恢复**：当前 97 条测试里它是绿的，上面 16 条失败清单里没有它。之前那条记为「既有失败」是当时的旧状态。
- ~~`fetchTextFromCandidates` 在 `fetch-utils.js` 里缺 3 个依赖~~ → 第 9 块已归位到 `update-service.js`，`_verify_update_candidates.js` 6/6。
- **`_verify_scene_split.js` 的 golden 会随时间腐烂（已修）**：`sceneRadioBucket() = floor(now / SCENE_RADIO_ROTATE_MS)`，bucket 一变 `sceneRotateSeed → sceneShuffle` 的抽词就换一批，`seedQueries` 随之改变 → 同一份代码「capture 完当场全过、几小时后 3 处不一致」。修法是把 `Date.now` 在 capture 与 compare 两侧冻结到同一常量（`FROZEN_NOW = 1790000000000`）后重捕 golden。**这类「喂了真实时钟的 golden」在任何一个按时间轮换的实现上都会腐烂，看到零星字段差异先怀疑 bucket，不要先怀疑拆分。**
