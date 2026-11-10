# 交接文档 — Mineradio 的 Folia「凝彩（tempera）」模式移植

> 读者：接手的另一个 AI。这份文档只写**事实、契约、判据、命令**。凡是本文写「必须」，都是踩过坑换来的，
> 不要用更「合理」的做法替换。
>
> 交接时间：2026-10-21。仓库：`D:/Mineradio/Mineradio-Kugou-Modified-main`（下称 `ROOT`）。

---

## 0. 一句话现状

Mineradio（Electron 音乐播放器）要把上游项目 Folia 的 13 个可视化歌词模式逐个移植进自己的 `12-folia` 世界。
**已完成 12 个**（still / classic / cadenza / partita / tilt / claddagh / cappella / fume / monet / pendolo / sonnet / diorama）。
**正在做 `tempera`（凝彩，order 20）**：图库层、节目层、构图层三块已就位并通过全部闸门，**模式尚未注册**。
剩下 `lumiere`（绘光，order 25）没开始。

你要做的第一件事：把 tempera 剩下的渲染层搬完并注册。第三章给了逐文件清单。

---

## 1. 这个项目怎么跑

- 用户实际运行的是打包产物：`dist/Mineradio/Mineradio.exe`，页面从
  `dist/Mineradio/resources/app/public/**` 加载。
- **只改 `ROOT/public/`**，然后 `node scripts/sync-dist-app.js`（当前 `synced 399 files`）。
  直接改 `dist/` 会在下次同步时被覆盖；只改仓库根不 sync 则 exe 里看不到，**用例会假绿**。
- 前端是「125+ 个 js 模块合并成同一个 script」的架构（`public/js/index-loader.js` 列出加载顺序），
  不是 ESM。**没有 import/export，全靠 `window` 上的对象和全局函数名**。

---

## 2. 铁律（违反会以「功能半死但报错指向别处」的形式惩罚你）

1. **顶层未捕获异常会带走它之后的所有模块**（只剩被提升的 `function` 声明）。
   新增顶层重活（WebGL、fetch、DOM 查询）必须 try/catch 或懒加载。
   开屏曾经因为 `new THREE.WebGLRenderer` throw 而卡 100%。
2. **同名 `function` 后声明者胜出**（当前 72 组重名）。新增顶层函数前先跑
   `node .workbuddy/harness/scan-dup-defs.js`，判据是**相关重名数 0**。
   新符号一律带模式前缀（`tempera` / `folia`）。
3. 每个改过的文件都要单独 `node --check <file>`。不要只信汇总脚本。
4. 用例跑之前必须 `sync-dist`，且 exe 进程必须 `env -u ELECTRON_RUN_AS_NODE`
   （本机该变量常驻 `=1`，会让 Electron 退化成纯 node）。
5. **闸门写完必须证明它拦得住**：临时把实现改坏 → 看到 `FAIL`/`BLOCKED` → 还原。
   没做过突变的判据视为不存在。每个 mode 目录下都有 `mutate-*.js` 可照抄。
6. 名字 / 描述 / order **只许抄 Folia 权威值**，不许自起中文名（见 §6）。
7. 不新增无关功能、不改无关代码。移植 = 逐字搬，`node --check` + 判据化冒烟，不是「重写一遍」。

---

## 3. tempera 现状与剩余工作

### 3.1 已就位的三个模块（都挂在 `window` 上，都是裸脚本 IIFE）

| 文件（`public/js/modules/12-folia/`） | 行数 | 全局名 | 键数 | 内容 |
|---|---|---|---|---|
| `0h-folia-tempera-mg.js` | 1142 | `foliaTemperaMg` | 44 | 散列 / 颜色 / 调色板 / 网点 / 曲线 / Graphics 工厂 |
| `0h-folia-mode-tempera.js` | 1673 | `foliaTemperaProgram` | 24 | 枚举 + 121 项 shot profile + 节目编译（段落/shot/相机/桥段/装饰） |
| `0h-folia-tempera-compositions.js` | 2926 | `foliaTemperaCompositions` | 21 | 13 族 121 种 kind 的绘制函数 + 共享叠加层 |

