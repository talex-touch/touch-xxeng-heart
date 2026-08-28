# Lexi

<p align="center">
  <a href="https://linux.do">
    <img src="https://ld.xh.do/ld-badge.svg" alt="认可 linux.do" width="480">
  </a>
</p>

![Lexi icon](./extension/assets/icon-128.png)

Lexi 是一个面向程序员的 Chrome WebExtension。它会把真实网页变成轻量英语学习环境：在正文中替换少量中文技术词为英文，保留 hover 释义；划词时显示翻译说明，并把自动命中和手动划选的词汇记录到本地学习进度。

面向用户的完整功能说明见 **[功能指南](./docs/GUIDE.md)**，包含触发方式、快捷键速查、隐私边界和常见问题。

## 特性

- 网页词汇替换：按启用范围、替换密度、基础难度和单页上限处理正文文本。
- 悬浮释义：被替换词汇带虚线，hover 可查看原文、含义和英文例句。
- 划词翻译：选中网页文本后显示翻译说明，并记录手动划选词汇。
- 页面翻译：按当前链接、站点或 Regex 分段翻译，优先处理可视区域并在本地恢复缓存；可显式启用 Discourse 主题帖、GitHub README、Reddit 帖子的英文正文自动翻译。
- 语言覆盖：中英互译，日语与韩语页面可译成中文；源语言交由引擎检测，方向按目标语言命名。词汇学习仍只覆盖英语。
- 实体检测：识别正文中的专有名词并标注所属领域（技术工程、金融商业、产品与公司、医学生物、法律合规、学术论文），按页面领域消解同词多义；内置种子词典，可选 AI 补充。
- 节日外观：可跟随本机日期自动切换春节、情人节、万圣节主题，也可手动固定默认或指定主题；正式 Crystal Jellyfish 图标保持不变。
- 页面问答：索引正文结构，按问题检索相关段落并支持带来源的多轮追问；总结类提问自动覆盖全文，模型可主动检索页面；打开即给出快捷提问，面板可拖动、可缩放。
- 词汇进阶：记录出现次数、手动记录次数、复盘时间，并随学习量提升有效难度。
- 每日推荐：侧边栏提供 Lexical 学习空间、专业术语和待复盘词汇。
- 场景化速读：为 GitHub 仓库、Discourse 主题以及 Reddit、X、YouTube、Bilibili、小红书、知乎生成带读取范围的可缓存摘要。
- 敏感内容保护：NSFW 内容速读默认关闭；关闭时不会提取、缓存或发送检测到的内容。
- 媒体工具：支持媒体下载、AI Omni 图片 Prompt 提取和跨 frame 视频倍速。
- 场景化 AI：替换、划词、每日推荐、内容速读、AI Omni 分别绑定 Provider；HTTP Endpoint 需逐地址确认。
- 多协议 Provider：支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 与 Google Gemini，可自动识别协议、拉取模型列表并逐个测试。
- 设置同步：可选把设置镜像到浏览器账号同步区（约 100KB 配额），词库仍保存在本机并支持 JSON 导入导出。
- 站点配置：支持全部网页、白名单、黑名单、特殊站点策略和总开关。

## 品牌图标

Lexi 使用 Crystal Jellyfish 作为正式品牌符号。透明栅格母版、经校准的小尺寸导出、ICO、验收图和生成记录统一保存在 `brand/favicon-kit/`，该套资产没有 SVG 源文件。

`brand/favicon-kit/favicon-master-transparent.png` 是生产母版。`pnpm dev` 和 `pnpm build` 会在生成扩展清单前执行品牌同步；也可以单独运行：

```bash
pnpm brand:sync   # 同步到扩展、Vue 组件和官网目录
pnpm brand:check  # 校验派生文件与品牌源是否一致
```

各产品入口使用的派生资源：

- `extension/assets/icon-{16,48,128,512}.png`
- `src/assets/logo.png`
- `apps/site/public/favicon*`、`apple-touch-icon.png` 与 `assets/icon.png`

详细使用与禁用规则见 [`brand/favicon-kit/README.md`](./brand/favicon-kit/README.md)。

## 技术栈

- Vue 3 + TypeScript
- Vite
- UnoCSS
- WebExtension MV3
- Vitest + Playwright

## 安装方法（开发者模式）

Lexi 目前通过 Chrome 开发者模式加载本地扩展目录安装：

```bash
pnpm install
pnpm build
```

然后在 Chrome 中完成安装：

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `extension/` 目录

如需边开发边调试，可改用：

```bash
pnpm dev
```

保持本地监听构建进程运行后，同样加载 `extension/` 目录；所有页面脚本都写入扩展目录，不会启动或依赖本地 HTTP 服务器。

## 常用脚本

