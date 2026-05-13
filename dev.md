# 开发与发布流程

## 本地开发

```bash
pnpm install
pnpm dev
```

然后在 Chrome 扩展管理页面开启开发者模式，并加载 `extension/` 目录。

## 发版前检查

发版前建议本地执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:zip
```

其中：

- `pnpm build` 会生成生产环境扩展文件到 `extension/`
- `pnpm pack:zip` 会把 `extension/` 打包为 `extension.zip`

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

仓库已配置 GitHub Actions：

```text
.github/workflows/release-extension.yml
```

触发方式：

1. 推送 `v*` 格式的 tag，例如 `v0.0.2`
2. 或者在 GitHub Actions 页面手动触发 `workflow_dispatch`

CI 发布流程会自动执行：

1. Checkout 代码
2. 安装 pnpm 和 Node.js
3. 安装依赖：`pnpm install --frozen-lockfile`
4. 代码检查：`pnpm lint`
5. 类型检查：`pnpm typecheck`
6. 单元测试：`pnpm test`
7. 构建扩展：`pnpm build`
8. 打包 zip：`pnpm pack:zip`
9. 将 `extension.zip` 重命名为：

   ```text
   touch-xxeng-heart-extension-v<version>.zip
   ```

10. 上传 workflow artifact
11. 创建 / 更新 GitHub Release，并把 zip 作为 release asset 上传

## 推荐发布步骤

以 patch 发版为例：

```bash
pnpm version:patch

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:zip

VERSION=$(node -p "require('./package.json').version")

git add package.json scripts/version.ts dev.md .github/workflows/release-extension.yml README.md
git commit -m "chore: release v${VERSION}"
git tag "v${VERSION}"
git push origin main --tags
```

推送 tag 后，GitHub Actions 会自动构建扩展压缩包并发布到 GitHub Release。

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
