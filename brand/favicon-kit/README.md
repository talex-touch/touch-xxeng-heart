# Lexi 品牌图标

这套 Crystal Jellyfish 是 Lexi（理析）的正式品牌符号。图标是纯栅格资产，没有 SVG 源文件；产品界面只能使用透明 PNG 或 `favicon.ico`，不得使用带洋红背景的生成母版。

## 单一来源

- `favicon-master-transparent.png`：`1122 x 1122` RGBA 生产母版。
- `favicon-{16,32,48,64,128,180,256}.png`：经小尺寸校准的正式导出，不要临时从母版缩放替代。
- `favicon-512.png`：从透明母版导出的扩展高分辨率图标。
- `favicon.ico`：包含 16、32、48、64、128 和 256 像素图层。
- `favicon-size-proof.png`：浅色、深色标签页与原生尺寸验收图。
- `favicon-prompt.txt`、`favicon-master.json`：生成说明与来源记录，不参与产品打包。
- `favicon-master.png`：洋红抠图源，仅用于来源留档，不参与产品打包。

仓库中的扩展、Vue 组件和官网资源都由 `pnpm brand:sync` 从本目录同步。不要直接修改这些派生文件：

- `extension/assets/icon-*.png`
- `src/assets/logo.png`
- `apps/site/public/favicon*`
- `apps/site/public/apple-touch-icon.png`
- `apps/site/public/assets/icon.png`

`pnpm dev` 和 `pnpm build` 会在生成扩展清单前自动执行同步。

## 使用规范

- 保持完整轮廓、透明背景和原始纵横比。
- 小于或等于 128px 时优先选用最接近的正式导出尺寸。
- 图标四周保留素材自带安全区，不裁切晶体顶角或触手。
- 不添加圆角方形底板、描边、外发光、投影、文字或品牌色覆盖。
- `alt`：独立表达品牌时使用“Lexi”；品牌文字已紧邻图标时使用空文本。

## 512px 导出

`favicon-512.png` 由 macOS `sips` 从透明母版生成并纳入版本控制：

```bash
sips --resampleHeightWidth 512 512 \
  brand/favicon-kit/favicon-master-transparent.png \
  --out brand/favicon-kit/favicon-512.png
```

生成后运行 `pnpm brand:sync`，并用 `pnpm brand:check` 校验品牌清单、母版、正式导出与所有派生文件。当前再生成命令依赖 macOS；其他平台直接使用已纳入版本控制的正式导出，不在构建时重新采样。
