# 接入与优化路线

日期：2026-09-13 · 基线：Lexi `main` @ 06d847a + 当前 Nexus 接入工作树；Nexus `master` @ 3a4a5bd44

本文只回答"接什么、怎么接、先做哪个"。功能现状见 [GUIDE.md](./GUIDE.md)，"不做哪些"见 [COMPETITIVE-REVIEW.md](./COMPETITIVE-REVIEW.md)。

---

## 结论

本轮已把 Nexus、非 ASR 字幕源与 Discourse Livestream 修复落到代码并完成专项验证；双语高亮和宿主桥仍按权限与产品边界单独排队：

| 线 | 当前状态 | 判断 |
|---|---|---|
| Tuff Nexus 作为 AI 通道 | Nexus 已拆出低价 `text.translate`；Lexi 已有固定协议、设备授权、会话令牌、额度展示与直接翻译路由 | **代码已完成**：本地实机已拿到设备码并进入轮询；仍需真人账号批准与发布环境验收 |
| 通用视频双语字幕 | Apple Events、HTML5、Bilibili 与 YouTube 非计费 provider 已接入；单语 AI 补译默认关闭；ASR 未接入 | **本轮完成非 ASR 路径**：后续只做真实站点回归与缓存采样 |
| Apple 官网 Events 字幕 | 官方 en/zh HLS/WebVTT 已接入并按时间重叠配对 | **已完成，零 AI 成本** |
| 双语高亮（逐句对照 + hover 联动 + 样式） | 页面翻译仍是整段对照，字幕使用原生两行 cue | **待做**：先稳定句级合同，再共用渲染语义 |
| macOS Apple Events / 宿主桥 | Tuff 有真实 osascript，但没有面向扩展的桥 | **保持窄边界**：Apple Event 不是扩展传输层；有明确宿主场景再开 loopback/native messaging |

用户报告的 Discourse Livestream / Chat 缺口也已按专用 DOM adapter 修复，见 §5。

---

## 一、Tuff Nexus 作为 AI 通道

### 1.1 服务端已有的合同（逐条核实）

| 用途 | 路由 | 鉴权 | 证据 |
|---|---|---|---|
| 非流式调用 | `POST /api/v1/intelligence/invoke` | `requireAuth`：session **或** app access JWT | `invoke.post.ts:9-25` |
| 流式（仅 `text.chat`） | `POST /api/v1/intelligence/stream` | 同上 | `stream.post.ts:36-74` |
| 音频转写 | `POST /api/v1/ai/audio/transcribe`（raw body + `content-type` + `x-idempotency-key`，202） | `requireAppAuth` | `transcribe.post.ts:11-24` |
| 转写结果 | `GET /api/v1/ai/audio/transcriptions/{requestId}` | `requireAppAuth` | 路由存在 |
| 设备授权 | `POST /api/app-auth/device/start` → `GET /api/app-auth/device/poll?device_code=` | 公开 | `start.post.ts:78-91`、`poll.get.ts:57-85` |
| 续期 | `POST /api/app-auth/refresh` | refresh token | `refresh.post.ts:8-21` |
| 余额 | `GET /api/credits/summary` | `requireVerifiedEmail` | `summary.get.ts:4-7` |
| 价目 | `GET /api/credits/pricing` | 同上 | `pricing.get.ts:12-28` |

两处容易看错的地方：

1. **AK 能读余额。** `requireVerifiedEmail` 先调 `requireAuth`，而 `requireAuth` 在 session 401 后会回退到 bearer app token（`auth.ts:546-556`），所以扩展用 AK 可以直接读 `credits/summary` 与 `credits/pricing`，不需要浏览器 Cookie。反过来，`v1/quotas` 是同步存储配额而不是 AI 积分（`v1/quotas/index.get.ts:10-16`），别接错。
2. **Cookie 那条路走不通，也不必要。** `/api/*` 除两个控制面（`/api/admin/`、`/api/dashboard/intelligence/`）外都返回 `Access-Control-Allow-Origin: *`（`middleware/cors.ts:44-55`），扩展 origin 本来就能带 Bearer 调用；跨站 Cookie 在扩展请求里不成立。所以"设备授权 + Bearer"是唯一也是正确的路径。

