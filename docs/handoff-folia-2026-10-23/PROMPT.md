# 交接提示词：Mineradio × Folia 可视化移植（含待重做的上传行 UI）

> 直接把本文件全文粘给接手的 AI 即可。代码在同级 `code/` 与 `harness/` 目录。

---

## 0. 一句话说清任务

Mineradio 是一个 Electron 桌面音乐播放器（原生 JS，无前端框架）。我正在把开源项目 **Folia**
的「歌词可视化 / 动态背景」模块整体移植进来，做成播放器右侧可切换的视觉样式。
**14 个可视化模式 + 7 个背景壳层已移植完并全量回归通过**，剩下两块功能没收口，
以及**一个上传控件被用户连判两次「丑」，需要你重做**。

---

## 1. 硬约束（改代码前必读，违反会直接坏）

1. **无构建链路**。纯原生 JS + 手写 CSS，没有 webpack/vite/TS/React，没有 npm 依赖安装步骤。
   每个源文件都是一个立即执行脚本，向全局挂函数（如 `foliaBuildTuningPanel`、
   `registerFoliaMode`）。不要引入模块化语法（`import`/`export`）、不要加打包工具。
2. **模块加载靠顺序**。`public/js/index-loader.js` 里按依赖顺序列了 59 个 `12-folia/*.js`。
   新增文件必须插进这个清单的正确位置，否则运行时函数未定义。
3. **改完要同步产物**：`node scripts/sync-dist-app.js`（把 `public/` 同步到
   `dist/Mineradio/resources/app`，当前 431 个文件）。exe 冒烟跑的是同步后的产物。
4. **换行符不统一，且是硬坑**：
   - 纯 LF：`0l-folia-tuning-panel.js`、`00b-folia-image-pool.js`、`smoke-folia-image-pool.js`
   - 纯 CRLF：`0l1-folia-mode-panels.js`、`smoke-folia-tuning-bg-panels.js`
   用脚本做替换前先归一（`text.replace(/\r\n/g,'\n')` 再按需还原），否则锚点永远匹配不到、
   断言 `count == 0` 报错。用编辑器直接改则无此问题。
5. **类名是契约**。面板结构类（`fx-folia-tuning-row` / `-head` / `-label` / `-value` / `-pill` /
   `-pills`）被冒烟断言按类名收集，随手加/改类名会让断言误判。尤其
   **不要**给容器挂 `fx-folia-tuning-pills` —— 它会被当成「一个空键的调参组」，直接打红
   「药丸组顺序」断言。
6. **判据不许为了让测试变绿而改**。断言写的是上游 Folia 的真实语义（含文案逐字），
   改代码去满足断言，不许改断言去迁就代码。

---

## 2. 目录与关键文件

```
public/js/index-loader.js                 模块加载顺序（12-folia 段 59 个文件）
public/js/modules/12-folia/
  00-folia-state.js                       全局状态 + 存档（localStorage）
  00b-folia-image-pool.js                 图片池（IndexedDB，五个与 Folia 同名的键）
  01-folia-mode-registry.js               模式/背景注册表
  01a..01g-folia-bg-*.js                  7 个背景壳层
  0l-folia-tuning-panel.js                调参面板主体（滑块/开关/药丸/上传行都在这里）
  0l1-folia-mode-panels.js                莫奈/其他模式的样式面板
  0x-folia-mode-*.js                      各可视化模式
public/css/12-folia/folia-world.css       全部样式（约 2340 行，上传行在文件末尾）
scripts/sync-dist-app.js                  同步到 dist
```

---

## 3. 已完成的部分（不要重写）

- **14 个模式**：still / classic / partita / tilt / claddagh / cappella / cadenza / fume /
  monet / pendolo / diorama / sonnet / tempera / lumiere
- **7 个背景**：sora / common / latent / monet / noise-texture / nomand / url
- **调参面板**：滑块（拖动只改内存、松手落盘+重建）、开关（点击即落盘+重建+刷新面板）、
  分段药丸、条件渲染（disabledWhen）、折叠组、嵌入列表增删改
