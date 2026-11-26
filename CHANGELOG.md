# Changelog

## v3.3.5 · 2026-11-26

### Folia 面板模组

- 新增面板型模组宿主（`12-folia/18-folia-panel-host.js` + `desktop/folia-panel-host.js`），与歌词样式模组（`17`）是两条独立通道：面板模组提供一整个页面 + 主进程 RPC，歌词模组注册成世界样式卡。
- 首个接入模组为「听歌档案」（listening-archive v1.3.3，MIT）：注册标签页、命令与封面采集层，按秒采样播放状态并经 RPC 交主进程落盘。模组源码一行未改，缺失能力在宿主侧补齐或明确降级。
- 宿主按模组实际调用面实现（`host.folium` 版本门槛、`playback.getState` 返回 `state` 字符串而非布尔、`song` 走 `title/artist/album/source/id` 五字段、队列分页、`playback.*` 事件订阅），不是照文档抄。
- 面板外壳支持深/浅色：应用切浅色时宿主把 `isDaylight` 传给模组，模组自行切 `.daylight`。

### 液态面板动效

- FX 控制台改用液态展开/吸回动效（`09-fx-panel-genie.js`）：黏滞液滴从滑杆按钮拉出、目标沿三维空间翻折展开，收起 175ms 干脆吸回。
- 只接管「点滑杆按钮」这条路径，鼠标贴边 peek 仍走原来的轻量逻辑；面板原有的 `fx-panel-in` 与 `springUiOut` 在这条路径上跳过。

### 安全

- **出站 URL 防护（SSRF）**：LX 音源「从链接导入」此前只校验协议，任意内网地址都能被服务端请求，下载到的脚本随后进 vm 执行——构成 SSRF 到 RCE 的链路。新增 `server/lib/net-guard.js` 统一判定，只放行公网 http(s)。
- 补齐此前漏掉的网段：CGNAT `100.64/10`、`0.0.0.0/8`、组播/保留段、IPv6 映射地址；同时覆盖 `.localhost` / `.local` / `.internal` / `.lan` / `.home.arpa` / 反解域名等后缀。
- 媒体代理共用同一套 IP 判定，不再各自维护白名单。
- 已知边界：DNS 校验与实际连接是两次解析（TOCTOU），本层挡住的是「域名解析到内网」这类常规 SSRF；彻底解决需要在 socket 层锁定解析结果。

### 打包

- **正式构建开启 asar**（`build.asar: true`）：冷启动少开约 2700 个文件。
- `asarUnpack` 覆盖三类必须在真实路径上的资源：`native/**/*` 与 `**/*.node`（`process.dlopen` 需要真实路径，bindings 还会用 fs 扫目录）、`qishui-audio-decryptor/**/*`（worker_threads 用原生 fs 打开脚本，Node 没有 Electron 的 asar 补丁）、`public/folia-panel-mods/**/*`（面板模组需按目录扫描）。
- 热补丁在 asar 形态下改为 fail-closed，不再报 `ENOTDIR`；`sync-dist` 会清掉旧 `app.asar`，避免遮蔽新代码（否则表现为「改了完全没反应」）。

### 设置

- **更新偏好可配**：新增「设置 → 关于 → 更新」两个开关——是否检查更新、是否自动下载。此前是启动 9 秒后无条件查一次，用户既关不掉、也不能让新版本自动下好。
- **设置备份**：支持导出/导入设置。导出按白名单过滤，绝不带登录凭据（避免用户随手发出等于泄号）；导入同样走白名单，防止构造过的 JSON 往任意 localStorage 键写入。
- **界面缩放**：对应 Folia 的 `uiZoom`，用 `webContents.setZoomFactor` 实现，而不是给 body 加 CSS `zoom`——后者会同步缩小 CSS 视口（`innerWidth` 变小），导致绝对定位、媒体查询与画布尺寸全部错位。

### Home 动效

- 400ms Home 切换冷却改为可见动效：进入时天气/主视觉区与玻璃卡片分段飞入，动画时长对齐冷却窗口，不再表现为「点了没反应」。
- 新增减少动效（`prefers-reduced-motion`）统一开关。

### 其他

- 新增 20 个回归守卫与测试，覆盖 asar 打包、出站 URL、模块重名、歌词格式、更新偏好、界面缩放、设置备份、Home 动效、面板浅色主题、面板滚动联动等。
- 清理 6 个此前挂在 `KUGOU_SKIP_TESTS` 豁免名单里的失效测试（引用的模块路径在酷狗版拆分后已不存在）。

## v3.3.4 · 2026-11-23

### 悬浮小组件

- 新增独立桌面小组件窗口：透明、可拖动、可缩放，显示当前歌曲封面、标题、歌手与播放控制。入口在视觉控制台的「挂件」页。
- 小组件设置页内嵌在皮肤面板里，可调尺寸密度、显示项与液态玻璃风格；样式使用与主界面同一套玻璃语言（透明卡片 + 内描边 + 双层文字阴影保证可读性），不做 WebGL 折射——小组件是独立透明窗口，读不到桌面像素。
- 主窗口与小组件通过 IPC 双向同步：播放状态上行、操作指令下行，切歌与暂停即时反映。

### 设置页与皮肤中心

- **三条杠菜单改为只放开关与跳转**，参数集中到应用内「设置」覆盖层，分 7 个页签：常规 / 播放 / 音频 / 桌面歌词 / 性能 / 存储 / 关于。
- 搬过去的是同一批 DOM（id 与事件绑定不变），控件样式由 `#fx-panel` 扩展到 `:is(#fx-panel, #settings-modal)` 共享，没有第二套皮肤。
- **T 恤按钮改为整屏皮肤面板**：红心 / 收藏演出 / 桌面宠物 / 控制条频谱 / 挂件 / 玻璃六个页签。液态玻璃参数（作用于 Home 卡片、控制台与面板）在这里调整。
- 新增均衡器机架样式（`eq-rack.css`）。

### 启动速度

- **启动模块请求合并**：`index-loader` 原本要发 213 个模块请求，现在合并成 2 个批量接口（`POST /boot-modules`）。带路径白名单、token 门禁、ETag 与内存+磁盘两级缓存。
- **二维码库改为按需加载**：`qrcode` 会连带拉起 `pngjs` 渲染器，热态 require 就要 631ms（占服务端启动 1465ms 的四成），而它只在酷狗扫码登录时用。服务端同步 require 期间整个 Electron 主进程消息泵被堵住，表现为冷启动时窗口已显示但鼠标转圈。

### 缓存目录（续）

- **改缓存目录不再丢界面设置**：界面设置存在 Chromium profile 的 localStorage 里，换缓存根等于换空 profile（默认 profile 实测 111 个键）。跨 profile 复制 leveldb 实测无效——文件字节完全一致，Chromium 仍只读到新建的 11 个键。改为改目录时导出快照、下次启动由服务端注入 `index.html`、在模块读设置之前写回，写回成功后删除快照（一次性，不覆盖用户新改的值）。
- **改缓存目录不再丢登录**：cookie 用 `safeStorage` 加密，而 Windows 上 OS 加密密钥放在 profile 的 `Local State` 里。换 profile 就换密钥，旧 cookie 全部解不开（实测 `.kugou-cookie` 427 字节、解密后长度为 0）。现在改目录时一并快照 `Local State`，下次启动在 Chromium 打开新 profile 之前写回；目标 profile 已有 `Local State` 时不覆盖，避免让新凭据失效。

### 其他

- 服务端新增 `/floating-widget/` 前缀路由，只暴露 `desktop/floating-widget` 这一个目录，供小组件设置页以 iframe 内嵌。
- 新增 4 个测试：启动模块批量接口、玻璃背景缓存、运行时卡顿守卫、小组件宿主。

## v3.3.3 · 2026-11-21

### 流畅度

#### 启动

- **导航超时后不再重载已就绪的页面**：`loadURL` 的 promise 有概率在页面早已可交互后仍不落地，旧逻辑 15s 一到就整页换 `startupAttempt=2`，正在播放的音频会被打断。现在超时后先探测页面（URL 匹配 + 核心模块就绪），可用就跳过重载；探测只认 `__mineradioCoreModulesReady`，避免把静态空壳页误判成可用。

#### 歌词

- **暂停不再拆掉整轨**：暂停时只隐藏当前整轨（`stageLyrics.pauseHiddenTrack`），恢复播放不再重建 40+ 行歌词。实测恢复首帧 148.7ms → 24.0ms，暂停后几何/纹理/着色器程序全部保留。判据与「暂停保留歌词」同源（`audio.paused && !audio.ended && lyricsLines.length`），切歌/缓冲瞬间不会把正在显示的整轨藏掉；曲目结束仍按原逻辑释放。
- **歌词着色器常驻预热**：首帧放置两个不可见常驻 mesh，阻止整轨销毁后 program 被释放导致的重新编译（`GetProgramiv` 45–81ms）。
- 曲目结束后仍按原逻辑释放整轨，避免常驻内存。
- **起播不再把整首歌词挤进一帧**：同步建行原本用 `Infinity` 预算一次跑完，整首歌 60 行的字符遮罩画布（60 个 canvas / 24.5MB）全挤在同一帧，实测 103–273ms。现在给同步路径 6ms 预算，可见行当帧就位，其余行由既有分批任务补齐。改动前后各 5–6 次采样：最差帧中位 124.3→90.8ms，冻结总时长中位 424→285ms，>100ms 帧 9→1；首帧空白检查 0 次缺行。

### 壁纸模式：与桌面壁纸共生

- 新增独立桌面效果层窗口（`desktop/desktop-stage-window.js`）：透明、鼠标穿透、不抢焦点、跳过任务栏、常驻桌面底部。不改系统壁纸、不写注册表、不注入 WorkerW 壁纸宿主，与 Wallpaper Engine 等动态壁纸同时存在。
- 主窗口在壁纸模式下只做控制不渲染：渲染器缩至 4×4、摘除舞台层、用纯色补不透明底，避免两份渲染互相压帧；显示「歌词写真已投到桌面」提示。
- 舞台页复用 `applyPlaybackSession`，以静音二次解码镜像播放会话，歌词与粒子跟随当前歌曲推进。
- README 新增「壁纸模式」章节与展示图。

### 背景透出与玻璃折射

- **Folia 换了背景什么都没变**：镜台模式的 WebGL 画布一直用 `setClearColor(bg, 1)` 铺满不透明底，把下面那层共享背景（`.folia-bg-host`）整个盖住。现在清屏 alpha 恒为 0，黑底由 `#folia-world-root` 提供；背景选「无」时观感与之前一致。
- **设了静态背景图玻璃仍透黑**：玻璃折射的背景来自镜像画布，而合成清单只有底色 + 视频 + WebGL，从未包含用户设的静态壁纸图（`--custom-bg-image`）。现已补入，按 `cover` 对齐并套用透明度。
- **Wallpaper Engine 图片壁纸同样透黑**：此前只补了 WE 视频镜像，图片从未进合成。现在图片也画进镜像，并按 DWM 共存模式跳过；图片改用 CORS 模式加载（`crossOrigin=anonymous`），否则会污染镜像画布导致回读全黑。