`index-loader.js` 里的顺序（在 `12-folia` 段，`0g-folia-mode-sonnet.js` 之后、
`03-folia-world-runtime.js` 之前）：

```
'js/modules/12-folia/0h-folia-tempera-mg.js',
'js/modules/12-folia/0h-folia-mode-tempera.js',
'js/modules/12-folia/0h-folia-tempera-compositions.js',
```

依赖是单向的：`mg` ← `program` ← `compositions`。三个文件开头都有
`var mg = window.foliaTemperaMg; if (!mg) return;` 这类先决判断，缺一个就整块不自挂。

### 3.2 你要搬的下一批（按依赖顺序，行数为 Folia 源）

源目录：`D:/Mineradio/folia-major-main/folia-major-main/src/components/visualizer/tempera/`

| 顺序 | 文件 | 行数 | 说明 / 不要踩的地方 |
|---|---|---|---|
| 1 | `temperaMotion.ts` + `temperaMotionEasing.ts` | 143 + 48 | `clamp01` / `resolveShotPacedDuration` / `easeTemperaEnter` / `easeTemperaInOut`。全项目共用，先搬 |
| 2 | `temperaBlocks.ts` | 168 | **它构造 composition ctx**（`add` / `createGroup` / `bleed` / `gradient`）。`bleed = carry + max(w,h)*0.08`，`carry = max(w,h)*0.09`。`add` 的 delay/span 是 shot 时长比例，这里才换成秒 |
| 3 | `temperaMeasure.ts` / `temperaLayout.ts` / `temperaTextView.ts` | 133 / 376 / 207 | 排版与逐字视图；`temperaLayout` 只用 shot profile 里的 region 数据，不许自己算版式 |
| 4 | `temperaSceneBuilder.ts` | 616 | 把编译好的 shot 变成 pixi 场景树（blocks + text + image + credits + overlay 的组合） |
| 5 | `temperaShotFrame.ts` / `temperaSceneFrame.ts` | 124 / 114 | 单 shot 的取景与整场的取景（相机 key 插值） |
| 6 | `temperaCamera.ts` / `temperaTransitions.ts` | 67 / 117 | 相机 = `buildCameraKeys` 出来的 key 之间插值；转场 3 种：`block-wipe` / `camera-pan` / `shape-carry` |
| 7 | `temperaSceneFilters.ts` + `temperaDifferenceFilter.ts` | 95 + 175 | 反色（difference）滤镜。**读的是 pixi 渲染目标**，DOM 背景在 WebGL 外面，所以字不能压在洞上 |
| 8 | `temperaCreditsLayer.ts` / `temperaOverlay.ts` | 138 / 93 | 片尾与叠加层 |
| 9 | `temperaImageLayer.ts` + `temperaImageTextures.ts` | 175 + 76 | 用户图片层；纹理预算与销毁要照抄 |
| 10 | `createTemperaPixiRuntime.ts` | 651 | pixi Application 的建立/尺寸/后台帧/销毁。**这是宿主的核心** |
| 11 | `VisualizerTempera.tsx` | 291 | React 组件 → 改写成 `registerFoliaMode('tempera', {...})`（模板见 §5） |
| 12 | `types.ts` 里的 `DEFAULT_TEMPERA_TUNING` | 21 项 | 先写死这一份，调参 UI 最后做。值见 §7 |

`temperaEnterStyles.ts`（118）/ `temperaDialogTokens.ts`（77）/ `Tempera*Dialog.tsx` 是调参 UI 的一部分，
**这一轮不做**，等画面能跑起来再说。

### 3.3 已知的落地约束

- **`render` 故意不带 seed key**：tempera 换歌就地交接，重挂会丢 WebGL 上下文（sonnet 的教训）。
- 世界开着时原生歌词管道按设计冻结；断言前先 `foliaWorldExit`，否则 LINECOUNT 结果无意义。
- exe 窗口被限帧（600ms 内 rAF 只有 5~22 帧），一切「等下一帧」的断言必须**轮询**，不能定长 `sleep`。

---

## 4. 三块已就位模块的契约（你写渲染层要用的）

### 4.1 `foliaTemperaMg`（44 键）