- **图片池**：IndexedDB 库 `mineradio-folia-assets` / store `assets`，五个键与 Folia 逐字同名：
  `monet_background_image` / `monet_portrait_image` / `cappella_custom_avatar` /
  `cappella_custom_emoji` / `tempera_layer_images`。单图槽的上传/清空/来源切换已接完
  （莫奈背景、漫游背景、莫奈肖像三处）。

---

## 4. 待办

### A（最高优先）重做「自定义图上传行」的布局 —— 用户已两次判「丑」

**位置**：`public/js/modules/12-folia/0l-folia-tuning-panel.js` 的
`foliaBuildAssetUploadRow(key, opts)`，样式在 `folia-world.css` 文件末尾
`/* ---------- 自定义图上传行 … */` 段。

**现在的实现（v2，仍被判丑）**：

```
图片文件                                    ← 头行只有标签
┌──────────────────────────────────────────┐
│ [22px缩略图] 文件名…        [上传][清空]  │  ← 一条圆角「字段」框
└──────────────────────────────────────────┘
```

结构：`row.fx-folia-tuning-row.fx-folia-asset` → `head.fx-folia-tuning-head`（仅标签）
＋ `field.fx-folia-asset-field`（缩略图 + 文件名 + 两粒药丸）＋ 视觉隐藏的 `input[type=file]`。
空态缩略图是虚线「+」占位。

**用户原话**：「把你这些难看的UI修改一下，最好统一播放器的风格」→ 改完仍不满意 →
「重新设计，调整布局，好丑啊」。

**你要做的**：在**不改变行为与类名契约**的前提下重做视觉与布局。可自由发挥，但必须满足：

1. 与面板其它控件同节奏（面板里既有控件是：`label` 左 + `value` 右的滑块行、药丸组行、
   开关行）。参考同面板现有行的间距和字号，不要另起一套尺寸。
2. 按钮必须复用 `.fx-folia-tuning-pill`（`padding:4px 9px; font-size:10px; border-radius:999px`），
   主动作只加 `.is-primary`（`rgba(214,248,255,.42)` 描边 / `.08` 底），
   **必须比选中态 `.active` 更弱**。
3. 无图态不许出现裸 `-`，用「未选择」这类文案 + 压暗；禁用态只能来自 `:disabled`
   （`.fx-folia-tuning-pill:disabled { opacity:.4; cursor:not-allowed }` 已存在），
   不许手写 `is-disabled` 之类假类。
4. 必须保留这些 DOM 钩子，否则冒烟全红：
   - `[data-folia-asset-key]` / `[data-folia-asset-scope]` 在行根
   - `[data-folia-asset-upload]` / `[data-folia-asset-clear]`（必须是 `<button>`）
   - `[data-folia-asset-name]`（文件名/反馈文案的元素）
   - `[data-folia-asset-input]`（`<input type=file>`，必须留在 DOM 里，视觉隐藏而非 `display:none`）
   - `[data-folia-asset-thumb]`（缩略图槽位；有图是 `<img src=blob:>`，无图是带 `is-empty` 类的元素）
   - 类名 `fx-folia-asset` / `fx-folia-asset-name` / `fx-folia-asset-thumb` 被断言直接查
5. 三个调用点共用同一个构造函数（莫奈背景 / 漫游背景 / 莫奈肖像），改一处三处生效。

**参考实现**（上游 Folia，React）：`settingsPanels.tsx` 的
`MonetBackgroundSettingsCard` / `NomandBackgroundSettingsCard` / `MonetSettingsPanel`，
以及 `visualizerImageAsset.ts`（键名与校验）。

### B cappella 多图池（群唱自定义头像 / 表情包）

上游 `settingsPanels.tsx:558-790`，约 230 行：预览五格 + 张数统计 + 追加 + 清空。
池侧 API 已就绪（`foliaAssetPutFiles` / `foliaAssetClear(key, id)`），**只差界面**。

### C tempera 画布图片