### 缓存目录

- **改缓存目录重启后弹回原路径**：`cache-settings.json` 原来从 `app.getPath('userData')` 读写，而 `setPath('cache', X)` 会把 userData 篡改成 `X/<APP>`，于是配置被写进 Chromium 缓存目录、重启时在真实位置读不到。现在改用 `setPath` 之前捕获的稳定路径；旧位置残留的配置会一次性迁移回来。
- **改目录不再丢弃已有缓存**：节奏分析（重新分析耗时长）与歌词/译文（重新拉取要走网络）会自动搬到新目录；Chromium 缓存（封面/网络/音频分片）不搬，避免连带复制 200MB+ 垃圾。改目录后的提示会报出迁移数量。
- **改目录不再丢设置**：界面设置（桌面歌词字号/行数/动效、经典预设歌词布局、音量、首页网格等）都存在 Chromium profile 的 localStorage 里，换缓存根等于换一个空 profile（默认 profile 实测 111 个键），以前改完目录会全部回到默认。试过直接复制 profile 的 leveldb，实测无效（复制过去的 `000003.log` 与源文件字节完全一致、键名都在，Chromium 打开后只读到应用新建的键）；改为走渲染进程 API：改目录前把 localStorage 全量导出成快照 → 下次启动服务端返回 index.html 时注入 `__MINERADIO_SETTINGS_SNAPSHOT__` → head 内联脚本在任何模块读设置之前写回 → 写回成功后删除一次性快照。端到端实测：12 个键全部从旧目录带到全新空目录，`desktopLyricsSize/lines`、`classicLyricCurvature` 读回一致。新增 `checkCacheSettingsSnapshotGuard`（5 处注入回归全部可拦截）。
- **改目录不再丢登录**：cookie 用 safeStorage 加密，而 Windows 上那把 OS 密钥放在 Chromium profile 的 `Local State`（`os_crypt.encrypted_key`）里，换缓存根就换密钥——旧 cookie 文件还在却解不开，表现是「登录全没了」（实测：427 字节文件解密报 `Error while decrypting the ciphertext`）。现在改目录时把 `Local State` 一并快照，下次启动在 `setPath` 之前写进新 profile，新旧会话共用同一把密钥。若新 profile 已经有自己的 `Local State`（用户已在新目录登录），跳过覆盖、保留更新的那把。实测：新旧 profile 的 `Local State` SHA256 逐字节一致；保护分支日志为 `snapshot skipped: target profile already has one`。

### 视觉控制台

- **点按钮后面板自己滚回最顶**：面板里的列表是「清空再重建」的，重建瞬间内容高度归零，滚动容器被钳到顶部且不会自己回来。现在装了一个只兜「点击引起」的守护：记下点击前位置，双帧 + 320ms 各查一次；用户自己滚动（滚轮/拖动/触摸/键盘）或内容真的变短时不干预。

### 酷狗

- **SVIP 被误判为普通 VIP**：unionVip 的超级会员到期时间字段是 `su_vip_end_time`，归一化此前只认 `svip_` / `super_vip_` / `luxury_vip_` 前缀；同时 `kugouTimeState` 用 `Number()` 解析 `"YYYY-MM-DD HH:mm:ss"` 字符串得 `NaN` 被跳过。两处补齐后 `isSvip` 正确。
- **个人歌单 20017**：cloudlist 校验「请求身份 == token 签发身份」，此前扫码用 1001、换 token 用 1005、歌单请求用 3116，三方不一致。统一到 3116/11440，并保留 1005 自动回退。实测 3116 token 请求 `/v7/get_all_list` 返回 `status=1`。
- 升级后需要重新扫码登录一次，旧 token 不会自动迁移。

### Folia

- **打开播放器时 Folia 世界里没有歌词，切一下样式或世界就恢复**：模组只在挂载时读一次歌词（花笺的 `director.attach({lines})` 抓的是快照），而启动时世界比歌词先就绪；同时 `foliaWorldLines()` 每次重算都换新数组，模组手里的引用永远停在挂载那一刻。现在歌词表改为原地刷新的稳定数组并带版本号，模组驱动层按版本号通知变更；首次出现歌词时静默重建一次样式实例（旧帧垫底，不闪白）。
- **重启后花笺变回流光**：模组样式是异步注册的，读档时样式表还没就绪会被校正成默认值，紧接着的一次存档就把默认值永久写进存档。现在未知样式会先记为「待恢复」，模组就绪后切回来，确认已移除的才清除。

### 其他

- Folia 模组：移除 visualizer-jump，新增 huajian / miside-drop / visualizer52hz。
- 删除死代码 `09b-playback-core.js`、`05-prismal-fill.js`。
- 新增 12 个回归测试（壁纸舞台、桌面歌词、模组兼容、酷狗会员与登录身份等）。
- 新增 5 个静态守卫：`checkSmoothnessRegressionGuard`（启动导航 / 暂停保留整轨 / shader 预热 / 同步建行预算，9 处注入回归全部可拦截）、`checkFoliaBackgroundLayerGuard`、`checkLiquidGlassBackdropImageGuard`、`checkCacheSettingsStablePathGuard`、`checkCacheSettingsSnapshotGuard`（5 处注入回归全部可拦截）；另有 `tests/fx-panel-scroll-keeper.test.js`。

## v3.3.2 · 2026-11-16 重新构建批次

本次按发布要求**不升版本号**，资产替换了 2026-11-14 的构建；以 Release 正文首行的构建 commit 与 SHA256 为准。


### 两组帧率设置不再混在一起

- **现象**：视觉控制台里「桌面歌词帧率」（24/30/60/120/无上限）和「壁纸帧率」（24/30/60）两条选择条紧挨着，壁纸那条的标题没跟着显示，看起来像同一个设置的两行。
- **根因**：壁纸区的分组标题、帧率标题、选项条、透明度分别设 `hidden`，显隐不同步；另外 `05b-fx-panel-layout.js` 的 `setFxSectionBefore()` 用 `textContent` 整体重写标题，把运行时给桌面歌词帧率加的作用范围小字删掉了。
- **改法**：
  - 壁纸设置（分组标题 / 帧率标题 / 选项条 / 透明度）收进 `#wallpaper-settings-group` **一个容器**，`updateWallpaperPanelVisibility()` 只用一个 `hidden` 控制，不可能再出现「只露出选项条没有标题」。
  - 两组标题都写明作用范围：「桌面歌词帧率 · 只影响桌面歌词窗口」「壁纸帧率 · 只影响壁纸窗口，与桌面歌词无关」；壁纸区加 16px 顶部间距和分隔线。
  - `setFxSectionBefore()` / `setFxSectionBeforeNode()` 改用 `fxSetLabelTextKeepChildren()` 只替换直接文本节点，保留 `<small>` 说明，不再被布局阶段重写抹掉。
  - 档位与绑定完全不变（桌面 24/30/60/120/无上限、壁纸 24/30/60，id 与 `data-*` 原样）。
  - `fx-panel.css` 版本号 bump 到 `?v=3.0.2-fpsgroups`——这次也改了该 CSS，避免磁盘缓存让改动看起来无效。
- **验证**：Electron 真实页面确认两处作用范围小字都在、壁纸容器 `display:block`、顶部间距 16px 与分隔线存在、两组选项条都可见。新增 `tests/fx-fps-groups.test.js` 4 条守卫，均自证回退会判红。
- **回归**：150/150 测试、45/45 变异全判红（新增 M47：标题重写回退）；dist 的四个文件一致。

### LX 音源面板组件美化

- **问题**：面板里混着两个浏览器原生控件——系统蓝色方块复选框、以及「选择文件 / 未选择任何文件」的原生文件框，和深色玻璃面板完全不搭；导入区没有分组层次，安全说明裸贴在底部。
- **改动**（只改外观，交互语义一律不动：所有 id、`data-lx-act`、`accept` 限制、checkbox 的 `.checked` 读写都保持原样）：
  - **兜底开关**：`appearance:none` 改成 34×19 滑动轨道 + 白色滑块，选中态青蓝描边与微光；文案拆成主标题「音源兜底播放」和副标题「平台取不到直链时自动改用音源」，整行卡片可点，保留键盘焦点环。
  - **文件选择**：原生 input 用 `opacity:0` 隐藏但**保留可访问性**，由 `label for` 关联的自定义按钮（上传图标 + 「选择本地 .js」）承接点击；虚线容器里增加文件名回显，选中后文字变青蓝。JS 在 `change` 时更新文件名与 `is-picked` 标记。
  - **导入区**：独立分组卡片 + 标题/小字说明；输入框加 placeholder 弱化与聚焦光晕，导入按钮 hover 轻微上抬。
  - **说明卡**：改成琥珀色半透明提示卡，带信息图标，与「只导入你信任来源的脚本」的警示语义匹配。
  - **列表项**：当前启用的音源加左侧青蓝强调条。
- **验证**：Electron 加载真实页面并截取面板渲染图确认观感；交互实测——开关点击后 `checked` 翻转且 `localStorage` 写入 `'0'`、原生 file input 仍带 `accept` 且 `opacity:0`、用 `DataTransfer` 造一个 File 触发 `change` 后文件名回显为 `demo-source.js` 并带 `is-picked`。新增 2 条守卫（关键 id/动作不丢、原生控件确实被样式接管且文件名会回显），变异新增 M45（去掉 `label for` 即被抓）。
- **顺手堵住 CSS 缓存坑**：这次改的是 `css/index.css`，它原本也带固定版本号 `?v=3.0.0-modular`——上一轮 `fx-panel.css` 正是因此出现「改了没生效」。已 bump 成 `?v=3.0.1-lxui`，加静态守卫防止回退，并自证把版本号改回旧值会立刻判红。
- **回归**：146/146 测试、44/44 变异全判红（新增 M45 去掉 `label for`、M46 版本号回退）；dist 的 HTML / CSS / JS 三个文件一致。

### 视觉控制台开关不再跟着底部控制条动