生命周期：AK 24 小时，RK 30 天 / 180 天（`auth.ts:28-30`）；设备授权 TTL 2 分钟、轮询 3 秒（`start.post.ts:11-12`）。

### 1.2 先算账，再接

Nexus 不再把所有文本能力按同一价格出售：chat 类仍是 1,000 credits / 1k tokens，`text.translate` 已在 3a4a5bd44 调为 **10 credits / 1k tokens**、`reserveMultiplier = 2`。ASR 为 4 credits/音频秒，并与 transcript units 取较高值。月额度：FREE 20,000；补全邮箱 + OAuth/passkey 后 40,000；PLUS 100,000；PRO 240,000（当前 Nexus 源码）。

按 Lexi 的真实形状估算：

- 页面翻译默认 `batchSize = 3`，单块最多 900 字符；一篇 40 块文章约 60,000–70,000 输入输出 tokens。按现价约 **600–700 credits**，不是旧价下的 60,000–70,000。
- 20 分钟、约 300 条 cue 的字幕翻译约 **300–400 credits**；若没有原生字幕而走 1,200 秒 ASR，主计价约 **4,800 credits**，应单独确认。
- Lexi 对 Nexus 的 `text.translate` 按 item 调用；短 item 受 `minCredits = 1` 影响，但不会退回高价 `text.chat`。

结论：Nexus 已可作为实用翻译通道，但仍不应无提示接管默认路线。设备账号会产生服务端积分结算，所以登录后只建立 Provider，具体功能仍由用户显式绑定；Microsoft / Google 与自备 Provider 保持原样。

### 1.3 Lexi 侧已落地

1. **第五种协议**：`src/logic/providers/nexus.ts` 注册 `nexus-intelligence`，固定相对 invoke 路径、固定审计 metadata 和本地 `auto` 模型，不接受用户覆盖 Nexus origin。
2. **能力路由**：普通结构化场景继续走 `text.chat`；页面批量翻译与划词最终译文携带 direct-translation descriptor，逐项走 `text.translate`，并保留非 Nexus Provider 的旧 prompt 路径。
3. **授权**：设置页执行 `device/start`，只展示 `userCode` 并用 `browser.tabs.create(authorizeUrl)` 打开同源授权页；按服务端 `intervalSeconds` 轮询，覆盖批准、过期、取消、关闭和拒绝状态。
4. **Token 保管**：AK/RK 只存 `storage.session`，访问级别固定为 trusted contexts；浏览器缺少或暂时拒绝 session storage 时仅退到 Service Worker 内存镜像。它们不进入 `storage.local`、同步快照、UI、调用日志或 content script。
5. **刷新与结算**：主动刷新单飞；一次 401 只刷新并重试一次。invoke 回包的 trusted billing 只投影 `reservedCredits` / `chargedCredits` 到调用日志；直接翻译部分成功时不重放已收费 item，只有零成功才尝试下一个通用 Provider。
6. **账号 UI**：显示当前月个人/团队 quota 与 used 推导出的剩余额度；退出后令牌清空、Nexus Provider 停用，但功能绑定保留。

### 1.4 Nexus 侧建议补的（很少）

- 建议新增 `GET /api/v1/credits/summary`（`requireAppAuth`）。现在能用是靠 `requireVerifiedEmail → requireAuth` 的回退，是"顺手可用"而非设计意图；显式加一条 app 路由，将来收紧前者不会把扩展带下水。
- `builtin-abilities.ts` 有 33 个能力，Nexus 服务只特判 `vision.ocr`，其余走模型路由；`audio.tts` 有 id 没有专门端点——将来要做 TTS 得先在服务端补路径。
- `dashboard/api-keys` 的 scope 目录只有 plugin/account/release/maintenance，没有 AI scope（`apiKeyScopes.ts:2-7`）。本次用设备 AK 不触发；将来开放第三方 Key 才需要。
- `api/docs/assistant` 是"完成后扣费、无预留"（`assistant.post.ts:177`），不作为 Lexi 主路径。

### 1.5 已核对的运行合同

