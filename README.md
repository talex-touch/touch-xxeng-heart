# touch-xxeng-heart

Lexi 是一个 Chrome WebExtension，用来把真实网页变成轻量的程序员英语学习环境。它会在正文里替换少量不常见中文技术词为英文，保留虚线提示和 hover 释义；划词时显示翻译，并把自动命中和手动划选的词汇记录到本地学习进度。

## 功能

- 网页词汇替换：按启用范围、替换密度、基础难度和单页上限处理正文文本。
- 悬浮释义：被替换词汇带虚线，hover 可查看原文、含义和英文例句。
- 划词翻译：选中网页文本后在下方显示翻译说明，并记录手动划选词汇。
- 词汇进阶：记录出现次数、手动记录次数、复盘时间，并随学习量提升有效难度。
- 每日推荐：侧边栏提供程序员英语、专业术语和待复盘词汇。
- 场景化 AI：替换、划词、每日推荐分别支持独立 endpoint、model、api key；未配置时走本地术语库。
- 站点配置：支持全部网页、白名单、黑名单和总开关。

## 结构

- `src/contentScripts/pageEnhancer.ts`：页面文本遍历、词汇替换、划词翻译和本地记录。
- `src/logic/*`：配置、术语库、AI 请求、本地存储和学习进阶算法。
- `src/options/Options.vue`：Lexi 配置页。
- `src/popup/Popup.vue`：快速开关和状态概览。
- `src/sidepanel/Sidepanel.vue`：每日推荐与待复盘词汇。
- `src/manifest.ts`：MV3 manifest 生成。

## 开发

```bash
pnpm install
pnpm dev
```

然后在 Chrome 扩展管理页面加载 `extension/` 目录。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## AI 后端协议

扩展会向配置的 endpoint 发送 JSON POST 请求，并在 Header 中以 `Authorization: Bearer <apiKey>` 传入密钥。

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

划词场景期望返回：

```json
{
  "translation": "context",
  "explanation": "上下文可理解为 context。",
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