```
hashSeed / mixSeed / hash01 / chooseWithoutRepeat            ← 确定性散列（换歌可复现）
colorWithAlpha / parseColorChannels / mixColors              ← 颜色
TONE_STOPS / resolvePalette / paletteLuminance               ← 调色板（mono|duo|gradient）
buildHatchSpec / rectPolygon / circlePolygon / diamondPolygon / buildHatchLines
buildScribblePath / buildWavyPath / buildCrossRow / buildDotRow / buildDotGrid / buildCrossingLines
ellipsePolygon / roundedRectPolygon / rotatePolygon / lobedPolygon / scallopBandPolygon
heartPolygon / annularSectorPolygon / starPolygon / arcRibbonPolygon / buildDiscField
toPixiColor / destroyGradientFills
drawPolygonFill / drawPolygonFillWithHoles / drawPolygonOutline / drawHatchFill
drawDiscs / drawRings / drawLines / drawPolyline
drawConcentricDiamonds / drawCrossMarks / drawSquareMarks
```

关键判据（都在 `smoke-folia-tempera-logic.js` 里钉死，别改）：
- 多边形一律**扁平数组** `[x1,y1,x2,y2,…]`，与 `ctx.poly()` 同形。
- `buildHatchLines` 只对**凸**多边形成立（按边半平面裁剪）；半程上限 320 → 最多 321 条。
- 带洞节点在真 pixi 8 里只有**一条 fill 指令**（`cut()` 折叠进路径），不是三条。
- `drawDiscs` 的 pivot = 圆场包围盒中心；`drawRings` 同理，所以 `drift` 是原地呼吸不是绕原点公转。
- 调色板 `gradient` 只在 `colorMode === 'gradient'` 时非 null。

### 4.2 `foliaTemperaProgram`（24 键）

```
SHOT_KINDS(121) / TRANSITION_KINDS(3) / DECOR_MOTIFS(5) / SHOT_PROFILES(121)
resolveShotProfile(kind) / resolveShotCandidates(moods)
buildEvenGraphemeTimings / buildWordGraphemeTimings / findGraphemeSequence / buildLineGraphemeTimeline
buildSegments / resolveParagraphGapThreshold / splitOversizedDraft / classifyParagraph
buildDecorFragments / buildDecorWatermark / buildDecorSpec
resolveFlowAngle / buildCameraKeys
buildShotChunks / buildShots / buildBridgeShots
compileProgram(lines, seed) / findParagraphIndexAtTime
```

- `compileProgram(lines, seed)` → `{ version:1, seed, paragraphGapThreshold, paragraphs[] }`，
  每个 paragraph 有 `lines / shots / transitionOut`，每个 shot 有
  `{ kind, startTime, endTime, lyricEndTime, slices, isBridge, camera, cameraEnd, flowAngle, decor }`。
- **`shot.endTime` 铺满到下一个 `startTime`；`lyricEndTime` 故意不铺**。凡是按字速排的动效（block 入场、
  图片入场）必须用 `lyricEndTime`，否则图形会晚于字落地。
- 项目侧的 `lines` 形状是 `{startTime, endTime, fullText, translation, words:[{text,startTime,endTime}]}`，
  **没有** `syllables / blockIndex / songPart / isChorus` → `metadataChanged` 恒 false，
  chorus/break 段落分支永不命中，末段必为 `outro`。这是上游数据形状差异，不是 bug。
- `resolveShotProfile(kind)` 返回 `{ region, enter, camera, mood, sharedDecor? }`；
  `sharedDecor === false` 的只有 5 张 monogatari 间奏卡。

### 4.3 `foliaTemperaCompositions`（21 键）

```
FAMILY_KEYS(13) / FAMILIES / COMPOSITIONS(121) / KIND_COUNT / resolve(kind) / draw(ctx)
fieldPolygon / addCutField / addHoleLip / axisRect / channelAxis / acrossFlow / acrossPoint
flowPoint / flowSpan
addMass / addGround / addFaceRuling / addSurveyLines / addCornerTicks / addWireTrace
```

`draw(ctx)` 的 ctx 契约（**`temperaBlocks` 负责造它，你搬的时候照抄这份形状**）：