1. `text.translate` 入参为 `{text,targetLang,sourceLang?}`；通用场景是 `text.chat` 的 messages 信封，二者都固定 `stream:false` 并带 Lexi 审计来源。
2. `clientType:'external'` 的 `device/start` 已在真实 `https://tuff.tagzxia.com` 返回 200；本地扩展实机拿到设备码、打开同源登录页并进入服务端节奏轮询。未使用用户账号完成最终批准，因此这不是已登录生产验收。
3. invoke 回包含 trusted usage 与 billing；Lexi 不根据用户输入自行扣费，只记录服务端返回的 reserve / charge。余额走 Bearer `credits/summary`。

### 1.6 Nexus 定价结果与后续

Nexus 侧 3a4a5bd44 已完成第一步：`text.translate` 从 chat 价拆出，设为 **10 credits / 1k tokens**、双倍预留；chat 保持 1,000 / 1k。面向用户的 `credits/pricing` 只返回可消费价格，不暴露 upstream cost 与 reserve multiplier；这两个字段仍属于内部利润和风控证据。

这解决了“翻一篇文章耗尽 FREE 月额度”的直接阻塞。仍要保持两个事实边界：

1. Git 源码落地不等于该价格已发布到生产；发布后要用已认证 `credits/pricing` 与一次真实 `text.translate` 结算回包证明。
2. 当前仍按输入 + 输出 token 计价。长期若希望“模型啰嗦不由用户买单”，可再引入 `1k_source_chars`；但在 10 / 1k 的现价下，优先级低于通用字幕 provider 与缓存。

下一项最值钱的成本优化仍是 Nexus 翻译缓存：键为 `(capability, targetLanguage, model, normalizedSourceHash)`；命中时不调 Provider，只返回可审计 cache-hit。Lexi 的 14 天页面缓存已经挡住整页回访，但字幕、引用段落与跨页面复用仍需要服务端缓存才能归零。

---

## 二、视频双语字幕

### 2.1 当前实现边界

字幕 contract 现在已有四个非计费 provider 与统一消费方：Apple Events 官方 HLS/WebVTT、任意 HTML5 原生 `TextTrack`、Bilibili 字幕 JSON，以及 Chromium YouTube 播放器字幕桥。单语字幕只有在设置中显式开启后才会调用已有翻译队列；ASR / `tabCapture` 仍未实现。

继续遵守原决定：不做第二套翻译、缓存或配额管线。字幕源只新增 provider；需要 AI 翻译时复用现有 `requestPageTranslationBatch`、Nexus `text.translate`、队列与结算边界。

### 2.2 Provider 分层（优先级从高到低）

| provider | 覆盖 | 实现要点 | billable |
|---|---|---|---|
| `apple-events-hls` | Apple Events 回放 | 后台读取受控 HLS/WebVTT，官方 en/zh 按时间重叠配对 | 否 |
| `html5-track` | 任意站点的 `<track>` / `TextTrack` | 只读页面已有字幕/听障字幕轨，暂时启用 disabled track 后恢复原状态 | 否 |
| `youtube-captions` | YouTube 视频页 | Chromium MAIN world 只读播放器 tracklist，隔离世界校验消息，后台以 `fmt=json3` 读取 cue；Firefox 退回 HTML5 | 否 |
| `bilibili-subtitles` | Bilibili 视频页 | 后台带 Cookie 读取固定 `view` / `player/v2` API，随后只读取受控 `*.hdslb.com/bfs/*subtitle*` JSON | 否 |
| `nexus-asr` | 未来兜底 | `tabCapture` + offscreen 音频 → Nexus `transcribe` | **暂不做** |

YouTube 的 MAIN-world bundle 只在 Chromium `document_start` 注入；Firefox manifest 不含该脚本，也不增加 `tabCapture` 权限。

### 2.3 渲染、缓存与成本

