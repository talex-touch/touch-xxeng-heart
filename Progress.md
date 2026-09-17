# 进度记录

日期：2026-09-14 · 记录范围：本轮两条并行工作线

| 线 | 仓库 | 代码状态 | 交付状态 |
|---|---|---|---|
| A. Lexi 接入 Nexus / 字幕 / Discourse | `touch-xxeng-heart` | **已提交**，工作树干净 | 待发布前真人实机验收 |
| B. Nexus 凭据与部署密钥收敛 | `Projects/talex-touch/apps/nexus` | **已提交**（`76eba22ae` + `73cd243`） | 生产密钥已删除，预检与 watcher 已并入 master |

两条线的分工边界：A 是产品功能，B 是 A 所依赖的服务端安全基础设施。B 的四块改动没有一处触碰 Lexi。

> 数量修正：上一轮口头汇报的 store 行数（309/421/355）取自中途快照，与最终文件不符。本文所有数字为 `wc -l` 与 `git diff --numstat` 实测值。

---

## 一、Lexi：Nexus 通道、字幕源、Discourse 直播

设计与取舍见 [docs/INTEGRATION-PLAN.md](./docs/INTEGRATION-PLAN.md)，本节只记录落地结果。

### 已提交的七个提交

| 提交 | 内容 | 规模 |
|---|---|---|
| `8b46749` | Apple Events 官方 en/zh HLS/WebVTT 双语轨 | 17 文件 +2171 |
| `06d847a` | Discourse 直播 Chat 双语 adapter + 速读水位 | 7 文件 +1495 −32 |
| `6ca3667` | 抽出 enhancer 样式 | — |
| `68c9472` | Nexus 通道、HTML5/YouTube/Bilibili 字幕源、API Key 同步显式同意 | 64 文件 +10494 −541 |
| `614b8a1` | e2e：双语字幕、直播 Chat、Key 同步迁移 | 3 文件 +744 |
| `6206c35` | 文档：CHANGELOG / README / GUIDE / INTEGRATION-PLAN | 5 文件 +312 −18 |
| `29f2a7c` | 修复：YouTube 字幕读取授权与 worker fetch 绑定 | 5 文件 +321 −31 |
| `ff0702e` | 修复：已连接但不可调用的账号要说清楚 | 3 文件 +112 −14 |

### 守住的四条边界

1. **不建第二套管线。** 字幕只新增 provider；翻译、缓存、队列、配额、失败分类全部复用 `requestPageTranslationBatch`。
2. **令牌不落盘。** AK/RK 只进 `storage.session`（trusted contexts），不进 `storage.local`、同步快照、UI、调用日志或 content script。
3. **不自行计费。** 只投影服务端返回的 `reservedCredits` / `chargedCredits`；直接翻译部分成功时不重放已收费 item。
4. **不伪造覆盖。** DRM、无公开字幕轨、桥接失败时保持无字幕，而不是挂一个永久 loading。

### 成本现状

`text.translate` 已从 chat 价拆出：**10 credits / 1k tokens**（chat 仍 1,000 / 1k）。按实际形状估算：

- 40 块文章 ≈ 600–700 credits（旧价下是 60,000–70,000，会一次打空 FREE 月额度）
- 20 分钟 / 300 条 cue 字幕 ≈ 300–400 credits
- 若无原生字幕走 1,200 秒 ASR ≈ 4,800 credits —— **ASR 本轮未接入**

### 验证

```
pnpm test       75 文件 / 883 测试全过
pnpm typecheck  exit 0
```

e2e 在真实 Chromium 覆盖：页面稳定后追加的直播消息（直播的真实形状）被翻译、译文是兄弟节点而非改写、中文与已删除消息零请求；双语字幕轨；API Key 旧配置迁移与远端 scrub。

---

## 二、Nexus：凭据与部署密钥收敛

起因是一次真实事故：生产长期缺失 `NUXT_INTELLIGENCE_ENCRYPT_KEY`，而部署预检始终绿灯。

净变化 **+366 / −1771**（已跟踪文件），新增文件 1372 行。

### 2.1 预检现在真的看生产

旧门禁只读 `deployment_configs.preview.env_vars`，而 `required` 恰好就是 preview 有的那四个 —— 结构上永远绿灯。

用事故当天的真实状态做对照实验：

```
OLD gate (preview-only): missing=[] -> PASSES (GREEN)
NEW gate:                FAILS  code=DEPLOYMENT_SECRET_INVENTORY_MISSING
                                env=production missing=["NUXT_INTELLIGENCE_ENCRYPT_KEY"]
NEW gate, key present:   PASSES (correct — not merely always-red)
```