- **现象**：底部控制条一升起，右下角那个打开视觉控制台的开关（`#fx-fab`）连同旁边的自动隐藏箭头（`#fx-fab-hide-btn`）一起往上跳。
- **根因**：`public/css/07-fx/fx-panel.css` 里有一组跟随 `body.controls-visible` 的规则，把开关从 `bottom:24px` 抬到 `126px`（短高屏 `22px → 112px`），箭头从 `37px` 抬到 `139px`（短高屏 `35px → 125px`）。控制条的 `visible` 状态由 `04-bottom-controls-cursor.js` 的 `updateControlsChromeState()` 转成这个 body 类，所以联动是纯 CSS 造成的，没有 JS 参与。
- **修法**：四条抬升规则全部写回各自的基准值（24/37，短高屏 22/35）。**保留原来的高特异性选择器**而不是直接删规则，这样以后有人在别处又加抬升规则，这组后面的同特异性规则仍能压住它。
- **不会被控制条挡住**：控制条 `z-index:6`，开关是 `19`。Electron 实测窄视口（886px 宽，两者矩形确实重叠）时，开关中心点仍命中自身，可正常点击；宽视口下两者根本不重叠。
- **验证**：Electron 加载真实页面，两种视口（1266x798 / 886x698）× 两种 body 状态（默认 / `desktop-shell diy-mode`），共四组，控制条升起前后开关与箭头的 `bottom` 计算值、矩形底边、两者间距**完全一致**；且升起时中心点命中开关。另加 `tests/fx-fab-anchor.test.js` 3 条守卫：基础值、全仓 CSS 扫描「controls-visible 下不许出现抬升值」、不许有 JS 绕过 CSS 直接改 `style.bottom`。已自证：把值改回 126px → 守卫立刻判红，还原 → 绿。
- **回归**：143/143 测试、42/42 变异全判红（M43 抬升值回退、M44 去掉 inline 锁定都被抓）；dist 的 HTML 与 CSS 均一致。
- **二次反馈「怎么还是一样」——真正原因是 CSS 磁盘缓存**：`index.html` 里 `fx-panel.css` 的链接带**固定版本号** `?v=3.0.0-modular`，文件内容改了但 URL 没变，窗口重新打开时 Chromium 直接命中磁盘缓存里的旧 CSS（`bottom:126px`），旧行为原样保留。前几轮改的是 JS/HTML，这次只动 CSS，正好踩中。核查过：仓库 `public/css` 与 `dist/.../public/css` 全量 diff 一致、全仓只有一份 `Mineradio.exe`、dist 里 fab 的 bottom 只有 24/37/22/35，代码侧没有残留。
- **三层防线**：
  - `index.html` 给 `#fx-fab` / `#fx-fab-hide-btn` 加 inline `style="bottom:24px"` / `37px`。inline 优先级高于普通 CSS 规则，**即使浏览器仍加载缓存里的旧 CSS，抬升规则也压不动它**。
  - `fx-panel.css` 的四条固定规则加 `!important`，压过任何后来加载或更高特异性的抬升规则。
  - CSS 版本号 bump 成 `?v=3.0.1-fabanchor`，重启后强制重新拉取，绕开磁盘缓存。
- **端到端补测「旧缓存」场景**：在真实页面里注入一遍旧的抬升 CSS（126/139/112/125px）再模拟控制条升起——两种视口 × 三种场景（默认 / `desktop-shell diy-mode` / 旧 CSS 缓存）共六组，开关与箭头的 `bottom` 计算值、矩形底边、间距全部不变，升起时中心点仍命中开关。守卫扩到 4 条，新增「CSS 缓存防线」断言（inline 锁定、版本号 bump、`!important` 齐全）。


### 洛雪音乐（LX）源脚本接入

**这不是「新增一个音乐平台」，而是内嵌一个 LX 兼容源脚本运行时。** 立项前先把两条路都查清了：

- **LX 官方 Open API 拿不到音频**：`https://lxmusic.toside.cn/desktop/open-api` 从 v2.7.0 起提供 `/status`（状态/歌名/歌手/进度/封面/歌词行）、`/lyric`、`/lyric-all`、SSE 订阅，以及 `/play` `/pause` `/skip-next` `/seek` `/volume` `/mute` `/collect` 等控制端点——**没有任何取音频地址的接口**。它只能「遥控 LX 客户端」，不能给 Mineradio 供歌。
- **真正的音源能力只在源脚本里**：LX 的「自定义源脚本」（`custom-source`）是一段 JS，通过 `on('request', …)` 响应 `musicUrl` / `lyric` / `pic`。要拿到歌就必须把这类脚本跑起来。

### 做了什么

- **`server/lx/source-host.js`**（1252 行，源自参考实现 ww085213/Mineradio-LX-Music，GPL-3.0 同协议）：`vm` 沙箱 + `globalThis.lx` 兼容层（`EVENT_NAMES` / `request` / `on` / `send` / `utils.crypto` / `utils.buffer` / `utils.zlib`），含多音源顺序尝试、音质降级链、URL 可用性探测、超时与缓存、gzip 解码、header 过滤。另做了两处适配：目录可用 `MINERADIO_LX_SOURCE_DIR` 覆盖（探针/测试隔离）；告警走项目统一日志。
- **`server/routes/lx.js`**：`status / import（脚本或直链）/ select / enable / check / delete / resolve / lyric` 八个端点。错误码统一翻成中文（如 `LX_SOURCE_AT_LEAST_ONE_ENABLED` → 「不能停用最后一个启用的音源」），不把 `LX_SOURCE_*` 直接糊给用户。
- **`server/lib/proxy-headers.js` + `/api/audio?h=`**：音源返回的地址常带防盗链，需要补 Referer/UA 才能取流。代理**只接受 referer / origin / user-agent 三个头**，值 ≤512 字符且拒 CRLF（防 header 注入）——不放行 Cookie/Authorization，避免把凭据交给脚本。
- **顶栏「音源」弹层**（`22-lx-source.js`）：导入（直链/本地 .js）、启用/停用、切换当前音源、自检（真正初始化脚本并报出它支持哪些平台）、删除、状态提示。入口是顶栏音符按钮，与「皮肤」「播放选项」互斥打开。

### 续：歌词兜底 + 汽水死链路收口

- **LX 兜底播放的歌现在有歌词了**：`/api/lx-source/lyric` 之前只有后端、前端没接。现在歌词管道在「平台返回空词」时用同一份 `musicInfo` 再取一次（`lyricResponseHasContent` 判定，至少 20 字符才算有词）。只交出行级 LRC 与翻译——LX 的 `lxlyric` 是逐字格式，现有管道解析不了，没有硬塞进 `lyric` 字段冒充行级词。
- **汽水未启用的扫码/OAuth 链路已整条删除**（`server/qishui/auth.js` 347 → 47 行）：逐个函数核对调用者，`createQishuiPcQrLogin` / `checkQishuiPcQrLogin` / `exchangeQishuiOAuthCode` 只出现在 `qishui-api.js` 的再导出里、零真实调用，同批 7 个辅助函数也是零引用。这条链路正是把 `error_code 7` 当 `'wait'` 的那条，删掉后不再和路由的中性 `upstream_code_7` 两套语义并存。活着的 `saveQishuiAccessToken` / `clearQishuiAccessToken` 保留（`routes/qishui.js` 在用），服务端实测 `/api/qishui/status`、`/api/qishui/login/check` 均正常。
- **技术债登记表 open 从 3 降到 2**：`qishui-auth-legacy-7` 标 closed，证据改成「`auth.js` 不含 `error_code === 7`」+「`qishui-api.js` 不再导出那三个函数」，`mustNotContain` 断言能抓住「收口后又被改回去」。

- **取址阶段就预检代理白名单**：`/api/audio` 只代理白名单内的 CDN（`PROXY_MEDIA_HOST_SUFFIXES` 已覆盖网易云/QQ/酷狗/腾讯云/CDN 等主流域名）。但音源脚本返回的域名未必在里面——之前要等播放器报 `MEDIA_ERR_SRC_NOT_SUPPORTED`，用户只看到「播放失败」。现在取址时就检查，返回 `LX_SOURCE_HOST_NOT_PROXYABLE` 并写明「哪个域名 + 要加进哪个常量」。
  - 实测：脚本返回 `download.samplelib.com` 的公开测试音频 → 取址直接 422 + 明确原因，不再拖到播放失败。
  - 没有放宽白名单：主机后缀是纵深防御，真正拦 SSRF 的是 DNS 解析后的 IP 黑名单；为第三方脚本放宽主机层，等于把本机代理变成任意公网转发器。

- **入口位置：歌单面板新增第四个页签「LX 音源」**（当前队列 / 我的歌单 / 我的播客 / LX 音源）。
  - 顶栏不再有独立音符按钮：用户明确不要在那里新增图标。
  - **「我的播客」保留**：它是有实现的功能。最初按「如果没用就换掉」去改，但核查发现播客列表/播放链路是完整的，条件不成立就不该动，已恢复。
  - 面板宽 340~364px，四个页签放得下；给 `.panel-tabs` 加了 `flex-wrap` 兜底，窄屏换行而不是溢出。
  - 页签切换互斥（同时只有一个 pane 可见），切到 LX 时自动拉一次状态，不会看到上次的旧列表。
  - 原来那个独立弹层（`#lx-source-popover`）连同顶栏按钮一起删除，内容整体搬进 pane，DOM id 不变。

### 边界（必须说清，不要误解成「已经能放 LX 的歌了」）

- **不内置任何音源脚本**。与 LX 官方和参考实现一致：脚本由用户自行导入，版权与合规责任归导入者。测试只用一段**合成脚本**（只声明能力、返回固定字符串），不联网、不含任何真实平台地址。
- **沙箱不是强隔离**。`vm` 挡不住恶意脚本，面板底部固定写着「只导入你信任来源的脚本」，没有藏起来。
- **播放链路已接入**（`resolveProviderPlayUrlData` 是统一取址入口，4 处调用共享）：
  - 两条兜底触发点：拿到响应但**没有直链**（会员/版权限制常见形态）、以及**取址直接抛错**。都失败才抛平台那条原始错误，不会被兜底错误盖住。
  - 只兜底有对应 LX 源的平台：`netease→wy`、`qq→tx`、`kugou→kg`。汽水 / Spotify / 本地音乐在 LX 生态里没有对应源，直接跳过，不硬编一个。
  - 默认开启（装了音源就是要用），音源面板里可关（`mineradio-lx-source-fallback=0`）；切歌的 AbortError 不触发兜底，避免拖慢连点切歌。
  - **ID 归一是可验证的，我用回显脚本证了**：`buildLxMusicInfo()` 只传该平台真正的主 ID（wy 传 `musicId`、tx 传 `songmid`+`strMediaMid`、kg 传 `hash`+`albumId`），不把 id 到处滥填。用一段「把收到的 `musicInfo` 塞进返回 URL」的合成脚本跑真实链路，回显结果：
    - 酷狗 → `hash=HASH_KG`、`albumId=AL_KG`、`meta.kg={id,hash}` ✓
    - QQ → `songmid=MID_QQ`、`strMediaMid=MM_QQ`、`meta.qq` ✓、**没有 hash**（不串味）✓
    - 汽水 → `lxSourceKeyForProvider` 返回空 ✓
  - 已知的良性现象：酷狗那条 `songmid`/`musicId` 会被 LX 的 `normalizeMusicInfo` 连锁填成同一个 hash 值。真实 kg 源读的是 `hash`，`meta.kg` 也正确，所以不影响；这是参考实现与 LX 官方共同的归一行为，不是我们传错。