- 统一消费方把原文与译文写入视频自己的 `TextTrack`，所以全屏可见；官方双语轨直接按时间区间对齐，零 AI 成本。
- 单语自动补译默认关闭；开启后只读取当前播放位置前 15 秒、后 120 秒，最多 36 条 cue，按 `batchSize` 分批请求。
- 译文缓存由 `src/logic/subtitles/cache.ts` 定义，身份是 `providerId + mediaId + sourceLang + targetLang + sourceHash`，每条译文只以 cue hash 存储；后台通过串行 runtime handler 合并多标签写入。
- 缓存沿用页面翻译的 `cacheDays`，有条目数、cue 数、译文长度和总字节上限；不保存字幕原文、音频、视频 URL 或凭据。
- ASR 仍不接入；未来若启动，必须先显示估算并单独确认 billable 成本。

### 2.4 风险
- 当前实现不新增 `tabCapture` 或 offscreen 权限；这些权限只属于暂不做的 ASR 路线。
- DRM 或没有公开字幕轨的媒体会保持无字幕，不会伪造一个持续加载状态；单语自动补译关闭时也不发 AI 请求。
- YouTube timedtext 可能受站点策略限制，桥接失败时 provider 放弃并让 HTML5 provider 接管；不读取页面 Cookie。

### 2.5 Apple 官网 Events：已落地的零成本闭环

8b46749 已实现 `apple-events-hls` 路径：

1. 只匹配各地区 Apple Events 页面和 `films-modal` Watch 链接，明确排除 ASL 手语视频。
2. HLS master、语言 playlist 与 WebVTT 分片都经 MV3 background 拉取；资源策略只允许受控 HTTPS Apple 字幕主机，并限制响应大小。
3. parser 支持相对 URL、media sequence、`X-TIMESTAMP-MAP`、分片排序和重复 cue 去重；官方 en/zh cue 以时间区间最大重叠配对，不按 index 硬拼。
4. 渲染使用视频自己的 `addTextTrack('subtitles', 'Lexi 双语', 'zh-Hans')`，所以全屏仍显示；切换视频、路由或移除播放器时只清理 Lexi 插入的 cue。
5. Apple 是官方双语零成本闭环；通用 HTML5、Bilibili 与 YouTube 现在也有非计费字幕源，但字幕缺失、桥接失败或单语自动补译关闭时都保持无字幕，不伪造完整覆盖。

---

## 三、双语高亮（截图里的 Bilingual Highlighting）

目标行为三条：原文与译文**逐句对应**；hover 任一侧，两侧同时高亮；高亮样式（边框、背景、文字色）可调。

### 3.1 能复用什么

页面翻译已经是"源块 + 紧随其后的译文块"（`pageEnhancer.ts:2415-2511`），译文交给 `renderPageLearningText` 做词条包裹（`:2461-2487`）——"把 text node 拆成 span"在仓库里有先例，沿用同一套 `data-lexi*` 标记与幂等写法即可。

### 3.2 要改的三处

1. **拿对齐的句**：`requestPageTranslationBatch` 现在按块返回 `{id, translation}`（`aiClient.ts:322-363`），改成返回 `{id, sentences: string[]}`，与源块分句 1:1。分句由本地做（拉丁按句末标点+空白，CJK 按 。！？；），模型只逐句翻。**必须有退化路径**：句数对不上、或走 Microsoft/Google 引擎那条返回整段的路（`aiClient.ts:332-342`）时，回落到整段对照、不显示高亮。
2. **渲染**：源块每个句子包 `span[data-lexi-sentence="i"]`，译文块同索引；hover 任一侧设置 `data-lexi-hover="i"`，CSS 点亮两侧。跳过已有 `<a>`、`<code>` 与已包裹的词条 span。
3. **样式与配置**：竞品给了 4 个自由旋钮（边框样式/边框色/背景色/文字色）。按 COMPETITIVE-REVIEW §5 的收敛方向，建议只暴露 **2 个预设（描边 / 底色）+ 1 个主题色**。四个旋钮会把配置密度重新长回来，而这个功能的真实需求只是"看得见对应关系"。

### 3.3 风险

这是 Lexi 第一个改动正文 DOM 结构（而非只插兄弟节点）的功能，必须：可逆（关闭翻译、换页时能还原）、幂等（重复扫描不重复包裹）、SPA 路由切换后不残留。做法：按 `data-lexi-sentence` 标记 unwrap 并 `normalize()`。