第三行是关键：证明不是简单改成一直红。

清单新增 `productionRequired`：`NUXT_INTELLIGENCE_ENCRYPT_KEY`、`PROVIDER_REGISTRY_SECURE_STORE_KEY`、`NOTIFICATION_SECURE_STORE_KEY`。

`STORAGE_SECURE_STORE_KEY` **有意留在 feature-gated**：表 0 行、消费者已 fail-closed，升级它只会为未启用功能红灯所有发布。理由已写入 `SETUP.md`。

文件名做了干净切换 `preview-*` → `deployment-*`，全仓库零残留引用（含 `.github/workflows/ci.yml`、`.trellis/spec`、`package.json`）。

### 2.2 三份拷贝合一 + intelligence 并入

| 文件 | 行数 |
|---|---|
| `providerCredentialStore.ts` | 360 → 217 |
| `notificationCredentialStore.ts` | 486 → 191 |
| `storageCredentialStore.ts` | 413 → 112 |
| `intelligenceStore.ts` | 1425 → 1401 |
| `secureCredentialStore.ts`（新增共享核心） | — → 431 |

**最危险的一步，做了 bit 级验证** —— 用重构前的 HKDF 实现加密、重构后的密钥解密：

```
storage       key=IDENTICAL  kid=IDENTICAL  old-ciphertext-decrypts-with-new-key=true
notification  key=IDENTICAL  kid=IDENTICAL  old-ciphertext-decrypts-with-new-key=true
provider      key=IDENTICAL  kid=IDENTICAL  old-ciphertext-decrypts-with-new-key=true
intelligence  key=IDENTICAL
```

四组命名空间字符串逐字保留，现存密文全部仍可解密。

`decryptApiKeyLegacyXor` 已删（生产 0 行 legacy，复查确认）。删除理由写入注释：**它分不清 legacy 密文和损坏输入，会把 XOR 垃圾当明文 API key 返回**。现在非 GCM 值直接抛错。

**一处有意保留的差异**：三个 store 对 `process.env` 与 `runtimeConfig` 的优先级顺序原本不一致。值在实践中相同，统一它是不可观测的改动，但有非零概率在某个部署里变成可观测的。已在注释记录。

### 2.3 下载签名与会话密钥解耦

`AUTH_SECRET` 原本同时服务三个信任域。现在：

- 配了 `RELEASE_DOWNLOAD_SIGNING_SECRET` → **逐字使用**，轮换可预期
- 未配 → HKDF 子密钥（`release-download-signing:v1`），**不再用会话密钥的字节签下载**

测试证明：用裸 `AUTH_SECRET` 伪造的签名被拒，自己签的通过。

**`allowUnsignedFallback` 默认值有意未改。** 证据链：`releaseSignature.ts:22` 把未签名路径发布为 `fallbackDownloadUrl`，桌面端 `update-system.ts:226` 在 15 分钟签名过期后重试它。改成 fail-closed 会直接打断慢速与断点续传下载。已在定义处注明这是有意的可用性取舍并附消费者行号。

副作用：已签发 URL 在部署瞬间失效，15 分钟内经未签名回退自愈。

### 2.4 四个孤儿密钥已删

生产密钥 **22 → 18**：`TURNSTILE_SECRETKEY`、`TURNSTILE_SITEKEY`、`POSTGRES_URL`、`PILOT_NEXUS_BRIDGE_SECRET`。

删前确认 `TURNSTILE_*` 在 `Deploy/reg-factory` 的命中是无关项目自有配置，不是 Nexus 消费者。

### 2.5 预检接入定时监控（本次新增）

预检修好后仍无任何自动执行点。接入方式由三个事实决定，不是随手挂个 CI 步骤：

1. **生产不走 Actions。** Nexus 经 Cloudflare Pages 的 Git 集成部署，仓库里没有生产部署 job 可挂；`deploy:cf` 只覆盖 preview 路径。
2. **漂移是时间性的，不是提交性的。** 在 Cloudflare 面板删掉一个 Secret 不产生任何 commit —— PR 门禁永远不会在"真正弄坏生产的那次变更"上运行。
3. 该检查读的是 Cloudflare 实时状态，因此按时钟跑才有意义。

结论：**PR 门禁在结构上抓不到这个事故**。新增 `.github/workflows/nexus-deployment-secret-watch.yml`，沿用仓库已有的 `npm-token-watch.yml` 形状（每周一 02:30 UTC + 可手动触发）。