```
{ pixi, kind, palette, decor, width, height, seed, showDecor, bleed, flowAngle, gradient,
  add(node, options?, parent?), createGroup(rotation, x, y) }
```

`options = { alpha?, enterDX?, enterDY?, delay?, span?, drift?, grow? }`；
`delay / span` 是 **shot 时长的比例**（0~1 与 (0,1]），由 blocks 换成秒。
带 `drift` 的节点绕**自身原点**缩放/旋转 → 偏心形状必须放进 `createGroup` 的局部坐标。

判据（`smoke-folia-tempera-compositions.js`）：
- 打洞只出现在 aperture / signal / corridor / monolith / terrain 五族，**恰好 31 种 kind**。
- cutout 族的槽必须与 `flowAngle` 平行；`channelAxis` 把 flowAngle 拉回一半到竖直轴。
- cutout 族**字不压在洞上**：洞是真透明（pixi `backgroundAlpha: 0`），反色滤镜看不见 DOM 背景。
- 全片形状必须越出视口 `bleed`，否则整体滑动时露背景。

---

## 5. 怎么注册一个模式（模板）

`01-folia-mode-registry.js` 的契约：

```
registerFoliaMode(id, { name, desc, order, needsWebGL2?, create(host, ctx) -> instance|Promise, tick(inst, ctx)?, destroy(inst)? })
```

- `host` 是运行时造的 `<div class="folia-mode-host" data-folia-mode="id">`，挂在 `#folia-world-root` 下；
  运行时会给实例写 `inst.__host`，`destroy` 里**不要**自己删 host（运行时删）。
- `create` 允许返回 Promise（异步建 pixi 需要）；期间实例是 `__pending` 占位、`tick` 跳过。
- `ctx` 由运行时每帧构造：`{ now, dt, time, index, lines, theme, audio, paused, showText, showTranslation, fontScale }`。
  模式只读，不改。

现成模板：`public/js/modules/12-folia/0g-folia-mode-sonnet.js:6057`（同样是 pixi 模式，同样有纹理池与 destroy 清理）。

tempera 的注册值（**逐字抄，不许改**）：

```js
registerFoliaMode('tempera', {
  name: '凝彩',
  desc: '成片的色块与细密网点缓缓重组，歌词压过颜色时翻出反色',
  order: 20,
  create: temperaCreate,
  tick: temperaTick,
  destroy: temperaDestroy
});
```

---

## 6. 权威值来源（改名字/描述/order 前必须核这三处）

Folia 源：`D:/Mineradio/folia-major-main/folia-major-main/src/`
1. `i18n` 里的 `ui.visualizerTempera` → 名字「凝彩」
2. `pickerDescription.visualizer.tempera` → 描述（见 §5）
3. `components/visualizer/tempera/entry.tsx` 的 `order: 20`、`previewSeed: 'tempera'`、
   `usesWordSegmentation: true`、`render` 不带 seed key

闸门：`node .workbuddy/harness/verify-folia-meta.js` → 现在输出
`已注册 12 个模式，元数据不匹配 0 个 / 待移植：tempera(20) / lumiere(25) / META OK`。
注册 tempera 后这行应该变成 13 个模式 + 只剩 lumiere。

---

## 7. 直接抄：`DEFAULT_TEMPERA_TUNING`（21 项，来自 Folia `types.ts:674`）

```js
{
  cameraIntensity: 1,
  glyphMotion: 1,
  wholeLineLyrics: false,
  glyphSettleStretch: 0.5,
  colorMode: 'duo',            // 'mono' | 'duo' | 'gradient'
  showBlocks: true,
  showDecor: true,
  showCornerMarks: true,
  textInversion: true,
  layerImages: [],
  layerImageDepth: 'back',
  layerImageFrequency: 0.6,
  enableTransitions: true,
  textureResolution: 1.5,
  postProcessEnabled: true,
  postProcessTextureCompression: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3
}
```

---

## 8. 命令清单（全部在 `ROOT` 下跑）

### 日常闸门