---

## 四、macOS Apple Events 与宿主桥

### 4.1 事实

Tuff 侧已有的 macOS 自动化全部是 **osascript**：

| 位置 | 用途 |
|---|---|
| `apps/core-app/src/main/modules/system/active-app.ts:274-305` | 前台 App 名称 / bundle / PID / 窗口标题（System Events） |
| `apps/core-app/src/main/modules/system/selection-capture.ts:57-81` | AX 焦点元素的选中文本 |
| `apps/core-app/src/main/modules/flow-bus/native-share.ts:19-34,260-274` | 分享面板，含 `use framework "AppKit"` 的 AppleScriptObjC + AirDrop |
| `apps/core-app/src/main/modules/plugin/host/plugin-system-capabilities.ts:183-239` | 固定命令表的系统动作（重启/关机/音量/亮度） |

没有 `NSAppleEvent` / EventKit / JXA / Shortcuts 的生产实现。EventKit 只出现在一份 planning 任务里——注意"文档写了"很容易被读成"已经做了"。`packages/tuff-native` 只导出 OCR / AppKit 图标 / 通知授权。`tuff://` 已注册，但只有 `/auth/callback`、`/auth/stepup` 两条路由（`addon-opener.ts:47,76`）。

Lexi 侧：manifest 没有 `nativeMessaging`、`externally_connectable`、`onMessageExternal`（`src/manifest.ts:53-60`）。

### 4.2 三种读法与建议

| 读法 | 现实 | 建议 |
|---|---|---|
| A. 让 Tuff 使用更多 Apple 自动化（日历/提醒/Shortcuts/控制其他 App） | 与 Lexi 无关，属于宿主；TCC 的"自动化"授权归宿主 App，扩展无法代持 | 有具体场景再做 |
| B. Lexi 需要宿主能力（前台 App、选中文本、分享、本地文件） | 唯一现实路径是**新增一个面向扩展的 loopback HTTP 服务**，抄 `startToolGateway` 的绑定与 Bearer 校验（`tool-gateway/gateway-server.ts:161,199,394-404`），但要有扩展专用鉴权/CORS 与版本握手；native messaging host 是更重的另一条路（两侧都要新增） | **推荐先做 B 的一个窄合同**：3 个能力 + 明确 CORS 与 token |
| C. 用 `tuff://` 深链把"当前页/当前选中"交给 Tuff | 单向、已有解析（`addon-opener.ts:174`），可以立刻做 | 做，但只做"打开/交接"，不承载数据流 |

### 4.3 边界

- Apple Event 不是扩展的传输层。"Lexi 收 Apple Event"不成立；成立的只有"宿主收事件 → 通过 loopback 桥交给扩展"。
- 桥一开就是本机第二个可被调用的 HTTP 面，必须：只绑 `127.0.0.1`、每次启动新 token、只允许扩展 origin、能力白名单，并对"网页世界探测 127.0.0.1"做显式设计（不要依赖浏览器默认策略）。

---

## 五、Discourse Livestream / Chat（已修复）

06d847a 已把用户报告的“直播不翻译”拆成两个正确边界，而不是把 Chat 塞进普通主题帖 collector：

- **直播 Chat 双语**：`discourseLiveChat.ts` 只观察 core Chat / livestream 根内的 `.chat-message-container[data-id]`，仅接纳已持久化、可视并停留 180ms 的英文消息；批量最多 6 条，待处理上限 24，不在进入频道时回扫整段历史。
- **身份与编辑安全**：缓存 identity 是 `channelId + messageId + sourceHash + targetLanguage`。虚拟列表复用节点会重新按身份挂载；编辑后的正文只翻一次新版本；deleted、hidden、streaming、staged 消息移除或不生成译文。
- **成本边界**：正文仍调用共享 `requestPageTranslationBatch`，所以 Provider、direct translation、队列、配额和失败分类都与页面翻译一致。adapter 不读 Discourse Cookie、MessageBus 或私有 API。
- **启用条件**：用户必须开启划词/翻译总能力、把方向设为英译中，并显式打开「Discourse 主题帖」平台自动翻译。
- **论坛速读**：Chat 不进入摘要。主题帖 hash 现在包含已加载帖子内容和首/末/数量水位；新增回复时保留旧摘要并标 stale，用户重算前不再闪成空卡片。