### 验证

- `tests/lx-source.test.js` 15 条：代理头白名单（拒 Cookie/CRLF/超长）、编解码往返、合成脚本能加载并报出 `kw/kg` 与音质、自检通过、歌词 action 走通、不能停用最后一个音源、删除后清空、路由/前端/弹层已接线、路由文件不含具体平台域名；以及平台映射（汽水/Spotify 返回空）、三平台 ID 归一、`hasUsableId`、取址链兜底接线与默认开启。
- 端到端（Electron 加载真实页面 + 回显脚本）：`LxMusicInfo.buildLxMusicInfo` → `LxSource.resolveUrl` → `/api/lx-source/resolve` → 脚本收到的字段，三平台逐一核对通过。
- 真起服务打端点：初始 `configured:false` → 导入后 `sources:['kw']` → 自检 `ok:true` → 歌词拿到 `[00:01.00]probe` → 取址返回 `url` + `proxy.params`。
- 139/139 测试；变异 40 条中 39 条由跑批全判红，M42（页签入口归一失效）单独自证：改掉那一行 → 这条静态守卫立刻红，还原后绿。dist 五个文件一致。

### 顺带修的一个工程隐患

变异检验脚本原来只在 `finally` 里恢复文件，进程被强杀（SIGTERM/SIGKILL）就会**把变异后的代码留在仓库**——这次就撞上了：`server/lib/petdex-uri.js` 的 SSRF 校验被留成 `if (false) return ''`，直到两天后跑全量测试才暴露。现在每条变异前先把「原文件路径 + 原内容」落盘到 `.mutate-inflight.json`，下次启动自动恢复；同时挂 SIGINT/SIGTERM/SIGHUP 恢复后退出。


## v3.3.2 · 2026-11-14

补丁版本，把 v3.3.1（11-11 构建）之后的代码送进正式安装包。**此前的 v3.3.1 资产不含这些改动**；本版起 Release 正文固定写明构建 commit 与时间，并附资产 SHA256。

- **平台能力面板**（本版唯一面向用户的新功能）：五平台增补能力入口，从平台推荐弹窗进入；只接有一手协议可验证的 module/method。
- **桌面宠物接入 Petdex**：挑选交给 petdex 网页，应用只负责导入；帧布局按实测 8×9 / 8×11 网格，9 个动作完整映射。
- **壁纸视频修复**：玻璃采样全黑的五层根因、启动失败（协议请求悬挂）、画面倒置、控制台隐藏残留黑色玻璃条、恢复窗口圆角、镜像改零分配 `createImageBitmap`。
- **性能**：窗口隐藏/最小化与 Folia 世界激活时停止壁纸解码和玻璃镜像循环，壁纸层退出合成链；恢复时主动唤醒。
- **发布可追溯**：`build/build-provenance.json` 随包发布，「关于本版本」面板显示版本、完整 commit、构建时间；`VERSIONING.md` 定义语义化版本规则；CI 配置（docs/ci/tests.yml）跑全量测试并校验版本 bump，待 workflow scope 授权后启用。

### 桌面宠物接入 Petdex（实现细节）

- **挑选交给 petdex 网站，应用只负责导入**：桌宠卡片新增 🐾 按钮 → 面板里「在浏览器里挑宠物」用系统浏览器打开 `petdex.dev/zh`（那边有动画预览、精选、合集与排行榜），挑好复制宠物页地址粘回面板即可导入；装过几只可以在面板里切换 / 移除，移除只删本地缓存。
  - **为什么不在应用内做列表**：petdex **没有缩略图服务**（实测 `?w=96` / `?width=96` 都返回原尺寸 2.4MB 图集），24 条列表就是 57MB；只用 `dominantColor` 色块又根本没法挑（第一版就是这样，实际不可用）。
  - **为什么导入要解析宠物页、不能走搜索接口**：搜索是**按显示名/标签匹配**的，用 slug 搜不到目标——实测 `q=hachiware-2` 返回 total=0，而 `q=小八` 能搜到它；`/api/pets/<slug>` 又需要登录（401）。所以只能抓宠物页 HTML 里的 `--sprite-url` 变量（实测 `/pets/<slug>` 与 `/zh/pets/<slug>` 返回同一地址）。
- **协议是按实测取证接的，不是猜的**：
  - 列表走 `GET petdex.dev/api/pets/search?q=&limit=`（公开，返回 `{ pets[], nextCursor, total }`，实测 total 5208）。
  - 元数据 `assets.petdex.dev/curated/<slug>/pet.json` **只有 4 个字段**（id / displayName / description / spritesheetPath），不含任何帧信息。帧布局是固定网格约定：**classic 8×9、v2 8×11，每帧 192×208，一个状态占一行、帧从第 0 列连续排**。
  - 精灵表是整张 WebP（boba 实测 1536×2288、2.4MB）。**没有缩略图服务**（`?w=` / `?width=` 都不缩放），所以应用里不做列表、挑选交给 petdex 网页，下载只发生在导入那一刻。
- **每行帧数是解码后测出来的，不是假定 8 列**：Electron 无头探针实测两种网格——boba（v2）`8×11`、`rowFrames=[7,8,8,4,5,8,6,6,6,8,8]`；hachiware-2（classic）`8×9`、`rowFrames=[6,8,8,4,5,8,6,6,6]`。各行帧数确实不同，按 8 列硬播会闪空白帧。算法：把该行画到离屏 canvas，逐列统计非透明采样点，命中 ≥4 的最后一列即该行帧数（阈值 1/4/12 实测一致）。classic 的 9 行正好对应 petdex i18n 的 9 个状态，行序映射因此对齐。
- **9 个动作都用上了（原来只看到一个）**：第一版映射表只写了 `idle` 与 `walk`，`sleep`/`yawn`/`stretch` 因为**没有对应键而静默回落到行 0**，观感就是「只有一个动作」。现在抽成 `16a-pet-petdex-map.js`（纯数据 + 纯函数，可单测）：
  - 行序与行帧数取自站点 State Viewer 的权威表，并与 Electron 探针实测吻合：`Idle·6 / RunRight·8 / RunLeft·8 / Waving·4 / Jumping·5 / Failed·8 / Waiting·6 / Running·6 / Review·6`。
  - 状态映射：`idle→Idle`、`walk→Run Right/Run Left`（按朝向）、`sleep→Waiting`（打盹最接近安静待机）、`yawn→Waiting`、`stretch→Waving`（伸懒腰≈挥手伸展）、点击跳→`Jumping`。
  - **每个动作有自己的帧间隔**：idle 170ms（慢才像呼吸）、走 95ms、跳 85ms、Waiting 230ms（最慢），不再是统一 140ms。
  - **待机小动作从 2 个扩到 4 个、频率翻倍**：原来只有 `yawn`/`stretch` 两个、且 20~50 秒才来一次，白天（不触发 `sleep`）几乎只看到 idle，观感就是「只有待机和点击两个动作」。现在轮换池是 `yawn / stretch / wave / review`，7~16 秒一次、每次播 2.4~4 秒；正在放歌时更常进入 `review`（沉浸聆听）。
  - **`Review` 接成「沉浸聆听」**：在陪着听歌的语境里说得通，也正好补足白天的动作变化。**`Running` 仍不接**——纯位移语义（原地跑），和「安静陪你」的定位冲突；表里保留行号，以后有语义再启用。
  - 状态优先级：点击跳 > 伸懒腰/打哈欠 > 走路 > 睡觉 > idle。跳放最前，是为了睡觉时戳它也有反馈。
- **不再满框乱跑、也不会跑出框**：两个独立缺陷。
  - **一直左右走**：`nextWalkAt` 初值 0 且**走完从不推进**，于是「走完 → 下一帧立刻又满足条件」，散步变成永不停歇。现在走完歇 9~24 秒，首次散步也有 7 秒延迟。
  - **右侧跑出框**：行走上限写成 `cols-16`，漏了居中偏移 `offX`（`offX = floor((cols-16)/2)`）。`cols=24` 时宠物右缘到第 28 格、溢出 4 格，被卡片 `overflow:hidden` 裁掉；下限又写 0，等于从不往左走。正确范围是 `walkX ∈ [-offX, cols-16-offX]`，即 `petX ∈ [0, cols-16]`，左右都能贴边且不溢出。
  - 边界算法抽到 `16b-pet-walk-bounds.js`（纯函数 + 8 条单测，含「遍历 cols=16..64 两个端点都不溢出」）；画布窄到 17 格时判定为不可散步，免得贴边抖动。
- **宠物统一收进「皮肤」弹层，切换语义重写**：之前首页卡片上并排三个按钮（🐾 Petdex / 📷 照片 / ⇄ 换伙伴），三套入口各管一半，而且**装了 Petdex 之后 ⇄ 完全失效**——它只改 `homePet.character`，但绘制层 `if (homePet.petdex) 走图片精灵` 优先级更高，按了等于没按。现在：
  - 顶栏「皮肤」弹层新增**桌面宠物**板块：内置 7 只 / 照片生成 / Petdex 已装，全部列成格子（3 列、深色玻璃、当前项高亮），点一格立即换；下面两个动作按钮分别是「用照片生成」「从 Petdex 导入」。
  - 卡片只留一个 ⇄，做**跨类型轮换**（内置 → 照片 → Petdex → 内置），清单顺序稳定，不会跳来跳去。
  - 切换统一走 `homePetSelectSkin(kind, id)`：切到非 Petdex 时必须让 Petdex 模块 `deactivate()`（置空 `homePet.petdex` 并清掉它的选择记忆），否则新选的宠物会被旧精灵盖住。照片生成后也走同一条路。
  - 皮肤弹层的宠物格**刻意不复用 `.heart-fx-grid`**：`07-fx/05d` 拿那个类当宿主选择器，复用会被它的 `innerHTML` 覆盖。用独立的 `pet-skin-grid` / `pet-skin-tile`。
- **动作调度对所有 petdex 宠物统一生效，但个体差异被正确吸收**：
  - 动作池、行序、帧间隔都在模块里，不区分宠物；哪只宠物当前生效只由「装了哪只」决定。
  - **每只宠物的行帧数各自实测**（`rowFrames`），不是写死 8：boba（v2）`[7,8,8,4,5,8,6,6,6,8,8]`、hachiware-2（classic）`[6,8,8,4,5,8,6,6,6]`、yuexinmiao `[6,8,8,4,5,8,6,6,6]`。
  - **某行没画东西时会回落到 idle 行**：不同提交者的精灵表可能缺行（比如没画 `Failed` 那排）。第一版把空行的帧数当成 8，于是播 8 帧全透明——宠物看起来直接消失。现在 `pickRow()` 检测到该行 0 帧就回 idle；连 idle 行也空则交回内置像素伙伴兜底。
  - **内置像素伙伴不受益也不出错**：它只有 `idle/walk/sleep/yawn/stretch` 五套字符帧，`wave`/`review` 在它身上会回落到 idle 帧（`framesFor` 的兜底），所以观感是「idle 播得更久」，不会报错也不会变空白。
