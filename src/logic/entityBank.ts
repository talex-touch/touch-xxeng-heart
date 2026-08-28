import type { EntityEntry } from './types'

/**
 * The built-in seed dictionary.
 *
 * It is deliberately small. Shipping a full domain lexicon inside a content script is
 * not affordable, and it would still miss the names that matter most on any given page
 * — this quarter's products, this paper's method, this filing's counterparties. So the
 * seed covers the terms that are *stable* (they mean the same thing next year) and the
 * terms that are *ambiguous* (they mean different things in different fields, which is
 * the one job a dictionary does better than a model reading one page). Everything else
 * is left to the AI pass in `entityDetection.ts`.
 *
 * Multi-sense entries lead the list because they are the reason this file exists at all.
 */

const ambiguousEntries: EntityEntry[] = [
  {
    term: 'volatile',
    senses: [
      { domain: 'tech', meaning: '易变的；C/C++/Java 中的变量修饰符，告诉编译器该变量可能被外部修改，不得缓存或重排。' },
      { domain: 'finance', meaning: '波动剧烈的：价格在短时间内大幅上下变动。' },
    ],
  },
  {
    term: 'position',
    senses: [
      { domain: 'tech', meaning: '位置、偏移量：元素或指针在序列、坐标系中的所在处。' },
      { domain: 'finance', meaning: '持仓、头寸：当前持有的某项资产及其规模和方向。' },
    ],
  },
  {
    term: 'security',
    aliases: ['securities'],
    senses: [
      { domain: 'finance', meaning: '证券：股票、债券等可交易的金融凭证。' },
      { domain: 'tech', meaning: '安全性：系统抵御未授权访问和攻击的能力。' },
    ],
  },
  {
    term: 'index',
    aliases: ['indices'],
    senses: [
      { domain: 'tech', meaning: '索引：为加速查询而建立的数据结构，或序列中的下标。' },
      { domain: 'finance', meaning: '指数：反映一篮子资产整体表现的基准，如标普 500。' },
    ],
  },
  {
    term: 'protocol',
    senses: [
      { domain: 'tech', meaning: '协议：双方通信时必须遵守的格式与流程约定。' },
      { domain: 'medical', meaning: '方案：临床试验或诊疗中预先写定、必须严格执行的操作规程。' },
    ],
  },
  {
    term: 'execution',
    senses: [
      { domain: 'tech', meaning: '执行：代码实际运行的过程。' },
      { domain: 'finance', meaning: '成交：委托订单在市场上被实际撮合的过程。' },
      { domain: 'legal', meaning: '签署：合同各方签字盖章使其正式生效。' },
    ],
  },
  {
    term: 'resolution',
    senses: [
      { domain: 'tech', meaning: '分辨率；也指依赖、域名或冲突的解析过程。' },
      { domain: 'legal', meaning: '决议：董事会或股东会表决通过的正式决定。' },
    ],
  },
  {
    term: 'class',
    senses: [
      { domain: 'tech', meaning: '类：面向对象中描述一组对象的数据与行为的模板。' },
      { domain: 'legal', meaning: '集体：集体诉讼中受同一行为影响、被合并处理的一群原告。' },
      { domain: 'medical', meaning: '分类：医疗器械按风险高低划分的监管等级，如 Class II。' },
    ],
  },
  {
    term: 'trial',
    senses: [
      { domain: 'medical', meaning: '临床试验：在人体上验证疗效与安全性的研究。' },
      { domain: 'legal', meaning: '庭审：法院对案件进行公开审理的程序。' },
    ],
  },
  {
    term: 'agent',
    senses: [
      { domain: 'tech', meaning: '智能体 / 代理：能自主调用工具完成任务的程序，或代表用户转发请求的中间件。' },
      { domain: 'medical', meaning: '制剂、因子：起治疗或致病作用的物质。' },
      { domain: 'legal', meaning: '代理人：获授权代表他人行事的一方。' },
    ],
  },
  {
    term: 'vector',
    senses: [
      { domain: 'tech', meaning: '向量：有序数值数组；也指攻击路径（attack vector）。' },
      { domain: 'medical', meaning: '载体、媒介：携带基因进入细胞的工具，或传播病原体的生物。' },
    ],
  },
  {
    term: 'host',
    senses: [
      { domain: 'tech', meaning: '主机：提供服务的机器或域名部分。' },
      { domain: 'medical', meaning: '宿主：被病原体或寄生物寄居的生物体。' },
    ],
  },
  {
    term: 'expression',
    senses: [
      { domain: 'tech', meaning: '表达式：可求值的代码片段。' },
      { domain: 'medical', meaning: '表达：基因被转录翻译成蛋白质的过程与水平。' },
    ],
  },
  {
    term: 'regression',
    senses: [
      { domain: 'tech', meaning: '回归缺陷：原本正常的功能在改动后重新出错。' },
      { domain: 'academic', meaning: '回归分析：用自变量拟合并预测因变量的统计方法。' },
    ],
  },
  {
    term: 'kernel',
    senses: [
      { domain: 'tech', meaning: '内核：操作系统中管理硬件与进程的核心部分。' },
      { domain: 'academic', meaning: '核函数：把数据隐式映射到高维空间以便线性可分的函数。' },
    ],
  },
  {
    term: 'buffer',
    senses: [
      { domain: 'tech', meaning: '缓冲区：临时存放数据以协调读写速度差异的内存区域。' },
      { domain: 'medical', meaning: '缓冲液：维持溶液 pH 稳定的试剂。' },
    ],
  },
  {
    term: 'migration',
    senses: [
      { domain: 'tech', meaning: '迁移：把数据或系统从一个结构、版本、平台转到另一个。' },
      { domain: 'medical', meaning: '迁移：细胞从原位向其他组织移动，如肿瘤转移的早期步骤。' },
    ],
  },
  {
    term: 'derivative',
    aliases: ['derivatives'],
    senses: [
      { domain: 'finance', meaning: '衍生品：价值取决于股票、利率等标的资产的合约，如期权、期货。' },
      { domain: 'academic', meaning: '导数：函数在某点的瞬时变化率。' },
    ],
  },
  {
    term: 'principal',
    senses: [
      { domain: 'finance', meaning: '本金：借贷或投资中不含利息的原始金额。' },
      { domain: 'legal', meaning: '委托人：授权代理人代为行事的一方。' },
    ],
  },
  {
    term: 'discovery',
    senses: [
      { domain: 'legal', meaning: '证据开示：诉讼中双方依法互相披露证据的程序。' },
      { domain: 'medical', meaning: '发现阶段：新药研发中筛选候选化合物的最早期。' },
      { domain: 'tech', meaning: '服务发现：让调用方在运行时自动找到可用服务实例的机制。' },
    ],
  },
  {
    term: 'instrument',
    senses: [
      { domain: 'finance', meaning: '金融工具：股票、债券、票据等可交易或可确权的合约。' },
      { domain: 'legal', meaning: '法律文书：具有法律效力的正式书面文件。' },
    ],
  },
  {
    term: 'equity',
    senses: [
      { domain: 'finance', meaning: '股权、净资产：对公司的所有权份额，或资产减负债后的剩余价值。' },
      { domain: 'legal', meaning: '衡平法：在普通法之外按公平原则给予救济的法律体系。' },
    ],
  },
  {
    term: 'subject',
    aliases: ['subjects'],
    senses: [
      { domain: 'medical', meaning: '受试者：参加临床研究的个体。' },
      { domain: 'legal', meaning: '主体：权利义务的承担者，如 data subject 数据主体。' },
    ],
  },
  {
    term: 'control',
    aliases: ['controls'],
    senses: [
      { domain: 'academic', meaning: '对照：为比较而设置的不施加干预的组别或条件。' },
      { domain: 'finance', meaning: '控制权：足以决定一家公司经营决策的表决权。' },
      { domain: 'tech', meaning: '控制：调节系统行为的机制或界面元素。' },
    ],
  },
  {
    term: 'bias',
    senses: [
      { domain: 'academic', meaning: '偏倚：研究设计或抽样导致结果系统性偏离真值。' },
      { domain: 'tech', meaning: '偏置项：神经网络中与权重并列、平移激活值的参数。' },
    ],
  },
  {
    term: 'power',
    senses: [
      { domain: 'academic', meaning: '统计效能：在效应真实存在时能被检出的概率。' },
      { domain: 'tech', meaning: '功耗：设备运行消耗的电能。' },
    ],
  },
  {
    term: 'sample',
    aliases: ['samples'],
    senses: [
      { domain: 'academic', meaning: '样本：从总体中抽取、用于推断整体的一部分个体。' },
      { domain: 'medical', meaning: '标本：从受试者采集用于检测的血液、组织等材料。' },
      { domain: 'tech', meaning: '采样：按固定间隔取值以离散化连续信号。' },
    ],
  },
  {
    term: 'abstract',
    senses: [
      { domain: 'academic', meaning: '摘要：论文开头概括研究问题、方法与结论的一段。' },
      { domain: 'tech', meaning: '抽象的：隐藏实现细节、只保留稳定接口。' },
    ],
  },
  {
    term: 'token',
    aliases: ['tokens'],
    senses: [
      { domain: 'tech', meaning: '令牌：用于鉴权的凭据；在大模型语境下指切分文本的最小计费单位「词元」。' },
      { domain: 'finance', meaning: '代币：区块链上代表某种权益或价值的可转让凭证。' },
    ],
  },
  {
    term: 'option',
    aliases: ['options'],
    senses: [
      { domain: 'finance', meaning: '期权：在约定时间以约定价格买卖标的资产的权利而非义务。' },
      { domain: 'tech', meaning: '选项：可开关或取值的配置项。' },
    ],
  },
  {
    term: 'yield',
    senses: [
      { domain: 'finance', meaning: '收益率：投资每年产生的回报占本金的比例。' },
      { domain: 'tech', meaning: 'yield：生成器中交出一个值并暂停执行的关键字。' },
    ],
  },
  {
    term: 'exposure',
    senses: [
      { domain: 'finance', meaning: '风险敞口：因持仓而暴露在某类风险下的金额。' },
      { domain: 'medical', meaning: '暴露：机体接触某种药物、病原或环境因素。' },
    ],
  },
  {
    term: 'dilution',
    senses: [
      { domain: 'finance', meaning: '稀释：新增发行股份使原股东持股比例下降。' },
      { domain: 'medical', meaning: '稀释：向样品中加入溶剂以降低浓度。' },
    ],
  },
  {
    term: 'resistance',
    senses: [
      { domain: 'medical', meaning: '耐药性：病原体或肿瘤对药物不再敏感。' },
      { domain: 'finance', meaning: '阻力位：价格反复上攻却难以突破的价位。' },
    ],
  },
  {
    term: 'branch',
    aliases: ['branches'],
    senses: [
      { domain: 'tech', meaning: '分支：版本库中一条独立的提交线。' },
      { domain: 'finance', meaning: '分支机构：银行或企业设在各地的营业网点。' },
    ],
  },
  {
    term: 'panel',
    senses: [
      { domain: 'medical', meaning: '检测组合：一次同时检测的一组指标，如肝功能 panel。' },
      { domain: 'academic', meaning: '专家小组；也指论文中并排的子图（panel a/b/c）。' },
      { domain: 'tech', meaning: '面板：界面中承载一组控件的区域。' },
    ],
  },
  {
    term: 'phase',
    senses: [
      { domain: 'medical', meaning: '分期：临床试验按 I–IV 期递进的阶段划分。' },
      { domain: 'tech', meaning: '阶段：流程中划分出的一段。' },
    ],
  },
  {
    term: 'pool',
    senses: [
      { domain: 'tech', meaning: '池：预先创建并复用资源的集合，如连接池、线程池。' },
      { domain: 'finance', meaning: '资金池：汇集多方资金统一运作的账户或安排。' },
    ],
  },
  {
    term: 'commit',
    senses: [
      { domain: 'tech', meaning: '提交：把一组改动写入版本库并生成一条记录。' },
      { domain: 'finance', meaning: '承诺出资：投资人书面承诺在未来注入的资金额度。' },
    ],
  },
  {
    term: 'novel',
    senses: [
      { domain: 'academic', meaning: '新颖的：论文用来主张该工作此前未被提出。' },
      { domain: 'medical', meaning: '新型的：此前未在人群中出现过的，如 novel coronavirus。' },
    ],
  },
  {
    term: 'induction',
    senses: [
      { domain: 'medical', meaning: '诱导：用药物启动某个生理过程，如诱导缓解、引产。' },
      { domain: 'academic', meaning: '归纳：从具体观察推出一般结论的推理方式。' },
    ],
  },
  {
    term: 'party',
    aliases: ['parties'],
    senses: [
      { domain: 'legal', meaning: '当事方：合同或诉讼中承担权利义务的一方。' },
      { domain: 'tech', meaning: '方：third-party 指由外部提供、非本系统自有的组件或服务。' },
    ],
  },
]