专项测试覆盖消息插入、可视门、批处理、缓存、编辑/删除/虚拟节点、路由切换、失败冷却，以及论坛摘要水位与 stale 保留。`e2e/discourse-live-chat.spec.ts` 进一步在真实 Chromium 里证明：页面稳定后再追加的消息（直播真正的形状）同样被翻译，译文是正文的兄弟节点而非改写，中文与已删除消息不产生任何请求。真实登录态直播频道仍应在发布前做一次浏览器验收。

## 六、优化清单（按“现在做”排序）

| 顺序 | 项 | 状态 | 下一步 |
|---|---|---|---|
| 1 | Nexus 低价翻译 + 正确预留 | **已完成源码** | 发布后用 authenticated pricing + 真实结算证明 |
| 2 | Apple Events HLS/WebVTT 双语 | **已完成** | 用新的官方活动回放做发布前实机回归 |
| 3 | Discourse Chat + 速读水位 | **已完成** | 真实 Chromium 已覆盖后置消息与不计费拒绝；仍需登录态频道 DOM 抽检 |
| 4 | Nexus Lexi 固定通道 | **已完成工作树** | 真人批准、额度读取、一次真实翻译，然后发布 |
| 5 | 关闭 API Key 默认同步 | **已完成源码** | `e2e/api-key-sync-migration.spec.ts` 已在真实 Chromium 覆盖旧配置迁移与远端 scrub；仍建议用真实 Google 账号同步区抽检一次 |
| 6 | 拆 `pageEnhancer.ts` | **已完成本轮拆分** | media toolbar / animated text 已独立；后续可再拆 lifecycle |
| 7 | `html5-track` + `bilibili-subtitles` | **已完成源码** | `html5-track` 已有真实 Chromium 双语轨验收；Bilibili 仍需登录态和多页视频回归 |
| 8 | YouTube caption bridge | **已完成源码** | 公开视频浏览器 smoke；失败时保持 HTML5 fallback |
| 9 | 统一字幕缓存与 MutationObserver | **已完成源码** | 真实多标签缓存命中和长页面性能采样 |
| 10 | Nexus ASR 与 Tuff 宿主桥 | **暂不做** | 只有明确成本/宿主场景后再立项 |

## 待办

- [x] Nexus `text.translate` 独立低价与双倍预留（当前为 10 / 1k tokens）
- [x] Nexus 协议、设备授权、`storage.session` 令牌、额度 UI 与 trusted billing 日志
- [x] Apple Events HLS/WebVTT provider + en/zh 时间重叠配对
- [x] Discourse 速读水位/stale 保留 + 可视 Chat adapter
- [x] 新安装 API Key 默认关闭、旧配置迁移提示与远端密钥 scrub
- [x] `pageEnhancer` media/animated-text 拆分
- [x] HTML5、Bilibili、YouTube 字幕 provider 与统一预取窗口
- [x] 字幕 hash 缓存与 per-document MutationObserver hub
- [ ] **P2** 逐句对齐 + 双语 hover 高亮
- [ ] **P2** Nexus 服务端翻译缓存；再评估 `1k_source_chars`
- [ ] **P3** `tabCapture` + Nexus ASR（billable，明确暂不做）
- [ ] **P3** Tuff 宿主 loopback/native messaging 窄合同

---

## 来源

- Lexi：本文引用的 `src/**` 与 `docs/**`（工作区当前状态，含未提交改动）
- Nexus：`Projects/talex-touch/apps/nexus/server/**`、`packages/tuff-intelligence/**`
- Tuff：`Projects/talex-touch/apps/core-app/src/main/**`、`packages/tuff-native/**`
- Apple Events 页面与其公开 HLS master / WebVTT playlists（2026-09-13 实测）
- Discourse：归档的 `discourse/discourse-livestream` connector，以及 core `plugins/chat` 的当前消息 DOM（2026-09-13 核实）