- **渲染**：`14-home-pet.js` 的绘制循环优先走 `HomePetPetdex.draw()`（`drawImage` 切帧、`≈140ms/帧`），失败才退回内置字符像素。帧索引按时间算——内置的 `homePet.frameIdx` 只在切换状态时重置、从不自增（内置伙伴实际是静态帧 + 眨眼），拿它驱动精灵不会动。
- **安全边界**：slug 走白名单（`^[a-z0-9][a-z0-9-]{0,63}$` + 显式拒绝 `/`、`\`、`..`），因为它直接拼磁盘路径；下载地址只接受 `https://assets.petdex.dev/*.webp|png`（拒绝其他域、域名前缀伪装、路径伪装、带凭据、非标准端口），因为它来自客户端 POST body。两条都抽成 `server/lib/petdex-uri.js` 纯函数并配单测。
- **踩坑记录**：精灵表回传一开始用 `fs.createReadStream(file).pipe(res)`，结果 `res.writableEnded` 不同步为真，分发器继续走到静态资源处理器再 `writeHead` 一次，直接 `ERR_HTTP_HEADERS_SENT` 崩进程。改成读完 `res.end(buf)` 才对——分发器就是靠 `res.writableEnded` 判断「这个 matcher 处理完了」。
- **验证**：真起服务全链路通过（搜索 total 14 / 安装 2440892B / 本地列表 / 回传 `image/webp` 字节一致）；路径穿越与 SSRF 均被拦；83/83 测试、29/29 变异全判红；Electron 探针实测解码与行帧数。**未验证**：真实点击 UI 的完整交互（需要人工在窗口里操作），以及 5208 个宠物中未逐一抽样（只验了 boba/mallow 等几个）。


## v3.3.1 安全加固

### 安全加固（补齐 2026-10-17 代码审查漏记的 #20 / #21 / #27 / #29）

- **DNS rebinding 防线（#21）**：本地 HTTP 服务新增 Host 头白名单，只接受 `127.0.0.1` / `localhost` / `::1`，其余一律 `403 BAD_HOST` 且不发 CORS 头。此前 `HOST` 虽已锁死 `127.0.0.1`，但那挡不住 rebinding —— 攻击者域名 rebind 后浏览器以 `evil.com` 的 origin 发请求，同源成立、CORS 不参与判定，唯一可靠判据就是 Host 头。需要局域网访问时用 `MINERADIO_ALLOW_NON_LOOPBACK_HOST=1` 显式解除。
- **CORS 收紧（#21）**：`Access-Control-Allow-Origin` 由「任意环回端口」改为只回显本服务自己的 origin（协议 http + 端口 === 本服务 PORT + 环回主机名）。此前本机任意端口的页面都能拿到带 ACAO 的响应。
- **首页 token 门禁（#21）**：`/` 与 `/index.html` 现在要求 `?token=`（常量时间比较）。这两个是 `API_TOKEN` 明文注入 HTML 的唯一出处，原本静态路由完全不过鉴权，`GET /` 即拿 token。主进程 `loadMainWindowWithRetry` 已同步在导航 URL 拼 token。**行为变化**：手动用浏览器打开 `localhost:3000` 会 403，这是有意的 fail-closed。
- **token 常量时间比较（#20）**：`assertApiAuth` 改用 `crypto.timingSafeEqual`，并补「空 token / 空期望值一律拒绝」两处 fail-closed。原 `===` 的逐字节提前返回可被计时侧信道利用。
- **错误信息不外泄（#27）**：更新链、beatmap 缓存、cuefield 过渡共 7 处 `err.message` 直回客户端改为稳定错误码，细节转服务端日志。
- **插件不再「放进目录即执行」（#29）**：LiquidGlass 插件改为 pending 模式 —— 磁盘上的插件文件首次发现时只登记元信息、不读取不执行；用户在面板里显式点启用后才求值。此前 `loadDesktopLiquidGlassPlugins` 无条件 `eval` 每个 .js，而插件的 `registerPlugin` 在模块顶层就调，等于「目录可写 = 重启即代码执行」。

### #15 / #16：汽水验证窗口安全加固（已在真实扫码 + 二次验证环境验证）

- **#15 已修**：验证窗口由 `webSecurity: false`（整个窗口关掉同源策略）改为 `webSecurity: true`。原先这个窗口会加载上游 2046 决策返回的远程脚本，同源策略失效时等于给持有登录 cookie 的窗口开了任意代码执行面。
- **#16 已修**：`Access-Control-Allow-Origin` 由 `*` 改为只回显本页自己的 origin，并同时注入 `Access-Control-Allow-Credentials: true`（组件内部 axios 硬编码 `withCredentials:true`，`*` + 凭据是非法组合）。
- 配套补齐：`Allow-Headers` 写全组件会发的 5 个自定义头；注入前按小写名删光上游自带的 `access-control-*` / `vary`（否则 `verify.zijieapi.com` 会留两个 ACAO，带凭据判定失败）；`decision.url` 走 https + 域名白名单；组件脚本补 `.js` 后缀回退。
- **安全加固的连带修复**：把同源策略装回去之后，原本靠「门全拆」掩盖的链路问题全部暴露，逐一补齐——主进程轮询 XHR 开 `withCredentials`、从 `Set-Cookie` 响应头直接留存登录 cookie（跨站 `SameSite` 会拒写 cookie jar）、二次验证窗口去重三态与代际防重入锁、host 页版本自愈重载、登录弹窗状态类前置清理。
- 真实链路结论：`error_code 7` 的「限流」解读已被多组探针证伪。**原「仍未收口」的前两项已于 2026-11-13 收口**，其中一项结论被纠正：`routes/qishui.js` 的 `status === '2'` **不是死代码**——`qishui-auth-v6.js:828` 判确认态时同时写过 `String(data.status) === '3'` 与 `=== 'confirmed'`，说明上游数字与字面量两种形态都出现过，删掉 `'2'` 会让「已扫码」退化成「等待扫码」。现在改为双形态统一映射 + 单测锁定；`error_code 7` 不再断言为限流，改为中性状态 `upstream_code_7`，只保留保守降频。详见下方「本轮收口」。
- 守卫：本批共新增 15 个真实 Electron 探针与 7 组静态守卫（`tests/*.test.js`），关键项均已反向自证；全量 `node scripts/run-tests.js` 通过。

### 本轮收口（2026-11-13，原「仍未收口」的前两项）

- **汽水扫码状态（原记「`status === '2'` 是死代码」——结论纠正，不删）**：新增 `server/qishui/qr-status.js` 的 `mapQishuiQrStatus()` 纯函数，把数字形态（`1` 新 / `2` 已扫 / `3` 已确认）与字面量（`new` / `scanned` / `confirmed` / `expired`）收敛成同一套前端状态词，未知值原样透传。`routes/qishui.js` 原来的 4 行 if 链换成一次调用。
  - 为什么不删：原判断「上游只回字面量」没有出处，且有反证——`qishui-auth-v6.js:828` 判确认态时同时写了 `String(data.status) === '3'` 和 `=== 'confirmed'`。上游只要真的回过数字，删掉 `'2'` 就会让已扫码的界面退回「等待扫码」。
  - 守卫：`tests/qishui-qr-status.test.js` 9 条单测（含「数字 2 必须映射成 scanned」这条回归）；变异 M28（删 `'2'`）与 M29（把状态名改回 `rate_limited`）均被判红。
- **`error_code 7`（语义未确认，不再假装是限流）**：状态名由 `rate_limited` 改为中性的 `upstream_code_7`；`retryAfterMs` 保留 60s **仅作保守降频**，不再声称它是「限流窗口」。前端 `03-login-modal-flows.js` 改认新状态名，文案改为「确认接口暂时不可用（错误码 7），N 秒后自动重试」；`server/qishui/auth.js`（未启用链路）与 `qishui-auth-v6.js` 注释里的「限流」措辞同步改掉。
  - 守卫：`platform-api-parity.test.js` ⑨ 断言 `rate_limited` 不再出现在路由与映射模块里。

### 仍未收口（不影响登录，属清理项）

> **每项都必须有复核期限和可执行的下一步**，登记在 `tests/tech-debt.test.js`；过期未处理会让该测试判红，不允许变成永久技术债。

- **`_mfaDone` 后无条件 `isResend` 重发（复核期限 2026-12-31）**：每轮打 2 个上游请求。不能简单跳过——跳过会让响应停在 2046、前端退回「请扫码」。下一步：真机扫码走完一次二次验证，确认 `isResend` 是否只在首轮需要；若确实只首轮，加一个 `_mfaResent` 标记。
- **`server/qishui/auth.js` 把 `error_code 7` 当 `'wait'`（复核期限 2026-12-31）**：与路由的中性 `upstream_code_7` 并存。它的导出函数只在 `qishui-api.js` 再导出、无路由调用，是另一套未启用链路。下一步：先确认全仓确实没有调用者，然后要么删掉这条链路，要么与 `upstream_code_7` 对齐——不要两套语义并存。
- **`server/lib/media-proxy.js` 的音频流仍用 `ACAO: *`（复核期限 2026-12-31）**：这不是随手放宽。播放器创建音频元素时设了 `crossOrigin = 'anonymous'`（`09b-playback-core.js:232`、`13-playback-start-audio.js:200/661`），浏览器要求响应的 ACAO 与之匹配，否则音频进不了 AudioContext、整套可视化会哑掉——所以不能直接删。当前风险由 token 门禁（`/api/audio` 走 `?token=` 白名单）+ Host 白名单兜住，属纵深防御缺口而非可利用漏洞。下一步：真起壁纸模式抓 `/api/audio` 请求的 `Origin`，然后改成「白名单回显 Origin，非白名单不回首部」。
- **4 个测试列在 `KUGOU_SKIP_TESTS`（有意跳过，非技术债）**：用户裁定保持原 Home 布局。已在登记表标为 `accepted` 并写明裁定来源，不设复核期限。

## v3.3.1

自 v3.3.0 基线累积的改动，近 600 个文件。除了下方本节的**安全加固**（其中 `webSecurity:false` 技术债已还清）外，这一版的功能亮点集中在「看得见的升级」上——视觉、动效、过渡和抗卡顿。用户只有知道升级了什么才会升级，这里说清楚每一块。

### 🪟 Folia 全屏歌词舞台（默认启用）

