# 版本号约定

本仓库遵循语义化版本 `MAJOR.MINOR.PATCH`，**版本号是用户定位问题的坐标**：

- **加用户可见功能 → bump MINOR**（`3.3.1` → `3.4.0`）。例如新的平台能力面板、新的可视化模式、新的播放能力。
- **只修 bug / 性能修复 / 内部重构 → bump PATCH**（`3.3.1` → `3.3.2`）。
- **不兼容的对外行为变更 → bump MAJOR**。
- `docs` / `test` / `chore` / `ci` 这类不改运行时行为的提交，不要求 bump。

提交信息用 Conventional Commits 前缀，CI 据此判定最低版本要求：

```
feat(platforms): 五平台增补能力与平台能力面板   -> minor
fix(glass): 壁纸视频玻璃全黑                    -> patch
perf(we): 窗口隐藏时停掉壁纸解码               -> patch
docs(README): 整篇重写                          -> 无需 bump
```

PR 合并前由 `node scripts/check-version-bump.js --base origin/main` 检查：
若本次提交包含 `feat` 而 `package.json` 版本未达到 `minor`，或只有 `fix/perf`
却连 `patch` 都没动，CI 直接失败。

CI 配置的规范副本是 `docs/ci/tests.yml`（始终随仓库发布）。启用 GitHub Actions
时需把它放到 `.github/workflows/tests.yml`；当前账号 token 缺 `workflow` scope，
写入该路径会被 GitHub 拒绝，需先在浏览器完成一次 OAuth 授权。守卫会检查两份
内容一致，避免启用版悄悄落后。

## 发版时必须同步的位置

改版本号要一次改全，漏任何一处都会让用户看到「版本对不上」：

1. `package.json` → `version`
2. `package-lock.json` → 根 `version` 与 `packages[""].version`（用 `npm version --no-git-tag-version` 自动同步）
3. `public/index.html` → `<html data-app-version="...">`（loader 缓存版本，同时供构建溯源读取）
4. `README.md` → 顶部版本徽章、下载链接两处文件名与 tag
5. `CHANGELOG.md` → 新增该版本段落
6. 打 tag `vX.Y.Z`，创建 Release

## Release 正文固定格式

每次 Release 正文**第一行**必须写溯源，且资产不可静默替换：

```
构建自 commit <完整 sha> · <构建时间 ISO8601>
```

随后附每个资产的 SHA256。若需要替换已上传的资产，应当发新版本或显式在正文
注明替换原因与时间，绝不覆盖同名文件而不留痕。

本地执行：

```bash
npm version 3.4.0 --no-git-tag-version
node scripts/check-version-bump.js --base v3.3.1
npm test
npm run build:win
```
