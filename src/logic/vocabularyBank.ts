import type { VocabularyCandidate } from './types'

export const programmerVocabulary: VocabularyCandidate[] = [
  {
    original: '上下文',
    replacement: 'context',
    pronunciation: '/ˈkɑːntekst/',
    meaning: '运行、阅读或推理时依赖的背景信息。',
    example: 'The model needs enough context to infer the user intent.',
    tags: ['programming', 'ai'],
    difficulty: 2,
  },
  {
    original: '配置',
    replacement: 'configuration',
    pronunciation: '/kənˌfɪɡjəˈreɪʃn/',
    meaning: '控制系统行为的参数集合。',
    example: 'Each scene can use an independent model configuration.',
    tags: ['system'],
    difficulty: 2,
  },
  {
    original: '启用',
    replacement: 'enable',
    pronunciation: '/ɪˈneɪbl/',
    meaning: '让某个功能开始生效。',
    example: 'Enable replacement only on documentation pages.',
    tags: ['product'],
    difficulty: 1,
  },
  {
    original: '关闭',
    replacement: 'disable',
    pronunciation: '/dɪsˈeɪbl/',
    meaning: '让某个功能停止生效。',
    example: 'Disable selection translation on sensitive websites.',
    tags: ['product'],
    difficulty: 1,
  },
  {
    original: '推断',
    replacement: 'infer',
    pronunciation: '/ɪnˈfɜːr/',
    meaning: '基于已有信息得到合理结论。',
    example: 'The extension can infer meaning from nearby sentences.',
    tags: ['ai'],
    difficulty: 3,
  },
  {
    original: '替换',
    replacement: 'substitute',
    pronunciation: '/ˈsʌbstɪtuːt/',
    meaning: '用一个表达替代另一个表达。',
    example: 'Substitute rare Chinese terms with English equivalents.',
    tags: ['language'],
    difficulty: 3,
  },
  {
    original: '词汇',
    replacement: 'vocabulary',
    pronunciation: '/vəˈkæbjəleri/',
    meaning: '某个领域常用或需要掌握的词语集合。',
    example: 'Programmer vocabulary grows through daily review.',
    tags: ['language'],
    difficulty: 2,
  },
  {
    original: '接口',
    replacement: 'interface',
    pronunciation: '/ˈɪntərfeɪs/',
    meaning: '模块之间交互的约定或边界。',
    example: 'Keep the storage interface small and explicit.',
    tags: ['programming'],
    difficulty: 2,
  },
  {
    original: '依赖',
    replacement: 'dependency',
    pronunciation: '/dɪˈpendənsi/',
    meaning: '一个模块运行所需要的外部模块或服务。',
    example: 'Avoid adding a dependency before it is needed.',
    tags: ['architecture'],
    difficulty: 3,
  },
  {
    original: '抽象',
    replacement: 'abstraction',
    pronunciation: '/æbˈstrækʃn/',
    meaning: '隐藏细节后保留稳定概念或接口。',
    example: 'A good abstraction reduces repeated business logic.',
    tags: ['architecture'],
    difficulty: 4,
  },
  {
    original: '持久化',
    replacement: 'persistence',
    pronunciation: '/pərˈsɪstəns/',
    meaning: '把数据保存到页面刷新或进程重启后仍可读取的位置。',
    example: 'Vocabulary persistence uses extension local storage.',
    tags: ['storage'],
    difficulty: 4,
  },
  {
    original: '降级',
    replacement: 'fallback',
    pronunciation: '/ˈfɔːlbæk/',
    meaning: '主路径不可用时使用的备用路径。',
    example: 'Local fallback keeps translation available without an API key.',
    tags: ['reliability'],
    difficulty: 3,
  },
  {
    original: '语义',
    replacement: 'semantics',
    pronunciation: '/sɪˈmæntɪks/',
    meaning: '表达背后的含义，而不只是表面文字。',
    example: 'Semantic hints make hover explanations easier to remember.',
    tags: ['language'],
    difficulty: 4,
  },
  {
    original: '异步',
    replacement: 'asynchronous',
    pronunciation: '/eɪˈsɪŋkrənəs/',
    meaning: '任务不阻塞当前流程，稍后返回结果。',
    example: 'Selection translation is asynchronous to avoid freezing the page.',
    tags: ['programming'],
    difficulty: 4,
  },
  {
    original: '批量',
    replacement: 'batch',
    pronunciation: '/bætʃ/',
    meaning: '一次处理多个对象或操作。',
    example: 'Batch updates reduce storage write frequency.',
    tags: ['performance'],
    difficulty: 2,
  },
  {
    original: '缓存',
    replacement: 'cache',
    pronunciation: '/kæʃ/',
    meaning: '临时保存计算或请求结果，减少重复成本。',
    example: 'Cache translations for repeated selections.',
    tags: ['performance'],
    difficulty: 2,
  },
  {
    original: '遍历',
    replacement: 'traverse',
    pronunciation: '/trəˈvɜːrs/',
    meaning: '按顺序访问结构中的节点或元素。',
    example: 'The content script traverses text nodes under the page body.',
    tags: ['algorithm'],
    difficulty: 3,
  },
  {
    original: '命中',
    replacement: 'match',
    pronunciation: '/mætʃ/',
    meaning: '符合某个规则或条件。',
    example: 'A domain match decides whether the extension runs.',
    tags: ['system'],
    difficulty: 1,
  },
  {
    original: '演进',
    replacement: 'evolve',
    pronunciation: '/ɪˈvɑːlv/',
    meaning: '随着反馈逐步变化和升级。',
    example: 'Difficulty should evolve with the learner record.',
    tags: ['learning'],
    difficulty: 3,
  },
  {
    original: '复盘',
    replacement: 'review',
    pronunciation: '/rɪˈvjuː/',
    meaning: '回看已经学过的内容来巩固记忆。',
    example: 'Daily review keeps technical terms active.',
    tags: ['learning'],
    difficulty: 1,
  },
]

export function findCandidateByChinese(text: string, maxDifficulty: number) {
  return programmerVocabulary
    .filter(item => item.difficulty <= maxDifficulty && text.includes(item.original))
}

export function findCandidateByText(text: string) {
  const normalized = text.trim().toLowerCase()
  return programmerVocabulary.find((item) => {
    return item.original === text.trim() || item.replacement.toLowerCase() === normalized
  })
}

export function getDailyRecommendations(limit: number, learnedIds: Set<string>, maxDifficulty: number) {
  return programmerVocabulary
    .filter(item => item.difficulty <= maxDifficulty + 1)
    .sort((a, b) => {
      const aLearned = learnedIds.has(`${a.original}:${a.replacement}`) ? 1 : 0
      const bLearned = learnedIds.has(`${b.original}:${b.replacement}`) ? 1 : 0
      return aLearned - bLearned || a.difficulty - b.difficulty || a.original.localeCompare(b.original)
    })
    .slice(0, limit)
}