```bash
node .workbuddy/harness/verify-folia-meta.js          # 元数据（名字/描述/order）
node .workbuddy/harness/scan-dup-defs.js              # 顶层重名（当前 72 组，不许变多）
node .workbuddy/harness/smoke-folia-tempera-logic.js        # 图库层 139 项
node .workbuddy/harness/smoke-folia-tempera-program.js      # 节目层 92 项
node .workbuddy/harness/smoke-folia-tempera-compositions.js  # 构图层 45 项
node .workbuddy/harness/smoke-folia-sonnet-logic.js         # 回归：别把 sonnet 弄坏（145 项）
```

### 突变自证（证明判据拦得住）

```bash
node .workbuddy/harness/mutate-folia-tempera-logic.js         # 8 个
node .workbuddy/harness/mutate-folia-tempera-program.js       # 8 个
node .workbuddy/harness/mutate-folia-tempera-compositions.js  # 10 个
node .workbuddy/harness/mutate-folia-tempera.js               # exe 侧 3 个（每轮 sync + 起 exe，约 2 分钟）
```

### exe 侧（真 Electron + 真 PIXI 8.21）

```bash
node scripts/sync-dist-app.js                                  # 必须先跑
env -u ELECTRON_RUN_AS_NODE node .workbuddy/harness/smoke-folia-tempera.js
```

- 当前 40 项 ALL PASS（端口 9479；sonnet 用 9478）。
- **结论看 stdout 的 `ALL PASS (n 项)`，不要看 shell 退出码**：脚本打印完结论后进程不会自己退出
  （Electron 孙子进程还挂着 ws），bash 会报 `SIGTERM` / `EXIT=1`。
- 想在自己的脚本里调它：`spawn` + **文件 fd** 接 stdout/stderr（管道会被孙子进程继承 → `spawnSync` 卡死），
  轮询日志里的收尾行拿到结论后 `child.kill('SIGKILL')` + `taskkill /F /IM Mineradio.exe`。
  现成实现：`.workbuddy/harness/mutate-folia-tempera.js` 的 `runSmoke()`。
- 在 bash 里写 `taskkill /IM ...` 会被 Git Bash 改写成路径（报「无效参数/选项」）。用 PowerShell 或 node 里 `execSync`。

### 重新生成构图层（改过抽取脚本才需要）

```bash
node .workbuddy/tmp/extract-tempera-compositions.js
```

它会从 Folia TS 源机械删类型，**直接覆盖** `public/js/modules/12-folia/0h-folia-tempera-compositions.js`。
脚本自带三道校验：token 多重集对比（基线=源删掉 import/interface/type 块之后，只准少类型 token，
少一个 `ctx`/`add` 就报错）、`node --check`、残留类型扫描。产物行数 2926，删掉 234 处标注。

---

## 9. 移植手法（本项目已验证，别自创）

1. **旧版模式**（still/…/pendolo）是手写移植，可以参照但不要照抄风格。
2. **新版大文件模式**（sonnet/tempera）走「脚本抽取 + token 校验」：
   读 Folia TS → 机械删 `import` / `interface` / `type` 块 / 类型标注 / `as const` → 包一层 IIFE
   → 把 `window.foliaXxx` 作为唯一出口。
   校验比人眼 diff 可靠：把源和产物都切成 token 序列做**多重集差**，差集里出现任何代码标识符就是删错了。
3. 每个族/模块**各自一个 IIFE**：TS 靠「一文件一模块」隔离同名局部函数（例如 `addField` 在
   charm / signal / monogatari 三个族里重名），合并 script 里只能靠函数作用域。
4. 对象展开 `{...a, b}` 写成 `Object.assign({}, a, { b })`；其余语法照抄（`??`、箭头函数都可以用）。
5. 依赖改成「先决判断 + 局部别名」：
   `var mg = window.foliaTemperaMg; if (!mg) return; var hash01 = mg.hash01;`

---

## 10. 判据怎么写（这几条都是被真事打出来的）

- **判据必须落在阈值边界附近**。例：ink 对比度下限 96，测试主题本来就有 190 → 把下限改成 10 也拦不住；
  要补「浅主色 + 浅背景」这种贴边的用例。
- **判据要写「集合相等」而不是「不少于」**。例：打洞的 kind 数写 `>= 34` 就错了（真值 31），
  正确做法是静态推导出 31 个 kind 的**名字集合**，与运行时的集合逐字比。