- **一整套 Folia 视觉化歌词界面**：不再只是以前那种读字型工具栏歌词，而是把歌词渲染成 14 套可切换的「歌词样式」——`classic / still / partita / tilt / claddagh / cappella / cadenza / fume / monet / pendolo / diorama / sonnet / tempera / lumiere`。每套都有独立的镜头、构图与入场/退场编排（tempera 是节目编排层：按语义分段，121 种 shot / 3 种转场 / 5 种装饰母题，seek 拖动定位依然精确）。
- **多套背景玩法**：sora / latent / monet / noise-texture / nomand / url 等背景可切换；`folia-mods` 还带独立模组包（`visualizer-jump`、`nebbia`、`hanabi`、`machi`），清单式启停（禁用即不加载不注册，安全）。
- **性能与回退**：与桌面歌词/壁纸同源；需动态 `import` 依赖的样式做成异步占位（pending），失败退回原生并显示原因，不会黑屏。FX 面板独占一页，可调样式、背景与动效强度。

### 🧊 Folia WebGL 实时玻璃

- 桌面歌词/壁纸的背景玻璃升级为 **WebGL 实时渲染**（`public/vendor/folia` + `public/folia-mods`），色彩与光晕质感远超以前纯 CSS 的效果。
- **自愈回退**：CSS 桥实例停用时自动镜像回退到 CSS 玻璃层，避免背景发灰（此前 Folia 常发灰就是缺这条兜底）；`prefers-reduced-transparency`（系统「减少透明度」）时自动降级，尊重系统偏好。

### ❤️ 红心粒子与收藏演出

- **红心点击动效引擎（四套 + 随机）**：点红心不再是简单变色，而是粒子动画——
  - `folia` 纸片楔形扇（14 个楔形扇隔一画一 + 纸色圆盘 + 双同心环）；
  - `riso` 油墨灌满（心形从下往上灌色 + 香槟版错位套准 + 半调点）；
  - `ring` 冲击波粒子（双环扩散 + 12 粒小心/星芒/光点径向炸开再上浮）；
  - `star` 极简星芒（四向十字星 + 细环）；`off` 只变色不跳；默认 `random` 随机抽。
- **收藏演出（整屏场景动画）**：`snow` 雪窗——窗外落雪，六角晶体落到玻璃上贴住化开；`birds` 鸟群——170 只椋鸟乱飞→收拢成形→盘旋→惊散。「收藏演出」与「红心动效」都在顶栏「皮肤」弹层里独立开关。

### 🔀 轨道过渡引擎

- **对标酷狗「歌曲过渡」效果矩阵**：四张卡片不是四套引擎，而是一套「曲末交接骨架 + 四组交接瞬间的音频包络配方」——`混音过渡 / 渐进过渡 / 无缝过渡 / 立体声转场`，前代数帧都是 Canvas 逐像素算法（交晖、紫白光环、紫白光缝、紫白光带），不加载任何图片/字体/库、不发网络请求。
- **无缝衔接 Gapless Handoff**：曲末窗口内提前解析下一首地址、用隐藏 `<audio>` 静音预热字节（只 `load()` 不 `play()`），当前曲 `onended` 后才交接，全程只有一个音源发声——省掉 `/api/song/url` 最慢往返，切歌更顺。
- 过渡编排层持有总开关、模式与每模式可调参数，长淡出时同步放大 `trackEndFadeLookaheadSec`。

### 🔒 播放源修订 + 稳健性（不卡顿、不崩）

- **媒体失败分类器**：换源失败先分类再动作，而不是一刀切递归换源。
- **播放源 revision 追踪 + 换源事务复用**：反复点同一首歌复用同一事务，缓解旧「渲染进程崩溃」（`render-process-gone` / OOM）问题。
- **音乐缓存守卫**：新增 cache-prune / media-cache-guard / build-provenance / log-buffer 等服务端模块。

### 🔐 登录自愈

- cookie 只在登录成功时写一次、dfid 不再刷新；token 轮换或返回码异常后自动自愈，减少「明明登着却要我重登」的体验断裂。

### 🖼 细节修复

- 桌面歌词多行布局、红心锁定图标、播放列表缓存迁移、搜索模式标签页、诊断面板等一批界面与稳定性修复。

---

## v3.3.0

内部构建基线（v3.3.1 的承载版，正式变更见上）。

- 本地音乐库（`mineradio-local://` 媒体协议）、内置歌单库（多平台混合曲目 + 本地文件）合入本仓库。
- 服务端四个单体拆分为分层模块族；WebGL/SwiftShader 无显卡兜底启用。
- 该项在 v3.3.1 及后续累积中得到完善，差异主要在「基础能力上线」。

## v3.2.0

### cuefield 过渡引擎 v2（默认启用）

- 收进上游 `cuefield-next/` 的 19 个模块，`POST /api/cuefield/transition` 默认 `engine: "v2"`；显式传 `engine: "v1"` 才回落到旧的 8 模块实现。
- v2 出错会自动回 v1，并在响应里带 `engineFallback`（回落永远可见，不静默）。
- 前端执行层换成配套的 5 个模块（`05-cuefield/00 / 01 / 01a / 01b / 02`），可消费 duck / echo / bridge / loop / rate / spectrum 与 A/B 双 deck 独立 volume 曲线（11 种 op）；v1 执行层只会压成一次 equal-power crossfade。
- 两代引擎产出结构不兼容（v2 用 `policy` / `route` / `rescueClass`，多出 `artifact` / `rejected`），请求版本必须与前端执行层配套。
- v2 在真实歌曲上多为 `tier: "weak"`，本仓库显式放开 `allowWeak: true` 并把门槛抬到 `minWeakScore: 0.6`。
- 和声证据需要的 `musicalProfile` 改为自带实现：降采样到 ~12kHz → 4096 点 FFT → 取谱峰 → 12 音级 chroma → Krumhansl 模板相关系数定调，随 beatmap 落盘（pack `v: 2`，约 2~3.5 KB；4 分钟整轨约 0.25~0.5s）。

### 安全加固（按 2026-10-17 代码审查逐项修复）

- **凭据一律 fail-closed**：酷狗 / QQ / 汽水 / Spotify 的 cookie 与 token 只以 safeStorage 密文（`MR` 前缀）落盘；加密不可用时只保留在内存并报错。历史明文文件仅在「加密可用」时读取并立即重写为密文。
- **更新链**：补丁签名缺公钥直接拒绝（不再 fail-open）；安装包下载加大小上限；更新 manifest 只认 https。
- **媒体代理 SSRF**：手动跟随重定向，并逐跳重新校验 host 白名单。
- **AI 接口** baseUrl 校验；**IPC sender** 批量校验；新增 **CSP**；手势识别（MediaPipe）与封面深度（Transformers.js）改为从 `public/vendor` 本地加载，失败才回落 CDN。
- 修复 4 处 **XSS**；汽水验证页的动态脚本改为域名白名单（可用 `MINERADIO_QISHUI_VERIFY_SCRIPT_HOSTS` 追加）。
- 汽水登录态增加 30 天过期判定；QQ cookie 覆盖加锁；登录态轮询加守卫。
- 未实施：汽水验证页的 `webSecurity:false` 仍保留 —— 关闭它会断掉依赖同源 cookie 的验证链路，需在真实 MFA 环境验证后才能改。

### 性能

- 主循环去掉每帧强制 reflow；FX 滑块落盘加 debounce；虚拟列表改为窗口差分更新。

### 其他

- 汽水本地会话导入窗口下线，登录统一走扫码桥；相关测试同步更新。
- Spotify token 加密与刷新链路测试补齐。

## v3.1.0

- **手写墨迹开屏**：开屏改为按采集笔迹回放的 12 笔手写 "mineradio"，前 6 笔（miner）与后 6 笔（adio）两侧同时落笔；进线/出线收缩、写完落墨、水滴弹起裂成三粒，笔速按原始轨迹的 3.2 倍回放。
- **崩溃诊断与防护（本仓库实现）**：渲染进程崩溃记录时间戳与 GPU `featureStatus`（区分「渲染进程自己炸」与「显卡加速炸」）；崩溃风暴改为指数退避，避免无限重启；新增 GPU / raster / utility / audio 子进程崩溃记录与本地 minidump 落盘（不联网上传）。
- **酷狗会员识别兜底**：unionVip 漏判时补查网页端 `roleinfo`（role 1/2=VIP，6/11/13=SVIP，31/33=音乐包）。
- **酷狗歌词修复**：`[language:]` 多轨时优先取 `type=1` 真译文（修复韩语歌把音译当译文显示成乱码）；KRC 取词改为 hash 优先、`album_audio_id` 兜底 + 时长守卫（修复歌词错位、显示成中文有声书或直接没歌词）。
- **汽水音乐登录 v6**：合并上游 v2.2.0 的扫码登录实现（`qishui-auth-v6` / `qishui-qr-login.js`，与上游同一份代码）—— 原实现无法正常播放音乐，因此换用上游实现；音频解密移到 worker，主线程不再被解密卡住。
- **汽水目录行换源修复**：UGC 行的 artist 是上传者、原唱只写在标题括号里，改为用解析出的原唱拼关键词；排除翻唱 / 伴奏 / 片段；不再用 `Privilege.playable` 过滤（避免跳过实际可播的原唱）。
- **播放失败不再递归换源**：没有可用音源时直接终局并完成结算，修复 `playQueueAt → skipFailedQueueItem` 自我递归叠 3~4 层、主线程被打满 15~30s、渲染进程 OOM（`kOomExceptionCode 0xE0000008`）；封面重管线后移到取址成功之后。
- **歌词刷新去重**：按整份歌词响应签名比对，避免重复应用同一份歌词。
- **界面修复**：全屏 DIY 区锚点改为整组账号 pill（多账号纵向堆叠时不再互相压住）；歌单面板补来源提示节点。
- **测试**：更新源回退事务契约改为「无可用音源时 0 次推进且必须结算」。

## v3.0.1

