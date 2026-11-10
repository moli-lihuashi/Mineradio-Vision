# 交接包说明（2026-10-23）

给接手方（人或 AI）的最小可用材料。**先读 `PROMPT.md`**，本文件只说明包里有什么。

## 一、怎么用

1. 把 `PROMPT.md` 全文粘给接手的 AI，附上本目录（或整个 zip）。
2. 把 `code/full-12-folia/` 覆盖到目标仓库的 `public/js/modules/12-folia/`，
   `code/folia-world.css` 覆盖到 `public/css/12-folia/folia-world.css`。
3. `code/index-loader.js` 是模块加载清单，覆盖到 `public/js/index-loader.js`
   （里面按依赖顺序登记了 59 个 Folia 模块）。
4. `harness/` 覆盖到 `.workbuddy/harness/`，用于跑验收。

## 二、包内容

```
PROMPT.md                       交接提示词（自包含，直接粘给 AI）
README.md                       本文件

code/
  0l-folia-tuning-panel.js      ★ 上传行所在文件（foliaBuildAssetUploadRow，约 570-690 行）
  0l1-folia-mode-panels.js      莫奈样式面板（肖像上传行的调用点）
  00b-folia-image-pool.js       图片池（IndexedDB，五个与上游同名的键）
  folia-world.css               ★ 上传行样式在文件末尾「自定义图上传行」注释段
  index-loader.js               模块加载顺序（59 个 12-folia 文件）
  full-12-folia/                12-folia 全部 59 个模块的完整副本

harness/
  smoke-folia-tuning-bg-panels.js   纯逻辑冒烟（Node vm + DOM 桩，345 项，零外部依赖）
  smoke-folia-image-pool.js         exe 端到端冒烟（真 IndexedDB / 真选文件，33 项）
  mutate-folia-image-pool.js        突变测试（15 条，验证断言不是恒真）
  shot-folia-image-pool.js          取证截图（三张，改完 UI 必须自己看）
  run-exe-smoke.js                  exe 冒烟入口
  cdp-client.js                     CDP 客户端（run-exe-smoke 依赖）
  run-folia-exe-all.sh              18 条全量回归
```

## 三、环境要求

- Node（本机验证用的是 v24 / v22 均可，无 npm 依赖）。
- `exe` 类脚本（`run-exe-smoke.js` / `shot-*.js`）需要**已构建的桌面包**：
  `dist/Mineradio/Mineradio.exe`。仓库里没有直接分发这个产物，需要先按项目 README 构建。
- 纯逻辑冒烟不需要 Electron，任何环境都能跑，适合快速迭代。

## 四、常用命令（仓库根目录）

```bash
node scripts/sync-dist-app.js                                  # public/ → dist（431 文件）
node .workbuddy/harness/smoke-folia-tuning-bg-panels.js        # 345 项
node .workbuddy/harness/run-exe-smoke.js smoke-folia-image-pool.js   # 33 项
node .workbuddy/harness/mutate-folia-image-pool.js             # 15/15 BLOCKED
node .workbuddy/harness/shot-folia-image-pool.js               # 三张取证图
sh   .workbuddy/harness/run-folia-exe-all.sh                   # 18 条全量回归
```

## 五、当前验收状态（交接时的基线）

| 环节 | 结果 |
|---|---|
| 纯逻辑 `smoke-folia-tuning-bg-panels.js` | ALL PASS（345 项） |
| exe `smoke-folia-image-pool.js` | ALL PASS（33 项） |
| 突变 `mutate-folia-image-pool.js` | 15/15 BLOCKED，还原后仓库 sha256 零改动 |
| 全量回归 `run-folia-exe-all.sh` | 18/18 ALL PASS，transport-retry 0 次 |

## 六、接手时最容易踩的三件事

1. **换行**：`0l` / `00b` 是 LF，`0l1` / `smoke-folia-tuning-bg-panels.js` 是 CRLF。
   脚本改文件前先归一，否则锚点匹配不到（断言会静默变成 `count == 0`）。
2. **改 UI 不要改断言的判据**：断言写的是上游语义和 DOM 钩子，改类名/属性会全红。
3. **断言全绿 ≠ 好看**。这个上传行已经因为「只跑测试不看图」被推翻两次，
   改完必须自己打开取证图确认。