const techEntries: EntityEntry[] = [
  { term: 'MCP', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Model Context Protocol', meaning: '模型上下文协议：让大模型以统一方式接入外部工具和数据源的开放协议。' }] },
  { term: 'API', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Application Programming Interface', meaning: '应用程序接口：程序之间调用彼此功能的约定。' }] },
  { term: 'SDK', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Software Development Kit', meaning: '软件开发工具包：封装好接口与工具，方便接入某个平台。' }] },
  { term: 'CI/CD', senses: [{ domain: 'tech', expansion: 'Continuous Integration / Continuous Delivery', meaning: '持续集成与持续交付：代码提交后自动构建、测试并发布的流水线。' }] },
  { term: 'LLM', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Large Language Model', meaning: '大语言模型：在海量文本上训练、按上下文预测下一个词元的模型。' }] },
  { term: 'RAG', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Retrieval-Augmented Generation', meaning: '检索增强生成：先检索资料再交给模型作答，减少凭空编造。' }] },
  { term: 'RPC', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Remote Procedure Call', meaning: '远程过程调用：像调用本地函数一样调用另一台机器上的服务。' }] },
  { term: 'CRDT', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Conflict-free Replicated Data Type', meaning: '无冲突复制数据类型：多端并发修改后能自动收敛到同一状态的数据结构。' }] },
  { term: 'SLA', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Service Level Agreement', meaning: '服务等级协议：服务方对可用性、响应时间等指标的书面承诺。' }] },
  { term: 'SLO', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Service Level Objective', meaning: '服务等级目标：团队内部为可用性等指标设定的量化目标。' }] },
  { term: 'CDN', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Content Delivery Network', meaning: '内容分发网络：把静态资源缓存到离用户更近的节点。' }] },
  { term: 'JWT', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'JSON Web Token', meaning: '一种自带签名的紧凑令牌格式，常用于无状态身份验证。' }] },
  { term: 'OAuth', senses: [{ domain: 'tech', meaning: '一种授权框架：让第三方应用在不拿到密码的前提下获得受限访问权。' }] },
  { term: 'ORM', caseSensitive: true, senses: [{ domain: 'tech', expansion: 'Object-Relational Mapping', meaning: '对象关系映射：用对象操作数据库表，屏蔽 SQL 细节。' }] },
  { term: 'idempotent', aliases: ['idempotency', 'idempotence'], senses: [{ domain: 'tech', meaning: '幂等：同一请求执行多次与执行一次结果相同，重试因此安全。' }] },
  { term: 'backpressure', senses: [{ domain: 'tech', meaning: '背压：下游处理不过来时向上游反向施加的限速信号。' }] },
  { term: 'race condition', senses: [{ domain: 'tech', meaning: '竞态条件：结果取决于并发操作的先后顺序，因而不可预测。' }] },
  { term: 'memory leak', senses: [{ domain: 'tech', meaning: '内存泄漏：已不再使用的内存未被释放，占用持续增长。' }] },
  { term: 'technical debt', senses: [{ domain: 'tech', meaning: '技术债：为赶进度而采用的临时方案，日后需要额外成本偿还。' }] },
  { term: 'observability', senses: [{ domain: 'tech', meaning: '可观测性：仅凭日志、指标和链路追踪就能推断系统内部状态的程度。' }] },
  { term: 'canary release', aliases: ['canary deployment'], senses: [{ domain: 'tech', meaning: '金丝雀发布：先向一小部分流量放量，确认无异常再全量。' }] },
  { term: 'feature flag', aliases: ['feature flags', 'feature toggle'], senses: [{ domain: 'tech', meaning: '功能开关：不重新发版就能打开或关闭某个功能的配置。' }] },
  { term: 'rate limit', aliases: ['rate limiting'], senses: [{ domain: 'tech', meaning: '限流：限制单位时间内允许的请求数，保护后端不被打垮。' }] },
  { term: 'eventual consistency', senses: [{ domain: 'tech', meaning: '最终一致性：副本短期内可能不一致，但在没有新写入后会收敛一致。' }] },
  { term: 'load balancer', aliases: ['load balancing'], senses: [{ domain: 'tech', meaning: '负载均衡：把请求分摊到多台服务器，避免单点过载。' }] },
  { term: 'reverse proxy', senses: [{ domain: 'tech', meaning: '反向代理：代表后端服务器接收客户端请求并转发的中间层。' }] },
  { term: 'sharding', aliases: ['shard'], senses: [{ domain: 'tech', meaning: '分片：把一份数据水平切成多份分散存储，以突破单机容量。' }] },
  { term: 'garbage collection', senses: [{ domain: 'tech', meaning: '垃圾回收：运行时自动释放不再被引用的内存。' }] },
  { term: 'cold start', senses: [{ domain: 'tech', meaning: '冷启动：实例从零开始初始化导致首次请求明显变慢。' }] },
  { term: 'time to first byte', aliases: ['TTFB'], senses: [{ domain: 'tech', meaning: '首字节时间：从发出请求到收到响应第一个字节的耗时。' }] },
  { term: 'monorepo', senses: [{ domain: 'tech', meaning: '单体仓库：多个项目共用一个版本库统一管理依赖与发布。' }] },
  { term: 'tree shaking', senses: [{ domain: 'tech', meaning: '摇树优化：打包时剔除未被引用的代码。' }] },
  { term: 'hydration', senses: [{ domain: 'tech', meaning: '水合：前端在服务端渲染的静态 HTML 上接管事件，使其可交互。' }] },
  { term: 'quantization', senses: [{ domain: 'tech', meaning: '量化：把模型权重降到更低精度以减小体积、加快推理。' }] },
  { term: 'fine-tuning', aliases: ['fine-tune'], senses: [{ domain: 'tech', meaning: '微调：在预训练模型上用特定数据继续训练以适配任务。' }] },
  { term: 'embedding', aliases: ['embeddings'], senses: [{ domain: 'tech', meaning: '嵌入向量：把文本或图像映射成一组数值，使语义相近的内容距离更近。' }] },
  { term: 'hallucination', senses: [{ domain: 'tech', meaning: '幻觉：模型生成看似合理但与事实不符的内容。' }] },
  { term: 'context window', senses: [{ domain: 'tech', meaning: '上下文窗口：模型单次能一起处理的最大词元数量。' }] },
  { term: 'zero-day', aliases: ['zero day'], senses: [{ domain: 'tech', meaning: '零日漏洞：厂商尚未修复、已被利用的安全漏洞。' }] },
  { term: 'supply chain attack', senses: [{ domain: 'tech', meaning: '供应链攻击：通过污染依赖库或构建流程间接入侵下游用户。' }] },
]

const financeEntries: EntityEntry[] = [
  { term: 'ARR', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Annual Recurring Revenue', meaning: '年度经常性收入：订阅业务一年内可重复取得的收入，比一次性收入更能反映稳定性。' }] },
  { term: 'MRR', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Monthly Recurring Revenue', meaning: '月度经常性收入：订阅业务每月可重复取得的收入。' }] },
  { term: 'EBITDA', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Earnings Before Interest, Taxes, Depreciation and Amortization', meaning: '息税折旧摊销前利润：剔除资本结构与折旧影响后的经营利润近似值。' }] },
  { term: 'CAC', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Customer Acquisition Cost', meaning: '获客成本：平均获得一个付费客户所花的营销与销售费用。' }] },
  { term: 'LTV', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Lifetime Value', meaning: '客户终身价值：一个客户在整个生命周期内预计带来的总利润。' }] },
  { term: 'IPO', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Initial Public Offering', meaning: '首次公开发行：公司首次向公众出售股份并挂牌上市。' }] },
  { term: 'M&A', senses: [{ domain: 'finance', expansion: 'Mergers and Acquisitions', meaning: '并购：企业之间的合并与收购交易。' }] },
  { term: 'ROI', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Return on Investment', meaning: '投资回报率：净收益与投入成本的比值。' }] },
  { term: 'CAGR', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Compound Annual Growth Rate', meaning: '复合年均增长率：把多年增长折算成每年恒定的增速。' }] },
  { term: 'P/E', aliases: ['PE ratio', 'price-to-earnings'], senses: [{ domain: 'finance', meaning: '市盈率：股价除以每股收益，衡量为每单位盈利支付的价格。' }] },
  { term: 'post-money valuation', senses: [{ domain: 'finance', meaning: '投后估值：本轮融资完成、资金到账后公司的整体估值。' }] },
  { term: 'pre-money valuation', senses: [{ domain: 'finance', meaning: '投前估值：本轮资金注入之前公司的估值。' }] },
  { term: 'Series A', senses: [{ domain: 'finance', meaning: 'A 轮融资：产品初步验证后引入机构投资人的第一轮正式股权融资。' }] },
  { term: 'Series B', senses: [{ domain: 'finance', meaning: 'B 轮融资：业务模式跑通后用于扩张的股权融资。' }] },
  { term: 'Series C', senses: [{ domain: 'finance', meaning: 'C 轮融资：规模化阶段的股权融资，常伴随并购或国际化。' }] },
  { term: 'Series D', senses: [{ domain: 'finance', meaning: 'D 轮融资：后期股权融资，通常用于继续扩张或补充现金。' }] },
  { term: 'Series E', senses: [{ domain: 'finance', meaning: 'E 轮融资：更晚期的股权融资，公司多已具备规模收入。' }] },
  { term: 'Series F', senses: [{ domain: 'finance', meaning: 'F 轮融资：上市前的后期股权融资，投资人常为成长基金或战略方。' }] },
  { term: 'burn rate', senses: [{ domain: 'finance', meaning: '烧钱速度：公司每月净消耗的现金。' }] },
  { term: 'runway', senses: [{ domain: 'finance', meaning: '现金跑道：按当前烧钱速度，账上资金还能支撑的月数。' }] },
  { term: 'cap table', aliases: ['capitalization table'], senses: [{ domain: 'finance', meaning: '股权结构表：记录各股东持股数量、比例与轮次的表格。' }] },
  { term: 'term sheet', senses: [{ domain: 'finance', meaning: '投资条款清单：约定估值、股份与主要权利的框架性文件，多数条款不具强制约束力。' }] },
  { term: 'due diligence', senses: [{ domain: 'finance', meaning: '尽职调查：交易前对财务、法务、业务进行的系统性核查。' }] },
  { term: 'basis point', aliases: ['basis points', 'bps'], senses: [{ domain: 'finance', meaning: '基点：万分之一，用于精确表述利率或费率的变动。' }] },
  { term: 'gross margin', senses: [{ domain: 'finance', meaning: '毛利率：收入减去直接成本后占收入的比例。' }] },
  { term: 'net revenue retention', aliases: ['NRR'], senses: [{ domain: 'finance', meaning: '净收入留存率：现有客户群本期收入相对上期的比例，含扩张与流失。' }] },
  { term: 'churn', aliases: ['churn rate'], senses: [{ domain: 'finance', meaning: '流失率：单位时间内取消订阅的客户或收入占比。' }] },
  { term: 'per-seat', aliases: ['per seat pricing'], senses: [{ domain: 'finance', meaning: '按席位计费：按使用人数而非用量收费的定价方式。' }] },
  { term: 'annual contract value', aliases: ['ACV'], senses: [{ domain: 'finance', meaning: '年度合同价值：一份合同折算到每年的金额。' }] },
  { term: 'free cash flow', senses: [{ domain: 'finance', meaning: '自由现金流：经营现金流扣除资本开支后可自由支配的现金。' }] },
  { term: 'working capital', senses: [{ domain: 'finance', meaning: '营运资金：流动资产减流动负债，反映短期偿付能力。' }] },
  { term: 'liquidation preference', senses: [{ domain: 'finance', meaning: '清算优先权：公司清算或被收购时投资人先于普通股东按约定倍数收回本金的权利。' }] },
  { term: 'preferred stock', aliases: ['preferred shares'], senses: [{ domain: 'finance', meaning: '优先股：在分红和清算顺序上优先于普通股的股份。' }] },
  { term: 'convertible note', senses: [{ domain: 'finance', meaning: '可转债：先以借款形式投入、在下一轮按折扣转为股权的工具。' }] },
  { term: 'SAFE', caseSensitive: true, senses: [{ domain: 'finance', expansion: 'Simple Agreement for Future Equity', meaning: '未来股权简单协议：先付款、待下轮融资再确定股份的早期投资工具。' }] },
  { term: 'vesting', aliases: ['vest', 'cliff'], senses: [{ domain: 'finance', meaning: '归属：股权或期权按服务年限分批真正到手的安排。' }] },
  { term: 'dry powder', senses: [{ domain: 'finance', meaning: '待投资金：基金已募集但尚未投出的现金。' }] },
  { term: 'bear market', senses: [{ domain: 'finance', meaning: '熊市：价格从高点持续下跌约两成以上的市场阶段。' }] },
  { term: 'bull market', senses: [{ domain: 'finance', meaning: '牛市：价格持续上涨、投资者情绪乐观的市场阶段。' }] },
  { term: 'short selling', aliases: ['short sell'], senses: [{ domain: 'finance', meaning: '卖空：先借入并卖出资产，待价格下跌后买回归还以赚取差价。' }] },
  { term: 'market cap', aliases: ['market capitalization'], senses: [{ domain: 'finance', meaning: '市值：股价乘以总股本，表示公司在市场上的整体定价。' }] },
]

const productEntries: EntityEntry[] = [
  { term: 'Claude Code', senses: [{ domain: 'product', meaning: 'Anthropic 推出的终端 AI 编程代理，可直接读写仓库、执行命令，并通过 MCP 接入外部工具。' }] },
  { term: 'Anthropic', senses: [{ domain: 'product', meaning: '美国 AI 公司，Claude 系列模型的开发者。' }] },
  { term: 'OpenAI', senses: [{ domain: 'product', meaning: '美国 AI 公司，GPT 系列模型与 ChatGPT 的开发者。' }] },
  { term: 'ChatGPT', senses: [{ domain: 'product', meaning: 'OpenAI 的对话式 AI 产品。' }] },
  { term: 'GitHub Actions', senses: [{ domain: 'product', meaning: 'GitHub 内置的 CI/CD 服务，用 YAML 定义在仓库事件触发时运行的工作流。' }] },
  { term: 'Kubernetes', aliases: ['K8s'], senses: [{ domain: 'product', meaning: '开源容器编排系统，负责调度、扩缩容和自愈。' }] },
  { term: 'Docker', senses: [{ domain: 'product', meaning: '容器化工具，把应用及其依赖打包成可移植的镜像。' }] },
  { term: 'PostgreSQL', aliases: ['Postgres'], senses: [{ domain: 'product', meaning: '开源关系型数据库，以标准兼容性和扩展能力著称。' }] },
  { term: 'Redis', senses: [{ domain: 'product', meaning: '开源内存数据结构存储，常用作缓存、队列和会话存储。' }] },
  { term: 'TypeScript', senses: [{ domain: 'product', meaning: 'JavaScript 的超集，增加静态类型检查后编译回 JavaScript。' }] },
  { term: 'React', senses: [{ domain: 'product', meaning: 'Meta 开源的前端框架，用组件和虚拟 DOM 构建界面。' }] },
  { term: 'Vue', senses: [{ domain: 'product', meaning: '渐进式前端框架，以响应式数据和单文件组件为核心。' }] },
  { term: 'Next.js', senses: [{ domain: 'product', meaning: '基于 React 的全栈框架，内置路由、服务端渲染和构建优化。' }] },
  { term: 'Vite', senses: [{ domain: 'product', meaning: '前端构建工具，开发期用原生 ESM 实现近乎即时的热更新。' }] },
  { term: 'Rust', senses: [{ domain: 'product', meaning: '系统编程语言，用所有权机制在无 GC 的前提下保证内存安全。' }] },
  { term: 'Cloudflare', senses: [{ domain: 'product', meaning: '提供 CDN、DNS、安全防护和边缘计算的基础设施公司。' }] },
  { term: 'AWS', caseSensitive: true, senses: [{ domain: 'product', expansion: 'Amazon Web Services', meaning: '亚马逊的云计算平台。' }] },
  { term: 'Terraform', senses: [{ domain: 'product', meaning: '基础设施即代码工具，用声明式配置管理云资源。' }] },
  { term: 'Figma', senses: [{ domain: 'product', meaning: '浏览器端协作式界面设计工具。' }] },
  { term: 'Stripe', senses: [{ domain: 'product', meaning: '面向开发者的在线支付基础设施公司。' }] },
  { term: 'Notion', senses: [{ domain: 'product', meaning: '把文档、数据库和协作整合在一起的工作空间产品。' }] },
  { term: 'Slack', senses: [{ domain: 'product', meaning: '面向团队的频道式即时通讯与协作平台。' }] },
  { term: 'Snowflake', senses: [{ domain: 'product', meaning: '云数据仓库平台，存储与计算分离按用量计费。' }] },
  { term: 'Databricks', senses: [{ domain: 'product', meaning: '基于 Spark 的数据与 AI 平台，主打湖仓一体架构。' }] },
  { term: 'Hugging Face', senses: [{ domain: 'product', meaning: '开源模型与数据集托管平台，也是 transformers 库的维护方。' }] },
  { term: 'NVIDIA', senses: [{ domain: 'product', meaning: 'GPU 与 AI 加速硬件厂商，CUDA 生态的提供方。' }] },
  { term: 'infrastructure SaaS', senses: [{ domain: 'product', meaning: '基础设施型 SaaS：向开发者按用量出售底层能力而非面向终端用户的软件。' }] },
]

const medicalEntries: EntityEntry[] = [
  { term: 'Phase I', senses: [{ domain: 'medical', meaning: '一期临床试验：在少量健康人或患者中评估安全性与耐受剂量，通常几十人。' }] },
  { term: 'Phase II', aliases: ['Phase II trial'], senses: [{ domain: 'medical', meaning: '二期临床试验：在较小规模患者中验证疗效并继续观察安全性，通常 100–300 人。' }] },
  { term: 'Phase III', senses: [{ domain: 'medical', meaning: '三期临床试验：大规模随机对照验证疗效，是上市申请的主要依据。' }] },
  { term: 'randomized controlled trial', aliases: ['RCT'], senses: [{ domain: 'medical', meaning: '随机对照试验：把受试者随机分入试验组和对照组以排除选择偏倚。' }] },
  { term: 'double-blind', aliases: ['double blind'], senses: [{ domain: 'medical', meaning: '双盲：受试者和研究者都不知道分组，避免主观预期影响结果。' }] },
  { term: 'placebo', senses: [{ domain: 'medical', meaning: '安慰剂：不含活性成分、外观与试验药相同的对照制剂。' }] },
  { term: 'efficacy', senses: [{ domain: 'medical', meaning: '疗效：药物在严格控制的试验条件下产生的治疗效果。' }] },
  { term: 'adverse event', aliases: ['adverse events'], senses: [{ domain: 'medical', meaning: '不良事件：用药期间出现的任何不利医学事件，不必然由药物引起。' }] },
  { term: 'contraindication', senses: [{ domain: 'medical', meaning: '禁忌症：存在该情况时不得使用某种治疗。' }] },
  { term: 'pharmacokinetics', senses: [{ domain: 'medical', meaning: '药代动力学：机体对药物的吸收、分布、代谢和排泄过程。' }] },
  { term: 'half-life', senses: [{ domain: 'medical', meaning: '半衰期：血药浓度下降到一半所需的时间。' }] },
  { term: 'biomarker', aliases: ['biomarkers'], senses: [{ domain: 'medical', meaning: '生物标志物：可客观测量、反映疾病状态或治疗反应的指标。' }] },
  // Both readings are everyday words in their own field, so this must never be single-sense.
  {
    term: 'endpoint',
    aliases: ['primary endpoint'],
    senses: [
      { domain: 'medical', meaning: '终点指标：临床试验中预先规定用于判定成败的疗效度量。' },
      { domain: 'tech', meaning: '端点：一个可被调用的网络地址，通常对应某个 API 路径。' },
    ],
  },
  { term: 'in vivo', senses: [{ domain: 'medical', meaning: '体内：在完整活体中进行的实验。' }] },
  { term: 'in vitro', senses: [{ domain: 'medical', meaning: '体外：在试管或培养皿等活体之外的环境中进行的实验。' }] },
  { term: 'antibody', aliases: ['antibodies'], senses: [{ domain: 'medical', meaning: '抗体：免疫系统产生、能特异识别并结合抗原的蛋白质。' }] },
  { term: 'monoclonal antibody', senses: [{ domain: 'medical', meaning: '单克隆抗体：由同一克隆细胞产生、只识别单一表位的高特异性抗体。' }] },
  { term: 'immunotherapy', senses: [{ domain: 'medical', meaning: '免疫治疗：通过激活或改造免疫系统来对抗疾病，尤其是肿瘤。' }] },
  { term: 'CRISPR', caseSensitive: true, senses: [{ domain: 'medical', meaning: '基因编辑技术：用向导 RNA 引导核酸酶在指定位点切开 DNA 以实现精确改造。' }] },
  { term: 'mRNA', senses: [{ domain: 'medical', meaning: '信使 RNA：把 DNA 上的遗传信息传递到核糖体用于合成蛋白质的分子。' }] },
  { term: 'genotype', senses: [{ domain: 'medical', meaning: '基因型：个体在某个基因位点上携带的具体等位基因组合。' }] },
  { term: 'phenotype', senses: [{ domain: 'medical', meaning: '表型：基因与环境共同作用下表现出的可观察特征。' }] },
  { term: 'comorbidity', aliases: ['comorbidities'], senses: [{ domain: 'medical', meaning: '共病：与主要疾病同时存在的其他疾病。' }] },
  { term: 'prognosis', senses: [{ domain: 'medical', meaning: '预后：对疾病发展过程和结局的预判。' }] },
  { term: 'incidence', senses: [{ domain: 'medical', meaning: '发病率：一定时期内新发病例占易感人群的比例。' }] },
  { term: 'prevalence', senses: [{ domain: 'medical', meaning: '患病率：某一时点人群中现患该病者所占比例。' }] },
  { term: 'cohort study', senses: [{ domain: 'medical', meaning: '队列研究：追踪一组人随时间的暴露与结局，属于观察性研究。' }] },
  { term: 'informed consent', senses: [{ domain: 'medical', meaning: '知情同意：受试者在充分了解风险与收益后自愿参加研究的书面确认。' }] },
  { term: 'IRB', caseSensitive: true, senses: [{ domain: 'medical', expansion: 'Institutional Review Board', meaning: '伦理审查委员会：审查并监督涉及人体研究的独立机构。' }] },
  { term: 'FDA clearance', aliases: ['510(k)'], senses: [{ domain: 'medical', meaning: 'FDA 许可：证明器械与已上市同类产品实质等同后获准销售，区别于更严格的 PMA 批准。' }] },
]

const legalEntries: EntityEntry[] = [
  { term: 'GDPR', caseSensitive: true, senses: [{ domain: 'legal', expansion: 'General Data Protection Regulation', meaning: '欧盟通用数据保护条例：规范个人数据处理，违规最高可罚全球年营收 4%。' }] },
  { term: 'CCPA', caseSensitive: true, senses: [{ domain: 'legal', expansion: 'California Consumer Privacy Act', meaning: '加州消费者隐私法：赋予居民知情、删除和拒绝出售个人信息的权利。' }] },
  { term: 'SOC 2', senses: [{ domain: 'legal', meaning: '一项安全合规审计标准，评估服务商在安全、可用性和保密性上的控制措施。' }] },
  { term: 'NDA', caseSensitive: true, senses: [{ domain: 'legal', expansion: 'Non-Disclosure Agreement', meaning: '保密协议：约定接收方不得披露或另作他用的合同。' }] },
  { term: 'SLA breach', senses: [{ domain: 'legal', meaning: '服务等级违约：未达到合同承诺指标而触发赔偿或减免条款。' }] },
  { term: 'indemnity', aliases: ['indemnification', 'indemnify'], senses: [{ domain: 'legal', meaning: '赔偿承诺：一方同意为另一方因特定事由产生的损失买单。' }] },
  { term: 'force majeure', senses: [{ domain: 'legal', meaning: '不可抗力：因战争、天灾等无法预见和控制的事件而免除违约责任。' }] },
  { term: 'jurisdiction', senses: [{ domain: 'legal', meaning: '管辖权：某一法院或机关对特定案件有权受理和裁判。' }] },
  { term: 'arbitration', senses: [{ domain: 'legal', meaning: '仲裁：由双方选定的仲裁庭而非法院作出终局裁决的争议解决方式。' }] },
  { term: 'injunction', senses: [{ domain: 'legal', meaning: '禁令：法院命令一方作出或停止某种行为的强制措施。' }] },
  { term: 'antitrust', senses: [{ domain: 'legal', meaning: '反垄断：规制垄断、串通和滥用市场支配地位的法律领域。' }] },
  { term: 'fiduciary duty', senses: [{ domain: 'legal', meaning: '受信义务：董事等受托人必须以受益人利益优先行事的法定责任。' }] },
  { term: 'safe harbor', senses: [{ domain: 'legal', meaning: '避风港：满足特定条件即可免于承担责任的法定豁免。' }] },
  { term: 'material adverse change', aliases: ['MAC clause'], senses: [{ domain: 'legal', meaning: '重大不利变化：交易签署后目标公司严重恶化时买方可退出的条款。' }] },
  { term: 'non-compete', aliases: ['noncompete'], senses: [{ domain: 'legal', meaning: '竞业限制：约定离职后一定期限内不得从事竞争性业务。' }] },
  { term: 'intellectual property', aliases: ['IP rights'], senses: [{ domain: 'legal', meaning: '知识产权：专利、商标、著作权和商业秘密等无形财产权利的统称。' }] },
  { term: 'prior art', senses: [{ domain: 'legal', meaning: '现有技术：申请日之前已公开的技术，可用于否定专利的新颖性。' }] },
  { term: 'cease and desist', senses: [{ domain: 'legal', meaning: '停止侵害函：要求对方立即停止特定行为的正式通知。' }] },
  { term: 'class action', senses: [{ domain: 'legal', meaning: '集体诉讼：由代表人为一大群处境相同的当事人统一提起的诉讼。' }] },
  { term: 'settlement', senses: [{ domain: 'legal', meaning: '和解：双方达成协议了结争议，通常不认定责任。' }] },
  { term: 'liability cap', aliases: ['limitation of liability'], senses: [{ domain: 'legal', meaning: '责任上限：合同约定的赔偿金额天花板。' }] },
  { term: 'governing law', senses: [{ domain: 'legal', meaning: '准据法：合同约定用来解释和裁判争议的法律体系。' }] },
  { term: 'data processor', senses: [{ domain: 'legal', meaning: '数据处理者：按控制者指示处理个人数据的一方。' }] },
  { term: 'data controller', senses: [{ domain: 'legal', meaning: '数据控制者：决定个人数据处理目的和方式的一方。' }] },
  { term: 'right to be forgotten', senses: [{ domain: 'legal', meaning: '被遗忘权：数据主体要求删除其个人数据的权利。' }] },
  { term: 'copyleft', senses: [{ domain: 'legal', meaning: '著佐权：要求衍生作品必须沿用同一开源许可证的条款，如 GPL。' }] },
  { term: 'Class II', senses: [{ domain: 'legal', meaning: '二类医疗器械：中等风险、需通过特别控制和上市前通知的监管类别。' }] },
]

const academicEntries: EntityEntry[] = [
  { term: 'peer-reviewed', aliases: ['peer review'], senses: [{ domain: 'academic', meaning: '同行评议：论文发表前由同领域研究者匿名审阅把关。' }] },
  { term: 'preprint', senses: [{ domain: 'academic', meaning: '预印本：尚未经同行评议就公开发布的论文稿件。' }] },
  { term: 'p-value', senses: [{ domain: 'academic', meaning: 'P 值：若原假设为真，观察到当前或更极端结果的概率。' }] },
  // `CI` is left out on purpose: it reads as continuous integration far more often than as this.
  { term: 'confidence interval', senses: [{ domain: 'academic', meaning: '置信区间：在给定置信水平下，估计值可能落入的范围。' }] },
  { term: 'effect size', senses: [{ domain: 'academic', meaning: '效应量：差异或关联的实际大小，与是否显著是两回事。' }] },
  { term: 'meta-analysis', senses: [{ domain: 'academic', meaning: '荟萃分析：合并多项同类研究的数据以得到更稳健的综合结论。' }] },
  { term: 'systematic review', senses: [{ domain: 'academic', meaning: '系统综述：按预设标准穷尽检索并评估某问题全部证据的研究。' }] },
  { term: 'ablation study', aliases: ['ablation'], senses: [{ domain: 'academic', meaning: '消融实验：逐一去掉模型的组成部分以衡量各自贡献。' }] },
  { term: 'baseline', senses: [{ domain: 'academic', meaning: '基线：用于对比的参照方法或起始水平。' }] },
  { term: 'state-of-the-art', aliases: ['SOTA'], senses: [{ domain: 'academic', meaning: '当前最优：在公认基准上取得的最好成绩。' }] },
  { term: 'reproducibility', aliases: ['reproducible'], senses: [{ domain: 'academic', meaning: '可复现性：他人依照所述方法和数据能得到相同结果的程度。' }] },
  { term: 'confounder', aliases: ['confounding'], senses: [{ domain: 'academic', meaning: '混杂因素：同时影响暴露与结局、使关联被高估或低估的第三方变量。' }] },
  { term: 'cross-validation', senses: [{ domain: 'academic', meaning: '交叉验证：轮换划分训练集与验证集以更可靠地估计模型泛化能力。' }] },
  { term: 'overfitting', senses: [{ domain: 'academic', meaning: '过拟合：模型记住了训练数据的噪声，在新数据上表现下降。' }] },
  { term: 'ground truth', senses: [{ domain: 'academic', meaning: '真值标注：被当作正确答案的参考标签。' }] },
  { term: 'null hypothesis', senses: [{ domain: 'academic', meaning: '原假设：假定不存在效应或差异的默认命题，检验的对象。' }] },
  { term: 'longitudinal study', senses: [{ domain: 'academic', meaning: '纵向研究：对同一批对象在较长时间内反复观测。' }] },
  { term: 'corpus', aliases: ['corpora'], senses: [{ domain: 'academic', meaning: '语料库：为研究或训练而收集整理的大规模文本集合。' }] },
  { term: 'inter-rater reliability', senses: [{ domain: 'academic', meaning: '评分者间信度：不同标注者对同一材料给出一致判断的程度。' }] },
  { term: 'impact factor', senses: [{ domain: 'academic', meaning: '影响因子：期刊近两年论文的平均被引次数，常被用作期刊影响力的粗略代理。' }] },
  { term: 'DOI', caseSensitive: true, senses: [{ domain: 'academic', expansion: 'Digital Object Identifier', meaning: '数字对象唯一标识符：论文等资源的永久编号。' }] },
  { term: 'et al.', aliases: ['et al'], senses: [{ domain: 'academic', meaning: '等人：引用多作者文献时省略其余作者的拉丁文缩写。' }] },
  { term: 'literature review', senses: [{ domain: 'academic', meaning: '文献综述：梳理并评述某一问题已有研究的部分。' }] },
  { term: 'open access', senses: [{ domain: 'academic', meaning: '开放获取：读者无需付费即可阅读全文的出版模式。' }] },
  { term: 'citation index', senses: [{ domain: 'academic', meaning: '引文索引：按被引关系组织文献、用于追踪学术影响的数据库。' }] },
]

export const entitySeedBank: EntityEntry[] = [
  ...ambiguousEntries,
  ...techEntries,
  ...financeEntries,
  ...productEntries,
  ...medicalEntries,
  ...legalEntries,
  ...academicEntries,
]

/** Surfaces the dictionary can actually match, aliases included. Kept honest for the UI to quote. */
export const entitySeedSurfaceCount = entitySeedBank
  .reduce((total, entry) => total + 1 + (entry.aliases?.length ?? 0), 0)
