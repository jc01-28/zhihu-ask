/**
 * Golden Dataset · 问题集
 *
 * 20 个真实风格的问题（不是编的抽象问题，而是带具体处境的求助），
 * 每个问题标注它属于哪个主题。评测时用主题把问题和语料对上：
 *   一个推荐是否「有效」，取决于被推荐的人是否**真的第一人称经历过该主题**。
 *
 * 为什么标注只到「主题 + 是否亲历」这一层：
 *   更细的标注（比如「这个人的经历是否真的能回答这个问题」）需要人工逐条读，
 *   在 48 小时里做不完，而且评审会质疑标注一致性。
 *   用「主题匹配 + 亲历」这个可自动判定的标准，虽然粗，但**客观、可复现、可解释**。
 *   报告里会如实写明这个局限。
 */

/** 20 个问题（topic 用于判定「推荐的人是否真的经历过这个话题」） */
export const GOLD_QUESTIONS = [
  // ── career-transition（6 个）──────────────────────────────────────
  {
    id: 'q01',
    question:
      '我在一家大厂做产品经理快 5 年了，晋升通道明显变窄。现在有个 50 人的 AI 创业公司让我去做产品负责人，但固定薪资要降 20%，给期权。我该不该去？',
    topic: 'career-transition',
  },
  {
    id: 'q02',
    question: '大厂晋升放缓，是不是就应该走了？我现在卡在晋升第二年，做的事越来越像流程管理。',
    topic: 'career-transition',
  },
  {
    id: 'q03',
    question: '拿到创业公司 offer 但要降薪 15%，我该怎么算这笔账？房贷每个月要还 1.2 万。',
    topic: 'career-transition',
  },
  {
    id: 'q04',
    question: '应届生第一份工作应该选大厂还是创业公司？我手上两个 offer，薪资差不多。',
    topic: 'career-transition',
  },
  {
    id: 'q05',
    question: '我在现在这家公司待了三年，做的事情已经能预判了。要不要裸辞去找新的机会？',
    topic: 'career-transition',
  },
  {
    id: 'q06',
    question: '跳槽的时候，怎么判断自己是在逃离现状还是在追求更好的机会？',
    topic: 'career-transition',
  },

  // ── ic-to-manager（4 个）──────────────────────────────────────────
  {
    id: 'q07',
    question: '公司让我从高级工程师转技术管理，带 6 个人的团队。我该不该接？',
    topic: 'ic-to-manager',
  },
  {
    id: 'q08',
    question: '刚转管理岗的第一年，我总是忍不住自己写代码，这样是不是有问题？',
    topic: 'ic-to-manager',
  },
  {
    id: 'q09',
    question: '技术管理岗做了半年，感觉团队的活还是我在兜底，怎么把时间重新分配？',
    topic: 'ic-to-manager',
  },
  {
    id: 'q10',
    question: '转管理之后要不要放弃技术？我怕自己几年后技术荒废了又回不去。',
    topic: 'ic-to-manager',
  },

  // ── ai-transition（4 个）──────────────────────────────────────────
  {
    id: 'q11',
    question:
      '我 35 岁，在传统软件做产品做了 8 年，现在想转到 AI 产品岗。我该不该转？转了之后我的经验还剩多少能用？',
    topic: 'ai-transition',
  },
  {
    id: 'q12',
    question:
      '我是非科班出身，现在有个机会转去做 AI 产品。是应该先花半年补原理再转，还是直接接项目边做边学？我今年 34 岁，时间不多了。',
    topic: 'ai-transition',
  },
  {
    id: 'q13',
    question:
      '我想转 AI 产品，但简历上完全没有相关经历，投出去都没有回音。我是该先在现在的公司内部找机会，还是直接跳？',
    topic: 'ai-transition',
  },
  {
    id: 'q14',
    question:
      '我去年转做 AI 方向，来了之后发现自己比同组 24 岁的同事在模型能力上懂得少很多，每天都在自我怀疑。要不要退回原来的岗位？',
    topic: 'ai-transition',
  },

  // ── work-life（3 个）──────────────────────────────────────────────
  {
    id: 'q15',
    question: '现在这份工作每天加班到十点，几乎没有时间陪家人，要不要为了生活换个钱少一点的？',
    topic: 'work-life',
  },
  {
    id: 'q16',
    question: '在北上广深工作五年了，一直在纠结要不要回二线城市，怎么下这个决心？',
    topic: 'work-life',
  },
  {
    id: 'q17',
    question:
      '我现在的住处单程通勤要一个半小时，但房租比公司附近便宜三千。为了省钱每天多花三小时在路上，我这样值不值？',
    topic: 'work-life',
  },

  // ── startup-equity（3 个）─────────────────────────────────────────
  {
    id: 'q18',
    question: '创业公司给的期权到底该怎么估值？HR 说的数字能信吗？',
    topic: 'startup-equity',
  },
  {
    id: 'q19',
    question:
      '我拿到一家 B 轮公司的 offer，期权四年成熟。如果我自己预估三年后可能就走了，那这份期权对我来说还有意义吗？要不要为它接受更低的现金？',
    topic: 'startup-equity',
  },
  {
    id: 'q20',
    question: '创业公司给的现金少了 30% 但期权很多，这个总包我应该怎么比较？',
    topic: 'startup-equity',
  },
];

/**
 * 通用知识问题：**不应该**路由到真人。用于验证 Triage 的克制性。
 * 这两个不进 Top-3 命中率统计，单独作为「路由正确率」指标。
 */
export const GENERIC_PROBE_QUESTIONS = [
  { id: 'g01', question: '期权和股权的区别是什么？', topic: 'startup-equity' },
  { id: 'g02', question: 'BM25 算法的原理是什么？', topic: 'career-transition' },
];