- **别拿开关当判据**。例：`sharedDecor:false` 的五张卡，判据不是「showDecor 开关无效」
  （它们自己的 drawer 也会按 showDecor 分支），而是「`draw()` 的结果与直接调 drawer 完全一致」。
- **fixture 不能让判据天然成立**。例：验证「shot 铺满时间轴」时，如果词的 `endTime` 首尾相接，
  铺满在错误实现下也成立 → fixture 必须给词间留白（时长 ×0.62）。
- **文件名/fixture 的长度、次数都要从数据里算**，不要写死下标（`tl2[5]` 曾在 5 字行上直接 undefined）。
- 断言失败信息要带**实际值**（`:: 190.1` / `:: instructions=1`），否则下次排查看不出差在哪。

---

## 11. 交接时不要做的事

- 不要给「建议清单 / 选项菜单」。要做就直接做完并给结论。
- 不要交付「近似实现」再解释。做不到就**说清是哪一种墙挡着**（数据形状？渲染能力？性能？）。
- 不要动 `dist/` 里手改的东西（会被 sync 覆盖），也不要跳过 sync 就跑 exe 用例。
- 不要为了让用例通过而放宽判据；先确认实现对不对，再改判据并在注释里写清「为什么原来那条是错的」。
- 不要在 `12-folia` 之外的文件里加 tempera 的东西（除了 `index-loader.js` 的三行与注册调用）。
- 不要自己重命名 Folia 的 kind / motif / transition 常量（`duo-split`、`monogatari-flash`、
  `block-wipe`、`hatch-twin` 这些字符串是数据表 key，改了整套 profile 就对不上）。

---

## 12. 术语表

| 词 | 含义 |
|---|---|
| shot | 一个镜头。段落被切成若干个 shot，每个 shot 一种构图 `kind`，首尾相接铺满该段落 |
| kind | 构图类型，121 种，如 `duo-split` / `iris-hole` / `monogatari-card` |
| 族（family） | 13 个绘制族，按构图气质分类（split / band / frame / poster / sparse / cinema / charm / aperture / signal / corridor / monolith / terrain / monogatari） |
| bridge shot | 段间乐器空档补的空镜（≥1.2s 才补，最多 3 个，每个 ≤5s，情绪只用 quiet/neutral） |
| decor | 编译期定死的装饰描述：`{ motif, hatchAngle, crossCount, scribbleSeed, fragments, watermark }` |
| flowAngle | 整张 shot 的漂移方向；构图槽位、相机、交接都对齐它 |
| bleed | 全片形状必须越出视口的余量 |
| MG 层 | 「网点/版画」绘制层（screentone），即 compositions 这一层 |
| 反色（difference） | 字压过色块时翻成反色的滤镜；读 pixi 渲染目标，所以洞（真透明）上会失效 |

---

## 13. 交接检查单（你接手的第一个小时该跑什么）

```bash
cd D:/Mineradio/Mineradio-Kugou-Modified-main

node .workbuddy/harness/verify-folia-meta.js                  # 期望：META OK，待移植 tempera(20) / lumiere(25)
node .workbuddy/harness/scan-dup-defs.js | head -1            # 期望：扫描 153 个模块，重名 72 组
node .workbuddy/harness/smoke-folia-tempera-logic.js | tail -1        # ALL PASS (139 项)
node .workbuddy/harness/smoke-folia-tempera-program.js | tail -1      # ALL PASS (92 项)
node .workbuddy/harness/smoke-folia-tempera-compositions.js | tail -1 # ALL PASS (45 项)
node .workbuddy/harness/smoke-folia-sonnet-logic.js | tail -1         # ALL PASS (145 项)

node scripts/sync-dist-app.js                                 # synced 399 files
env -u ELECTRON_RUN_AS_NODE node .workbuddy/harness/smoke-folia-tempera.js | tail -3
                                                              # ALL PASS (40 项)
```

全绿 = 起点正确，可以开始搬 `temperaMotion` → `temperaBlocks`。
任何一条不绿，先修绿再动新代码：**基线不绿时做的任何改动都无法归因**。