```bash
pnpm dev          # 开发模式
pnpm build        # 生产构建
pnpm version:patch # 升级 patch 版本，发版前使用
pnpm test         # 单元测试
pnpm typecheck    # TypeScript 检查
pnpm lint         # ESLint 检查
pnpm test:e2e     # 构建并运行扩展端到端测试
pnpm run package:chromium # 构建 Chromium ZIP/CRX
pnpm run package:firefox  # 构建并校验 Firefox XPI
pnpm run package:beta     # 构建 beta ZIP
pnpm run package:all      # 顺序生成全部平台制品
```

## 项目结构

```text
brand/favicon-kit/                  品牌母版、平台导出与使用规范
src/background/main.ts              Worker 入口：右键菜单、缓存写入、设置同步
src/background/aiService.ts         AI 端口服务，唯一持有凭据并发起网络请求的一侧
src/background/analyticsStore.ts    调用与访问日志的串行写入
src/contentScripts/pageEnhancer.ts  顶层页面替换、翻译、对话和媒体增强编排
src/contentScripts/pageContent.ts   正文分段抽取与检索定位
src/contentScripts/contentAdapters.ts Reddit、X、视频与中文内容平台读取适配器
src/contentScripts/contentDigest.ts  多平台摘要生命周期、缓存协调与通用卡片
src/contentScripts/frame.ts         子 frame 轻量倍速入口
src/contentScripts/ui/              对话 Markdown、倍速、定位和折叠等独立 UI 模块
src/logic/aiPort.ts                 页面世界与 Worker 之间的 AI 命令协议
src/logic/aiTransport.ts            页面侧客户端：只发送场景与消息
src/logic/aiRunner.ts               Provider 解析、竞速、协议适配、流式读取与日志
src/logic/aiClient.ts               各场景的提示词组装与结果解析
src/logic/providers/                四种线协议的请求构建与响应读取适配器
src/logic/                         配置、术语库、本地存储和学习进阶算法
src/options/Options.vue            Lexi 配置页
src/popup/Popup.vue                快速开关和状态概览
src/sidepanel/Sidepanel.vue        每日推荐与待复盘词汇
src/manifest.ts                    MV3 manifest 生成
apps/site/                         唯一官网与隐私政策静态站
extension/assets/                  扩展图标资产
```

## AI 请求链路

所有 AI 请求都由扩展 Worker 发出。页面世界（content script）只通过一条名为 `lexi-ai` 的长连接端口发送**场景和消息**，拿回**助手文本**；它不知道 Endpoint，不组装请求，也不接触任何凭据。

这样设计有两个原因，缺一不可：

- **CORS。** content script 的网络请求带的是所在页面的 origin，第三方 AI 网关不会为访问过的每个站点开放跨域，预检因此被拒。Worker 持有 `host_permissions`，不受这一检查约束。
- **凭据边界。** 请求在哪一侧组装，凭据就必须出现在哪一侧。放在 Worker 里，页面世界既拿不到 Key，打包产物里也不含任何请求构建代码。

端口命令只有三种：

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `run` | `scene`、`messages`，可选 `system` 覆盖场景提示词 | `delta`（累计文本）→ `done`；场景未启用或没有可用 Provider 时返回 `empty` |
| `test` | `scene`、`user`，可选 `provider`（测试尚未保存的配置） | `test`（含请求描述、状态码与耗时） |
| `models` | `provider` | `models` |

命令里没有地址字段，因此页面侧即使伪造 URL 或 Header 也无处落地；Provider 选择、优先级竞速、鉴权、HTTP Endpoint 许可校验和调用日志全部发生在 `src/logic/aiRunner.ts`。设置页的「测试连接」走同一条端口和同一个 runner，所以它通过就代表 content script 也能通过——这是刻意的，一个跑在更高权限上下文里的自检没有意义。

流式响应在 Worker 侧解析 SSE 并按累计文本推送；客户端每收到一次就做场景相关的整形（去除思考标签、Markdown 围栏、JSON 外壳），因此增量渲染和最终结果走的是同一段归一化逻辑。

Worker 在请求期间会周期性调用一次扩展 API 保活：MV3 中在途的 `fetch` 不算活动，非流式的推理模型很容易超过 30 秒空闲上限。

## AI 后端协议

每个 Provider 选择一种协议，请求格式、鉴权 Header 和流式解析都由对应适配器负责（`src/logic/providers/`）：

| 协议 | 请求 | 鉴权 |
| --- | --- | --- |
| `openai-chat` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` |
| `openai-responses` | `POST {base}/v1/responses` | `Authorization: Bearer` |
| `anthropic-messages` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` |
| `gemini` | `POST {base}/v1beta/models/{model}:generateContent` | `x-goog-api-key` |

协议选择“自动识别”时，先看 Endpoint 是否已写明完整路由，其次看域名，最后看模型名前缀（`claude-` / `gemini-`），都不匹配时按 OpenAI Chat 处理。系统提示词在 Responses 走 `instructions`、在 Anthropic 走 `system`、在 Gemini 走 `systemInstruction`。

HTTPS 地址可直接使用；HTTP 地址会在设置页逐个弹框确认，许可仅对规范化后的完整地址生效，可随时撤销，且不参与账号同步。

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