上游 `TemperaImageLayerDialog`（370 行）+ `TemperaImageLayerControls`（506 行）：
多图 + 放置参数 + 弹窗。同样只有界面没做。

---

## 5. 验收（三环，必须全绿，缺一不可）

在仓库根目录执行（Node 用本机 `node` 即可）：

```bash
# 1) 纯逻辑：Node vm 沙箱 + 自造 DOM 桩，加载真实模块跑断言（不需要 Electron）
node .workbuddy/harness/smoke-folia-tuning-bg-panels.js
#    期望末行：ALL PASS (345 项)

# 2) exe 端到端：拉起打包好的 Electron，CDP 驱动真实页面（需先 sync-dist-app.js 且本机已构建 dist）
node .workbuddy/harness/run-exe-smoke.js smoke-folia-image-pool.js
#    期望末行：[exe] ALL PASS (33 项)

# 3) 突变测试：故意改坏源码，确认断言能抓到（防「断言恒真」）
node .workbuddy/harness/mutate-folia-image-pool.js
#    期望末行：15/15 个突变被拦住；还原后 smoke 恢复全过；仓库 零改动

# 4) 全量回归（18 条 exe 脚本，约 4 分钟）
sh .workbuddy/harness/run-folia-exe-all.sh
#    期望：18 行 ALL PASS，末行 transport-retry 次数: 0
```

**批跑假红的判定（已踩过三次，不要误判成回归）**：某条 `TIMEOUT` 且日志里
`^PASS |^FAIL ` 零命中，或日志含 `cdp timeout` / `Cannot find default execution context`，
或断言值出现逻辑上不可能的组合（例如读到比当前更晚写入的值、元素高度为 0），
说明 CDP 执行上下文没就绪 / eval 乱序，**整轮结果作废**，单跑必过。
`run-folia-exe-all.sh` 已内置「仅传输层故障才重试一次、有 FAIL 断言行立即判红」的规则。

**取证图**：`node .workbuddy/harness/shot-folia-image-pool.js` 会输出三张
`.workbuddy/preview/folia-image-pool-{empty,uploaded,portrait}.png`。
改完 UI **必须自己看图**再交付 —— 之前两版都是断言全绿但看着丑。

---

## 6. 已知坑清单（都是实际踩过的）

| 现象 | 根因 | 处理 |
|---|---|---|
| 断言 `count == 0`，替换锚点找不到 | 文件是 CRLF，脚本按 `\n` 写锚点 | 先归一换行 |
| 「药丸组顺序」断言多出一个空键 | 容器挂了 `fx-folia-tuning-pills` | 容器另起类名 |
| 三张取证图都叫 `[object Object].png` | `shot(app, name)` 少写一个参数 | 签名带 app |
| 取证脚本 `scroll {"__missing":true}` | 选择器写 `[data-folia-asset]`（不存在这个裸属性） | 用 `.fx-folia-asset` |
| 面板不跟着图片池刷新 | 面板只在「切背景/切模式」时重建 | 清池要在切换之前做 |
| 同一句成功文案串到别的面板 | 反馈按 key 存，但背景槽被两个面板共用 | 反馈按 scope 分桶存 |
| 上传行占位显示 `-` | 照抄上游 Folia 的裸 `-`，在深色面板里像渲染坏了 | 本地化成「未选择」 |
| 药丸在无资源时点了没反应却看着能点 | `.fx-folia-tuning-pill:disabled` 根本没写 | 补齐 `:disabled` 样式 |
| 折叠态视觉判断失效 | 只查 class 不查样式 | 折叠/展开断言必须查 `getComputedStyle().display` |

---

## 7. 交付纪律

- 只改 `public/` 与 `public/js/index-loader.js`，不要动 `dist/`（它由脚本生成）。
- 不要新增第三方依赖、不要引入构建步骤、不要重命名已有全局函数。
- 每改一处 UI，必须自己看取证图；断言全绿 ≠ 好看。
- 报告请写清：改了什么文件、为什么这样改、验证跑了哪几条（贴末行输出）。