按退出码分类，只有真实漂移才开 issue：

| 退出码 | 分类 | 开 issue | 任务失败 |
|---|---|---|---|
| 0 | ok | 否 | 否 |
| 78 | **drift**（Secret 缺失 / plain_text / 本地 marker 远程绑定） | **是** | 是 |
| 64 | misconfigured（工作流自身缺 Cloudflare 凭据） | 否 | 是 |
| 其他 | unavailable（Cloudflare 不可达） | 否 | 是 |

64/69 不开 issue 是有意的：**在 Cloudflare 偶发 5xx 上弹"生产已坏"会把所有人训练成无视它** —— 这正是原事故长期隐形的机制。但它们仍让任务变红，因为"跑不起来的监控"不等于"生产健康"。

不装 pnpm：预检只 import `node:fs` 和一个相对路径文件，已实测在未安装 workspace 时正常运行。

验证（提取工作流里逐字的 case 语句与 step body 执行，测试不会与 CI 实跑的内容漂移）：

```
分类分支      exit 0/78/64/69/1 五条全部正确
端到端        无凭据 -> misconfigured（不开 issue）
              坏凭据 -> unavailable  （不开 issue）
事故态复现    生产缺 NUXT_INTELLIGENCE_ENCRYPT_KEY、preview 完整
              -> drift，开 issue
对照组        补回该 key -> ok，green（证明不是永远红）
其余漂移      plain_text 绑定 / 本地 marker 远程绑定 / preview==production 分支
              -> 三类全部 drift
YAML          ci.yml 与新工作流均通过真实 yaml parser
```

**仍需人工一步**：仓库尚未配置 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` 两个 repository secret（全仓库 grep 确认当前无任何 workflow 持有它们）。在配置前，该 watcher 每周会以 `misconfigured` 变红且不开 issue —— 这是有意的失败姿态：宁可显式红，不可静默绿。

### 验证

```
vitest run   251 文件 / 1817 测试全过
eslint       12 个改动文件 exit 0
密文兼容     上述 bit 级对照
预检         事故状态对照实验
```

---

## 三、未完成 / 阻塞

| # | 项 | 性质 | 说明 |
|---|---|---|---|
| 1 | ~~Nexus 改动未提交~~ | **已完成** | 已由 master `76eba22ae`（安全收敛）与 `73cd243`（watcher 脚本修复）合并入主线 |
| 2 | ~~预检未接入自动执行点~~ | **已完成** | 见 §2.5。新增每周 watcher，按退出码区分真实漂移与基础设施故障；事故态复现与健康对照均已验证 |
| 3 | Nexus 密钥轮换 | 主动跳过 | 第 3 项，本轮未做 |
| 4 | Nexus 设备授权真人验收 | 待验收 | 本地实机已拿到设备码并进入轮询，**未用真实账号完成批准**，因此不是已登录生产验收 |
| 5 | `text.translate` 生产定价证明 | 待验收 | 源码已落地 ≠ 已发布。需用已认证 `credits/pricing` + 一次真实结算回包证明 |
| 6 | Bilibili / 登录态 Discourse 频道回归 | 待验收 | 需真实登录态浏览器抽检 |
| 7 | 逐句对齐 + 双语 hover 高亮 | P2 | 见 INTEGRATION-PLAN §3，需先稳定句级合同 |
| 8 | Nexus 服务端翻译缓存 | P2 | 键 `(capability, targetLanguage, model, normalizedSourceHash)`；字幕与跨页复用需要它才能归零 |
| 9 | `tabCapture` + Nexus ASR | P3 | billable，明确暂不做 |
| 10 | Tuff 宿主 loopback / native messaging | P3 | 有明确宿主场景再开 |
| 11 | **配置 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` repository secret** | 需人工 | watcher 已就位但缺凭据；在配置前每周红灯（`misconfigured`，不开 issue）。这是有意的：宁可显式红，不可静默绿 |

### 本轮的一次环境故障

两个 subagent 因上游配额 403 中止（`cpa/deepseek-flash` `insufficient_quota`），非代码问题；对应四块工作已全部自行完成。

---

## 来源

- Lexi：`touch-xxeng-heart` @ `ff0702e`，工作树干净
- Nexus：`Projects/talex-touch/apps/nexus`，未提交改动（基线 `5cb25e761`）
- 生产密钥清单：`wrangler pages secret list --project-name tuff`（2026-09-14 实测）
