# 开发与发布流程

## 本地开发

```bash
pnpm install
pnpm dev
```

然后在 Chrome 扩展管理页面开启开发者模式，并加载 `extension/` 目录。

`pnpm dev` 只监听源码并持续重建 `extension/` 内的本地文件，不会启动 Vite HTTP 服务器；扩展停止开发进程后仍可使用最后一次完整产物。Firefox 开发使用 `pnpm dev-firefox`，它会生成 Firefox 专用 manifest。

## 发版前检查

发版前建议本地执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm brand:check
pnpm build
pnpm test:e2e:run
pnpm pack:zip
```

其中：

- `pnpm build` 会生成生产环境 Chromium 扩展到 `extension/`
- `pnpm test:e2e:run` 会针对已构建的 Chromium 扩展运行 Playwright
- `pnpm pack:zip` 只打包现有 `extension/`，不会主动构建
- `pnpm run package:chromium` 会执行构建并生成 ZIP/CRX
- `pnpm run package:firefox` 会执行 Firefox 构建并生成 XPI
- `pnpm run package:beta` 会执行 beta 构建并生成 ZIP
- `pnpm run package:all` 会按 Chromium、beta、Firefox 的顺序生成全部制品

不要使用 `pnpm pack` 作为扩展打包入口；它是 pnpm 自带的 npm tarball 命令。

## 升级版本

项目提供版本升级脚本，会更新 `package.json` 中的 `version`。

```bash
pnpm version:patch # 0.0.1 -> 0.0.2
pnpm version:minor # 0.0.1 -> 0.1.0
pnpm version:major # 0.0.1 -> 1.0.0
```

也可以指定具体版本：

```bash
pnpm run version:bump -- 0.1.0
pnpm run version:bump -- v0.1.0
```

脚本执行后会输出对应的 release tag，例如：

```text
VERSION  0.0.1 -> 0.0.2
VERSION  release tag: v0.0.2
```

## GitHub Actions 自动发布

仓库使用两条发布 workflow：

- `.github/workflows/auto-version-release.yml`：main/master 收到非发布提交后，默认自动升级 patch 版本、更新 changelog、验证、提交并创建 tag。
- `.github/workflows/release-extension.yml`：校验 tag 必须严格等于 `v${package.version}`，随后重建并发布 Chromium ZIP。

正常发布只需将通过评审的提交合入 main。自动版本 workflow 会执行：

1. 根包依赖安装：`pnpm install --frozen-lockfile --ignore-workspace`
2. 版本与 changelog 生成
3. ESLint、TypeScript、Vitest 和品牌资产校验
4. Chromium 构建与 Playwright 端到端测试
5. 提交版本文件并创建 `v*` tag
6. 以该 tag 显式触发扩展发布 workflow
7. 重新验证、打包 ZIP、上传 artifact 并创建 GitHub Release

`release-extension.yml` 也支持手动重跑已有版本。必须提供已经存在的 tag，并且 tag 要与该提交的 `package.json.version` 一致，例如：

```bash
gh workflow run release-extension.yml --ref v0.2.4 -f tag=v0.2.4
```

## 推荐发布步骤

1. 在分支或 PR 中完成 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和相关构建。
2. 使用 Conventional Commit 提交信息合入 main。
3. 等待 `Auto Version Release` 创建版本提交和 tag。
4. 确认 `Release Extension` 的 artifact、GitHub Release 和 ZIP 名称一致。

`version:patch/minor/major` 仍可用于特殊的手工版本准备，但不要与 main 自动版本链同时使用，否则可能产生重复版本提交或 tag。

## 手动检查发布产物

本地打包后可以检查：

```bash
ls -lh extension.zip
```

也可以手动加载 `extension/` 目录到 Chrome 扩展管理页面进行验证。

## 注意事项

- Chrome WebExtension 的版本号必须是数字格式，例如 `1.2.3`，不要在 `package.json` 中写 `v1.2.3`。
- tag 使用 `v` 前缀，例如 `v1.2.3`。
- GitHub Actions 需要 `contents: write` 权限才能创建 Release 和上传附件。
- `pnpm-lock.yaml` 通常只在依赖变化时更新；单纯升级 `package.json.version` 不一定会修改 lockfile。
