# 版本号约定

本仓库遵循 `MAJOR.MINOR.PATCH`，**版本号是用户定位问题的坐标**：一个号对应一次发布，
用户报问题时能说清「我用的 3.3.6」。

- **默认走 PATCH**（`3.3.6` → `3.3.7`）。功能、修复、性能优化、内部重构都算 —— 判据是
  「这次改动有多大」，不是「提交前缀叫什么」。新歌词样式、新音效预设、新平台能力这类
  都是补丁号发出去的（3.3.2 → 3.3.5 全是这个节奏）。
- **MINOR 留给一次成批的对外变化**（`3.3.x` → `3.4.0`）：多个子系统同时改掉用户看得到的
  行为、或者升级说明里得先读一段才不会被吓到。**由维护者按体量决定，闸门不强制**。
- **MAJOR 用于不兼容**：旧配置 / 旧数据 / 旧接口直接失效，必须让用户知道。
- `docs` / `test` / `chore` / `ci` 这类不改运行时行为的提交，不要求 bump。

提交信息用 Conventional Commits 前缀，它仍然是**变更分类**的依据（CHANGELOG 与 release
notes 都按它组织），只是不再直接决定版本号位数：

```
feat(folia): 隐喻歌词样式               -> patch（默认补丁号）
fix(glass): 壁纸视频玻璃全黑            -> patch
perf(we): 窗口隐藏时停掉壁纸解码        -> patch
feat(api)!: 播放接口改为必带 token      -> minor（不兼容，至少抬一档）
docs(README): 整篇重写                  -> 无需 bump
```

PR 合并前由 `node scripts/check-version-bump.js --base origin/main` 检查，它只管一件事：
**这次发布有没有把版本号动到该动的位置**。有 `feat` / `fix` / `perf` 提交却没 bump
patch 会失败；带 `!` 的提交却只 bump patch 也会失败。该不该发 minor 不在它的判定范围。

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
npm version 3.3.7 --no-git-tag-version
node scripts/check-version-bump.js --base v3.3.6
npm test
npm run build:win
```