- 修复 v3.0.0 中已知的问题。
- 优化设备体验：界面响应、视觉流畅度与整体稳定性提升。
- 酷狗音乐链路与歌单同步细节完善。
- 发布与文档：GLM（智谱 AI）加入创作者名单，作为 AI 结对开发助手参与代码实现、问题修复与文档编写。
- 升级 Home 布局：Hero 网格与卡片体系重设计，信息层级与视觉节奏更清晰。
- 新增卡片宠物「像素伙伴」：Home 桌宠卡片，支持上传照片像素化为自定义伙伴（基于 claude-pet MIT 许可集成，感谢 Lew1sWong）。
- 性能与体验优化：按优先级修复一批播放器性能 / 交互问题。
- 修复「今日聆听」：今日歌曲无法点击播放的问题。
- 登录页重做：改为「平台 → 方式 → 操作」单页布局，消除滚动冲突；清理 Spotify 登录页。
- 新增玻璃控件：FX / 登录滑动玻璃选中胶囊、FX / 音量玻璃滑块拇指，按下放大、松开弹簧缩回的交互打磨。
- QQ Cookie 失效检测 + 自动续期：资料页 code 1000 / result 301、缺播放密钥、取链 login_required 判定授权失效；服务端调用 QQConnectLogin.LoginServer / QQLogin 自动续期（优先 musickey，支持 refresh token），成功写回 .qq-cookie，失败标记 reauthRequired；状态轮询与取歌链失败时自动尝试，也支持 POST /api/qq/login/refresh 手动触发；桌面端采集 Cookie 时跳过过期项（优先 y.qq.com），已登录再开官方窗口自动 forceReauth 重登。
- 酷狗 KRC 歌词解密与翻译显示修复：支持 krc1 加密歌词解密（XOR 密钥 + zlib 解压），翻译声明行（如「翻译由文曲大模型提供」）不再误显示为译文；旧持久缓存无译文时刷新后自动重新应用。
- 酷狗云歌单 dfid 修复：修复设备身份注册条件错误导致 dfid 回落 '-' 触发 20017 错误的问题。
- 汽水音乐 device_id 持久化：设备身份跨进程稳定，行为更接近真实客户端，降低风控触发。
- morphicons 图标形变动画（guillermolg00/morphicons MIT 许可）：播放 / 暂停、播放顺序、音量档位控制台图标平滑形变切换。
- QQ VIP 启动强检：开机自动强制重查 QQ 登录与 VIP 状态。
- 启动性能优化（主进程 / 服务端 / 前端三层懒加载）：主进程重模块（Wallpaper Engine 库与运行时、Spotify、汽水本地会话、桌面图标形状）改为首次 IPC 时按需加载；服务端音源模块（网易 / 酷狗 / Spotify / 汽水 / QQ VIP）改为首次调用时 require；前端模块拆两波注入，boot 必需模块立即加载，FX 扩展面板 / 登录弹窗流 / 更新预览 / 二维码同步等延后到 boot 之后。
- 新增 FX 面板延迟波占位模块（07-fx/00-panel-lazy-stubs.js），真实实现加载前提供同名空实现，避免 boot / overlay 阶段 ReferenceError。
- 修复延迟加载引入的白屏隐患：closeUpdatePanel 改为点击时惰性解析（原急切引用会中断合并脚本）；汽水登录态声明上移主波（boot 期急切读写）；loader 缓存版本号改为跟随 data-app-version 自动生成，避免硬编码漏更新导致旧 loader 配新模块。
- 本地服务模块 ETag 改用 size + mtime 支持 revalidate，杜绝「版本号忘 bump → Chromium 缓存旧模块 → 白屏且重装无效」。
- 面板 DOM 绑定延后到 idle / 首次打开（bindFxGlobalInteractions + scheduleFxPanelDomBind），视觉仍由 setPreset 独立生效。
- 修复 Prismal 玻璃滑块：程序化改 value 时同步填充，解决蓝色进度条停在旧位置的问题。
- 清理：移除 public/liquidglass.js 旧残留与嵌套重复的 sonic-topography 副本（减少约 2.2MB 资源与 914KB 预览图）。
- 开屏（Splash）重做：新增真实加载进度条（细轨 + 玻璃墨珠进度点 + 彗尾 + 百分比与状态文案），进度按「真实就绪 + 时间门禁 + 缓动推进」呈现，避免本地缓存命中时瞬间 100%；完成后墨珠落定过冲回弹 + 涟漪 + 整轨氛围光。
- 开屏进入流程：记录 ready 前的点击意图（splashPendingEnter），模块就绪后立即进入，解决提前点击无效；新增 requestSplashEnterNow / tryMarkSplashReadyFromBoot。
- 延迟加载健壮性：动态库加载记录状态（loading / ok / error），失败后允许重试、加载中复用同一节点；登录与退出流程对延迟波函数增加 typeof 守卫，避免未就绪时中断。
- 手势识别（MediaPipe）CDN 回退：jsdelivr 不可达时自动切换 unpkg 备用源。
- 首屏 vendor 脚本（morphicons / raindrop-fx / weather-canvas）改为 defer 加载，减少首屏阻塞。
- 工程工具：新增 smoke:deferred 延迟启动冒烟测试；quick-check 模块解析改为按 loader 分波解析。

## v3.0.0

> 版本号从 1.x 跳到 3.x，对齐「v3.x 特性轨」（见 `阅读播放器升级方向.md` 第五节）。
> v1.2.0 及此前所有 1.x 条目内容均并入此版本，不再单独维护 1.x 轨。

- **v3.0.0 已实现**：LiquidGlass 液态玻璃、自适应性能监测、DPAPI 凭据加密、酷狗扫码登录、Sonic Topography、桌面歌词、天气雨滴。
- **v1.2.0 内容（并入）**：Home 接着听增强、场景电台 2.0 Phase B/C、Home 布局收口（1236×832）、情绪节奏音效大师、DIY 视觉控制台默认 DIY 模式、Home P1 抛光。
- **v1.1.x 内容（并入）**：installer safety fix（D-Z 盘优先 + 安全卸载）、纯净安装发布版、默认视觉参数、3D 歌单架开关、高级设置性能项、用户存档修复。
- **架构**：index.html 巨石拆分为 69 模块（按领域目录 01-scene ~ 10-shell）；`qishui-audio-decryptor/` 独立目录；`index-loader.js` 并行 fetch + 单 script 合并求值。
- **汽水音乐**：完整登录链路（本机会话 + Token + QR 同步）、歌单详情、红心/收藏、首页 feed、取链/解密失败自动换源。
- **账号增强**：歌单/专辑取消收藏（汽水/Spotify/网易云）、跨设备登录包导出/导入、QR 局域网同步、VIP 权益展示细化。
- **P3 创新 MVP**：本地内容指纹去重、歌词翻译本地启发式对齐、LiquidGlass 插件 SDK + 示例插件。
- **Netease same-track + 手动切源**：底栏曲名片源徽章弹出切换器；灰歌自动找可播同录音版本。
- **歌词缓存**：桌面版磁盘 lyric cache + 队列下一首预取。

## v1.2.0

- Home 接着听增强（零新增卡片）：Continue 网格卡叠加平台标（酷狗/QQ/网易）、进度条与「续播 xx%」；`getContinuePresentation()` 优先 `PLAYBACK_SESSION_STORE_KEY`；点击 Continue 从上次进度自动播放；有 session 时底部 tile 去重，Continue 卡为唯一带进度恢复入口。
- Home 启动加载优化：Continue 卡与「最近还听过」tile 优先从 localStorage 即时渲染，不再等待 discover API；本地 tile 与 session 封面跳过 skeleton。
- 场景电台 2.0 Phase B：Home 场景区（时段推荐大卡 + 五场景网格 +「回到我的场景」）；`homeSceneRadioState` 与天气电台状态隔离；场景开播走 `scene-radio` 上下文，自动切视觉 preset 与情绪音效 scene bias。
- 场景电台 2.0 Phase C：客户端启动 fetch `/api/scene/presets` 合并服务端 mood/视觉字段（本地 fallback 保留）；场景内切歌保持 context；离开场景（普通播放/清空队列）自动恢复用户 preset 与联动视觉；每日一次「上次场景」toast 提示。
- Home 布局收口：最小窗口定稿 `1236×832`；CD 顶对齐；场景与接着听分区不增卡片。
- 情绪节奏音效大师：WebAudio EQ/压缩/限幅；控制台「仅音效/联动视觉」开关；A/B 按住对比与曲风策略。
- DIY 视觉控制台：默认 DIY 模式；`#fx-fab` 点击固定打开面板。
- Home P1 抛光：离线缓存 stale 提示可点击刷新；酷狗接着听平台识别；回 Home 即时同步 Continue 进度；`homeRadioStartBusy` 重命名。

## v1.1.1

- P0 installer safety fix: installation now defaults to the first available non-C drive from `D:\Mineradio` through `Z:\Mineradio`; it falls back to `C:\Mineradio` only when no D-Z drive exists.
- The installer now forces the target path into a dedicated `Mineradio` folder, blocks non-empty non-Mineradio-owned targets, and blocks C drive installs when a D-Z drive is available.
- Existing registered installs in a dedicated `...\Mineradio` folder are adopted in place so users can run the new setup over their current installation and receive the safe uninstaller.
- Existing dedicated `...\Mineradio` folders that already contain Mineradio files can be overwritten even if they were created before the new safety marker existed.
- The new uninstaller no longer removes the whole installation root or app subfolders recursively; it deletes only known top-level Mineradio/Electron files and leaves unrelated files in place.
- Legacy uninstallers without the new safety marker are skipped during install; the setup deletes only the old `Uninstall Mineradio.exe` file and registry entry so it cannot indirectly trigger an older unsafe uninstall routine.
- Installer/uninstaller safety fixes require the full setup package; quick patch JSON files must not be used as the only delivery path for this issue.

## v1.1.0

- 纯净安装发布版：从当前 `resources/app` 可信源码重新构建 1.1.0 安装包，旧打包产物、旧备份包和旧安装包不再作为发布来源。
- 重要安全说明：`v1.0.10` 及更早旧安装包不再建议继续安装或传播，请先隔离旧安装包；本次不提供从 `v1.0.10` 到 `v1.1.0` 的软件内本地更新，请到 GitHub Release 手动下载 `v1.1.0` 进行纯净安装。
- 默认视觉参数更新：将 `默认测试.json` 作为首次启动默认用户存档和软件内视觉参数默认值；新用户首次启动即使用同一份快照，用户存档中自动预置「默认测试」。
- 默认视觉快照包括：`emily` 视觉预设、封面粒子分辨率 `1.55`、电影镜头强度 `0.5`、歌词发光 `0.28`、高亮色 `#fac900`、发光色 `#008aff`、UI/Home/视觉图标白色、3D 歌单架静态常驻、播客歌单默认关闭、侧向角度 `-15`。
- 3D 歌单架新增内容开关：可关闭播客歌单，可选择是否把「我的歌单」与「收藏歌单」合并成一条连续滚动列表。
- 3D 歌单架交互修复：动态/静态详情页绑定分流，静态详情页跟随封面粒子世界轴，动态详情页跟随镜头；常驻歌单架未命中时不再长期挡歌词，命中卡片时才浮起到前景。
- 3D 歌单详情页修复：详情页打开后保持更完整的页面显示和中心高亮行；修复固定/常驻状态下详情页被歌词或卡片遮挡、动态镜头触发区异常、滚轮高亮不同步等问题。
- 歌词透明度修复：详情页选歌/切歌时新词不再突然跳亮；详情页打开时歌词保持可读，但降低发光层并保持在详情页下层，避免遮挡中心高亮行。
- 高级设置新增性能项：后台策略支持自动优化、保持运行、停止释放；画质档位支持低/中/高/超高；直播后台保持开启后不再进入低占用暂停。
- 用户存档修复：应用用户视觉存档后会提交播放态视觉预设，跳转歌曲、切歌不再回退到上一个视觉预设。
- 全屏/控制台修复：视觉预设热键按钮不再被全屏 DIY 悬浮入口遮挡；视觉控制台隐藏按钮会跟随一起隐藏，不再残留一个孤立标记。
- 更新 Electron / electron-builder 依赖，修复已知高风险构建依赖告警。
- 修复软件内更新失败后的循环体验：快速补丁失败后不再自动反复拉完整安装包，完整安装包下载完成后也不再自动打开，需用户手动确认。
- 更新下载会复用本地已校验通过的安装包，避免重复下载同一文件。