## 正文抽取

页面问答和页面翻译共用 `src/contentScripts/pageContent.ts` 的分段结果。抽取先挑正文根节点（`main article`、`main`、`article` 等语义容器，都不命中时按去链接后的文本量给容器打分），再按文档顺序遍历 `h1-h6,p,li,pre,blockquote,dd,figcaption,td,summary`，跳过导航、页脚、表单和 Lexi 自己注入的界面，并丢弃链接密度过高的块。

不少 CMS 和应用框架把正文渲染成裸 `<div>`，这一趟只会捞到标题，问答就只剩一份目录可用。因此当抽到的正文不足 600 字时，会用同一趟文档顺序重跑一次宽口径遍历，把最内层的通用文本盒子也算进来——保持文档顺序而不是事后追加，标题面包屑和段落次序才不会错位；只有在宽口径确实抽到更多正文时才采用其结果。

抽取结果按 URL 缓存 15 秒；如果这次没抽到任何正文段落，缓存只保留 1.5 秒，避免懒加载尚未完成时把一份空索引钉死在用户最初的几个问题上。

## 页面问答的检索

每轮提问按 BM25 从分段里挑相关片段，只发命中的部分，不注入整页。但有两类问题按相关度排不出东西，需要单独处理：

- **整页型问题**（总结、概括、要点、summarise、tl;dr 等）。这类问题和正文没有词汇重叠，BM25 会给每一段打 0 分。此时切换到**覆盖模式**：跳过标题（目录里已有），按文档顺序遍历正文；预算装得下就全发，装不下就按跨度均匀采样以覆盖全文。
- **零命中**。问题的用词和页面用词对不上时同样退到覆盖模式——退化成“只有目录”从来不是有用的回答。

覆盖模式会在片段前写明范围（“覆盖本页全部正文（共 N 段）”或“均匀取自本页正文（N/M 段）”），模型据此判断能不能下整体结论，而不是自行猜测手上有多少。

此外模型可以主动检索：当它认为需要页面上尚未给到的内容时，只输出一行 `<search>关键词</search>`，客户端用这些关键词重新检索并再问一次，最多一轮。问题的措辞往往不是页面的措辞，多一次往返好过让用户自己去找段落选中。这个调用不会出现在对话记录里；实现是跨协议的文本约定，不依赖网关支持 function calling。

## 内容速读协议

多平台内容速读使用独立的“内容速读”AI 场景。页面正文、评论和字幕都按不可信数据处理，只发送当前页面已公开、已加载且符合设置的片段。NSFW 开关默认关闭。

摘要请求期望返回：

```json
{
  "oneLine": "",
  "summary": [""],
  "keyPoints": [""],
  "viewpoints": [""],
  "actions": [""],
  "terms": [""]
}
```

读取范围由客户端生成并展示，不接受模型覆盖。缓存只保存摘要、内容哈希和最少元数据，不保存正文、评论全文或字幕。

## 数据存放与同步

运行时真源始终是 `storage.local`。在设置页开启「同步到 Google 账号」后，设置会额外镜像一份到浏览器账号同步区（`storage.sync`）：

- 同步：站点规则、替换强度、划词与页面翻译、速读、界面、词库上限、Provider 与提示词。
- 不同步：词库记录、AI 调用日志、访问日志、速读缓存（体积远超 100KB 配额），以及已确认的 HTTP Endpoint（属于本机授权）。
- API Key 默认随设置一起同步，可在同一张卡片里单独关掉；开启时 Key 会随浏览器同步上传到 Google 服务器，建议同时启用 Chrome 同步密码短语。

关于凭据的可见范围，有一点需要明确：**content script 对 `storage.local` 有完整读权限**。AI 请求链路保证了页面世界不会*使用*凭据，但只要 Key 存放在 `storage.local`，content script 自行读取仍然可行，这不是客户端代码能封住的。若后续引入登录态令牌，应存放在 content script 读不到的区域（Chrome 的 `storage.session` 默认访问级别即为受信任上下文），而不是继续放在 `storage.local`。

同步区单项上限 8KB，因此设置被切成 `lexi-sync-settings-chunk-*` 分片写入，并由 `lexi-sync-settings-meta` 记录分片数与长度；分片没凑齐时整份快照会被忽略，等下次改动重新同步。设备之间按写入时间取新，另一台设备的快照到达时才会覆盖本机。

词库换设备用设置页「词库记录」里的 JSON 导出/导入，同名词条按最新记录覆盖，超出词库上限时保留最近更新的部分。

## 贡献

1. 安装依赖并确认 `pnpm test`、`pnpm typecheck`、`pnpm lint` 通过。
2. 保持变更聚焦，优先沿用现有模块边界和代码风格。
3. 提交信息建议使用 Conventional Commits，例如 `feat: add vocabulary review panel`。

## 许可证

[MIT](./LICENSE)
