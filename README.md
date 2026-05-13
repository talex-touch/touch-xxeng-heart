# Lexi

![Lexi icon](./extension/assets/icon-128.png)

Lexi 是一个面向程序员的 Chrome WebExtension。它会把真实网页变成轻量英语学习环境：在正文中替换少量中文技术词为英文，保留 hover 释义；划词时显示翻译说明，并把自动命中和手动划选的词汇记录到本地学习进度。

## 特性

- 网页词汇替换：按启用范围、替换密度、基础难度和单页上限处理正文文本。
- 悬浮释义：被替换词汇带虚线，hover 可查看原文、含义和英文例句。
- 划词翻译：选中网页文本后显示翻译说明，并记录手动划选词汇。
- 词汇进阶：记录出现次数、手动记录次数、复盘时间，并随学习量提升有效难度。
- 每日推荐：侧边栏提供 Lexical 学习空间、专业术语和待复盘词汇。
- 场景化 AI：替换、划词、每日推荐分别支持独立 endpoint、model、api key；未配置时走本地术语库。
- 站点配置：支持全部网页、白名单、黑名单、特殊站点策略和总开关。

## 图标

主图标位于 `extension/assets/icon.svg`，源自标准 `1024 x 1024` 正方形 SVG。扩展清单使用以下导出尺寸：

- `extension/assets/icon-16.png`
- `extension/assets/icon-48.png`
- `extension/assets/icon-128.png`
- `extension/assets/icon-512.png`

应用内 Logo 复用 `src/assets/logo.svg`，避免浏览器扩展图标和界面品牌图形分叉。

## 技术栈

- Vue 3 + TypeScript
- Vite
- UnoCSS
- WebExtension MV3
- Vitest + Playwright

## 快速开始

```bash
pnpm install
pnpm dev
```

然后在 Chrome 扩展管理页面开启开发者模式，并加载 `extension/` 目录。

## 常用脚本

```bash
pnpm dev          # 开发模式
pnpm build        # 生产构建
pnpm version:patch # 升级 patch 版本，发版前使用
pnpm test         # 单元测试
pnpm typecheck    # TypeScript 检查
pnpm lint         # ESLint 检查
pnpm pack         # 打包扩展产物
```

## 项目结构

```text
src/contentScripts/pageEnhancer.ts  页面文本遍历、词汇替换、划词翻译和本地记录
src/logic/                         配置、术语库、AI 请求、本地存储和学习进阶算法
src/options/Options.vue            Lexi 配置页
src/popup/Popup.vue                快速开关和状态概览
src/sidepanel/Sidepanel.vue        每日推荐与待复盘词汇
src/manifest.ts                    MV3 manifest 生成
extension/assets/                  扩展图标资产
```

## AI 后端协议

Lexi 会向配置的 endpoint 发送 JSON POST 请求，并在 Header 中以 `Authorization: Bearer <apiKey>` 传入密钥。

替换场景期望返回：

```json
{
  "items": [
    {
      "original": "上下文",
      "replacement": "context",
      "meaning": "运行、阅读或推理时依赖的背景信息。",
      "example": "The model needs enough context.",
      "tags": ["programming", "ai"],
      "difficulty": 2
    }
  ]
}
```

划词场景会先请求最终译文，再请求一段简短说明。译文要求结合上下文判断语气、意图和潜台词，表达自然、有人味，避免翻译腔。说明请求期望返回：

```json
{
  "explanation": "上下文可理解为 context。",
  "terms": [
    {
      "term": "上下文",
      "explanation": "理解文本时依赖的背景信息。"
    }
  ],
  "context": "这里强调模型需要背景信息才能稳定判断。",
  "translationReview": "英文用 context 比 background 更贴近技术语境。",
  "advice": "保留技术语气，译文保持简洁自然。",
  "candidate": {
    "original": "上下文",
    "replacement": "context",
    "meaning": "运行、阅读或推理时依赖的背景信息。",
    "example": "The model needs enough context.",
    "tags": ["programming"],
    "difficulty": 2
  }
}
```

## 贡献

1. 安装依赖并确认 `pnpm test`、`pnpm typecheck`、`pnpm lint` 通过。
2. 保持变更聚焦，优先沿用现有模块边界和代码风格。
3. 提交信息建议使用 Conventional Commits，例如 `feat: add vocabulary review panel`。

## 许可证

[MIT](./LICENSE)