## v1.0.10

- 重做桌面歌词视觉与交互：保持软件内歌词质感，优化白底可读性、长歌词滚动、锁定穿透、电影震动与最小化状态一致性。
- 修复安魂预设歌词位置无法调整的问题，当前嘴部歌词原位置作为原点，景深改为按视角前后移动。
- 歌词布局新增上下角度与左右角度调节，并会随本地布局和用户存档保存。
- 歌词镜头绑定开启时避让右侧 3D 歌单架，安魂预设也同步处理，避免遮挡歌单架操作。
- 新增方向键上下调节音量，每次 5%，输入框和滑条聚焦时不会误触。
- 调整更新包规则：补丁包命名使用 `旧版本→新版本` 表达，且以后只为低于新版的最近 4 个版本生成快速补丁。

## v1.0.9

- 修复安装包深色界面中部分文字仍为黑色导致看不清的问题，安装器改为浅色高对比界面。
- 安装包支持用户自由选择安装目录；默认仍优先 `D:\Mineradio`，选择盘根目录时会自动补全 `Mineradio` 文件夹。
- 修复软件可重复打开的问题，重复启动时会聚焦当前已运行的窗口。
- 修复软件每次启动都会自动创建/刷新桌面快捷方式的问题。

## v1.0.8

- 修复 QQ 音乐登录后头像/昵称与播放授权状态不同步的问题，歌单能读但歌曲无法播放时会优先识别真实播放票据缺失。
- Home 左侧大卡片改为施工提示，并支持在 Home 页手动展开播放器控制台。
- 视觉预设顺序调整为 emily、安魂、星河、唱片、星球、滚筒、虚空；安魂十字架选中态保持同款蓝色。
- 视觉控制台新增 4 个槽位的“用户存档”，可保存粒子、颜色、滑条和歌词外观习惯，并支持卡片内直接命名。
- 修复重启后歌词预设/自定义颜色没有立即恢复到舞台歌词的问题。
- 播放与暂停增加音频淡入淡出，降低手动启停时的突兀感。

## v1.0.7

- 反正没什么人看，布想写日志了

## v1.0.6

- 反正没什么人看，布想写日志了

## v1.0.5

- 优化 GitHub 更新下载：默认优先尝试国内加速线路，失败后自动切换下一条线路，最后兜底 GitHub 直连。
- 更新弹窗新增下载速度、已下载大小、预计剩余时间、当前线路和线路尝试次数显示。
- 更新失败时保留具体失败原因和已尝试线路数量，方便用户判断是超时、DNS、HTTP、校验失败还是资源未同步。
- 下载完整安装包和快速补丁都会校验 release digest，避免镜像缓存异常导致坏包被应用。
- 修复旧版本快速补丁匹配过宽的问题，确保 `1.0.0`、`1.0.1`、`1.0.2`、`1.0.3` 只会匹配各自对应的补丁包。

## v1.0.4

- 优化最小化/隐藏窗口时的后台占用：只有真正最小化、不可见或文档隐藏时进入深度低占用；可见但失焦、副屏显示时保持正常帧率和电影镜头。
- 修复桌面全屏模式下 3D 视觉画布尺寸不同步导致的裁切/偏上问题；全屏、退出全屏和窗口 resize 后会连续刷新主渲染视口。
- 优化播放器控制台自动隐藏时的残影：隐藏状态不再保留玻璃背景、滤镜和阴影，同时保留显示时的原有玻璃质感。
- 视觉控制台新增“控制台玻璃色差”滑条，并给视觉控制台悬浮按钮增加贴边自动隐藏按钮。
- 左侧“我的歌单”详情页改为分批加载更多歌曲，放大“加载更多”按钮，详情头部支持滚动置顶和回到顶部。
- 沉浸模式恢复左侧歌单栏、3D 歌单架和默认封面渐变背景的可用性。

## v1.0.3

- 重构视觉预设控制台的信息结构，新增 `预设 / 外观 / 歌词 / 动态 / 高级` 五个分区，减少功能堆叠带来的操作压力。
- 优化色轮和封面取色面板的自适应定位，弹层会贴近触发按钮并限制在当前窗口内，降低不同分辨率下错位或越界的概率。
- 修复背景颜色状态混淆问题：纯黑色现在代表真正的黑色背景，封面渐变改为独立模式，控制台会明确显示“封面渐变”。
- 保留并优化根据专辑封面生成背景渐变的功能，避免点击默认时才触发、左侧色块却显示黑色的误导。

## v1.0.2

- Add collect-to-playlist and play-next actions to artist detail songs.
- Publish quick patches for `1.0.1 -> 1.0.2` and `1.0.0 -> 1.0.2`, plus a full installer for cross-version upgrades.

## v1.0.1

- Smooth Emily visual loading and track-change transitions.
- Remove the forced loading-state jump, shorten the Emily cover color mix, and fade cover depth in gradually.
- Publish a `1.0.0 -> 1.0.1` quick patch so installed users can receive an update prompt.

## v1.0.0

- 调整播放器控制台显隐规则：播放、切歌、天气电台开播不再主动弹出底部控制台；只有底部手柄/热区唤出时显示，鼠标移出热区后快速收起。
- 修复播放器控制台进度条不随播放推进的问题：进度条和时间显示现在会优先使用真实音频时长，并在浏览器暂未返回 duration 时使用歌曲 metadata 兜底。
- 修复网易云 / QQ 扫码成功但登录态不落地的问题：网易云不再因资料接口短暂无 profile 立刻清空 cookie，QQ 登录支持新式 `psrf_*` / `wx*` token。
- 修复播放/暂停按钮手动恢复播放失效：手动点击路径现在会在用户点击同步栈内先调用 `audio.play()`，再恢复音频分析器，避免错过浏览器用户激活窗口。
- 修复播放准备阶段的栈溢出会拖死控制台的问题：歌词预置、封面加载、喜欢状态、Home 状态、listen session 和 beatmap / DJ 视觉预热均改为隔离执行，任何非音频链路异常不再阻断真实切歌。
- `playQueueAt` 增加播放阶段日志；若后续仍出现异常，控制台会标明 `source-url`、`visual-prep`、`audio-start` 等阶段，界面不再直接弹出 `Maximum call stack size exceeded`。
- 单曲循环的 `ended` 回调改为异步再入，避免浏览器在音频结束事件中同步重进 `playQueueAt` 引发递归风险。
- 修复天气电台 / 歌单播放链路的控制台递归风险：不再运行时重写播放、上一首、下一首按钮的 `onclick`，避免 `Maximum call stack size exceeded`。
- 切歌开始时立即刷新队列高亮和迷你队列计数；即使浏览器拦截自动播放，标题、时长、队列当前项也保持同步。
- Home 天气电台主按钮和天气卡片统一到同一启动入口，并增加启动 busy 锁，避免重复点击并发开播。
- 修复右键唤起 3D 歌单架时误唤出播放器控制台：歌单架打开期间会硬隐藏底部控制台，并阻止热区/播放态 reveal。

- 隔离 3D 歌单架刷新/关闭异常：歌单 API 成功后不再因为 shelf 重建或 3D 详情列表绘制失败而误报“歌单加载失败”。
- 天气电台、歌单、播客、每日推荐和 3D 详情播放入口统一使用安全队列刷新；队列写入后播放器控制台会恢复可点击，不再被 UI 渲染异常拖死。
- 恢复歌单 / 天气电台自动开播为非 manual 路径，并将 `playQueueAt` 前置 UI 阶段纳入兜底，避免队列标题已变但实际音频和上下一首按钮停在旧状态。
- 天气电台音乐来源收窄为网易云搜索，并取消入队前批量播放 URL 探测，避免点击入口时请求堆积造成卡死。
- 天气电台前端复用正在进行的天气加载请求，避免 Home 后台预加载和手动启动同时打到后端。
- 自动播放被系统拦截时，播放器控制台保持可点击并提示手动继续；真正加载失败的队列项会自动跳到下一首。
- 手动下一首 / 上一首现在一定切换实际音频；单曲循环只在自然播完时重复当前曲。
- 切歌开始时立即暂停旧音频，避免出现歌词和 UI 已切走但旧歌还在播的错位。
- 修复天气电台城市经纬度缺失时落到 `(0,0)` 的问题，并在 Open-Meteo 超时/失败时返回临时电台队列。
- 歌单曲目加载增加 `playlist_track_all -> playlist_detail` 降级，减少歌单加载失败。
- 播放队列写入后强制恢复底部控制台可交互状态，避免天气电台或歌单开播后控制台残留不可点击。
- 启动页退出后补 Home 恢复安全网，避免首页隐藏在空场背景后。

- 发布 Mineradio 首个正式版本，GitHub 主页和安装包版本统一为 `1.0.0`。
- 首页正式版包含天气电台、每日推荐、私人电台、继续听、听歌画像和我的歌单入口。
- 天气电台接入 Open-Meteo，并优先混入每日推荐和私人推荐曲库，过滤 AI / 白噪音 / 雨声助眠等低质结果。
- 修复窗口模式下主页 6 张主卡片在紧凑尺寸中过早堆叠、挤出首屏的问题。
- 保持启动后 Wallpaper 银河背景干净显示，播放后切换到 Emily / 默认播放态视觉。

## v0.9.13

- 开场动画升级为 WebGL 光流线场，融合 `ShipSwiftAnimatedLoop` 的 RGB 分通道、Warp 流动和高亮线场质感。
- 移除刻意的环形/花瓣式爆点，改为更自然的斜向流线相位变化，让启动过程更帅气但不突兀。
- 开场动画播放完成后不再自动进入主页，会停留在“点击进入”状态；点击任意位置或按 Enter/空格后进入 Home。
- 保留 2D canvas fallback，WebGL 不可用时仍能显示启动页。
- 生成 `0.9.12 -> 0.9.13` 快速补丁，用于已安装用户轻量更新。

## v0.9.9

- 统一当前版本号为 `0.9.9`
- 接入 GitHub Releases 更新检测配置
- 增加更新弹窗与更新下载任务接口
- 增加 QQ 音乐与网易云音乐双平台体验方向
- 优化电影镜头节奏分析与 DJ 视觉模式
- 增加自定义封面、自定义歌词、歌词布局和视觉控制相关能力

## 说明

这是首次公开发布前的整理版本。更早版本属于本地迭代记录，暂不展开。
