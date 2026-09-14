/**
 * Golden Dataset · 语料生成
 *
 * 为什么要「生成」而不是「手抄」：
 *   手抄 150 篇知乎回答不现实，且无法保证 ground truth 的一致性
 *   （谁算「真正经历过」？两个标注员会给出不同答案）。
 *
 * 我们的做法：**合成语料时就把 ground truth 一起写下来**。
 * 每条内容在生成时带一个 `_gold` 标记（不进入检索，只用于评测）：
 *   - `firstPerson: true`  作者第一人称讲了**自己**的决策经历  → 这才是「有效人选」
 *   - `firstPerson: false` 作者在评论别人的选择 / 写方法论综述 → 看起来相关，但没经历过
 *
 * 这样「Top 3 有效人选率」就有了客观定义：
 *   推荐的人里，有多少是 ground truth 标为 firstPerson=true 的。
 *
 * ⚠️ 诚实边界（写进评测报告）：
 *   这是**合成语料**，用于验证「方法在受控条件下有效」，不能替代真实数据结论。
 *   真实数据的部分见 `scripts/harvest.mjs` 抓取的 harvested-hits.json（无 ground truth，
 *   只能人工抽查）。两者在报告里分开陈述。
 *
 * 类型说明：本文件是 .mjs（纯 JS），供 Node 脚本直接执行。
 * TypeScript 版本的契约见 scripts/gold/types.d.ts。
 */

/** 场景主题：对应我们要演示的五类问题 */
export const TOPICS = [
  'career-transition', // 大厂/降薪/创业公司/晋升
  'ic-to-manager',     // IC 转管理
  'ai-transition',     // 转 AI 产品
  'work-life',         // 加班/家庭/城市选择
  'startup-equity',    // 期权/股权/薪资结构
];

/** 主题 → 中文领域词，供检索 query 与语料共享 */
export const TOPIC_TERMS = {
  'career-transition': ['大厂', '创业公司', '降薪', '跳槽', '晋升', '离职', 'offer'],
  'ic-to-manager': ['管理岗', '带团队', '技术管理', '转管理', '一对一', '晋升'],
  'ai-transition': ['转岗', 'AI产品', '非科班', '大模型', '转型', '学习路径'],
  'work-life': ['加班', '通勤', '家庭', '城市', '北京', '上海', '陪家人'],
  'startup-equity': ['期权', '股权', '成熟期', '估值', '现金', '总包'],
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * 语料的「难度设计」—— 这是整个实验是否可信的关键
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第一版语料的致命缺陷：**标题里直接写了场景短语**
 * （例如标题 `「要不要为了管理放弃技术」的评估框架梳理`），
 * 导致纯关键词检索命中率虚高到 90%+，A 组和 C 组只差 1 个百分点 ——
 * 这样跑出来的对照**什么都证明不了**，反而会让人以为「关键词就够了」。
 *
 * 修正原则（对应真实知乎的实际情况）：
 *   1. **亲历者的标题写得朴实具体**（《从大厂到创业公司，我踩过的三个坑》），
 *      不重复问题里的关键词 —— 所以关键词检索**不容易**命中它；
 *   2. **方法论/科普的标题反而高度堆砌关键词**
 *      （《大厂晋升的评估框架：五个维度帮你判断》），
 *      所以关键词检索**很容易**命中它 —— 但它不是亲历者。
 *
 * 这个不对称才是真实的：**搜索结果里排在前面的，往往是最「像」答案的内容，
 * 而不是最「有资格」回答的人。** Baseline 的失败正是从这来的。
 *
 * 换句话说：噪声内容在**词法上比亲历内容更接近 query**。
 * 只有引入「是否第一人称」、「证据是否逐字可查」这些**语义/结构信号**，
 * 才能把真正的人捞上来 —— 这正是 C 组要做的事。
 * ══════════════════════════════════════════════════════════════════════
 */

/**
 * 亲历型标题：朴实、具体、带个人视角，**刻意不含 query 的核心词**。
 * 例如场景是「要不要为了管理放弃技术」，标题写成《带团队半年，我几乎没碰过代码》。
 */
const FIRST_PERSON_TITLES = {
  'career-transition': [
    '从大厂出来那年，我以为自己准备好了',
    '降薪之后，我把账重算了一遍',
    '待了三年才发现自己在重复',
    '离职那天我才想清楚要什么',
    '面试了二十家之后我的判断变了',
    '我选了那个钱少的机会',
  ],
  'ic-to-manager': [
    '带团队半年，我几乎没写过代码',
    '从写代码到带人，中间隔了什么',
    '我以为管理就是开周会',
    '第一次做一对一，我搞砸了',
    '上级跟我说了一句话，我改了做法',
    '技术还是管理，我纠结了两年',
  ],
  'ai-transition': [
    '三十五岁那年我换了赛道',
    '从传统软件到 AI，我的第一步',
    '简历上什么都没有的时候',
    '和一个比我小十岁的同事共事',
    '我用一个项目撬开了新方向',
    '转过去之后我才知道难在哪',
  ],
  'work-life': [
    '有天我发现自己三个月没陪孩子吃晚饭',
    '我把通勤时间算了笔账',
    '回到二线之后我的生活变了',
    '为了多拿一点钱，我付出了什么',
    '搬了三次家之后我明白了',
    '那次体检报告让我停下来',
  ],
  'startup-equity': [
    '我按最保守的估值算了一遍',
    '四年成熟期，我只待了两年半',
    'HR 说的那个数字，我后来自己算了',
    '拿到 offer 后我列了一张表',
    '期权到手那天我有点失望',
    '现金和股权，我怎么选的',
  ],
};

/** 方法论/科普型标题：**刻意堆砌核心词**，在词法上比亲历内容更像答案 */
const NOISE_TITLES = {
  methodology: [
    (k) => `${k}的评估框架：五个维度帮你判断`,
    (k) => `${k}怎么分析？一套通用方法论`,
    (k) => `关于${k}，先想清楚这三个问题`,
    (k) => `${k}的判断标准与常见误区`,
  ],
  observer: [
    (k) => `我身边那些${k}的人，后来都怎么样了`,
    (k) => `聊聊${k}这件事`,
    (k) => `${k}：我看到的一些规律`,
  ],
  definition: [
    (k) => `${k}是什么意思？一篇文章讲清楚`,
    (k) => `${k}的定义、来源与常见理解偏差`,
  ],
};

/** 关键词（噪声标题用，来自 TOPIC_TERMS） */
const QUERY_KEYWORDS = {
  'career-transition': ['大厂晋升', '降薪跳槽', '裸辞', '创业公司 offer'],
  'ic-to-manager': ['技术管理', '转管理', '带团队', '管理岗'],
  'ai-transition': ['转岗 AI 产品', '非科班转型', 'AI 产品经理'],
  'work-life': ['加班', '回二线城市', '通勤'],
  'startup-equity': ['期权估值', '期权成熟期', '总包比较'],
};
/**
 * 亲历型正文：第一人称叙述，**不复述 query 的词**，而是讲当时的处境与判断。
 * 这样它在词法上和 query 的距离更远 —— 关键词检索不容易命中，
 * 但「是否第一人称」「是否有决策与约束」这些结构信号很强。
 */
const FIRST_PERSON_TEMPLATES = [
  (ctx, years, detail) =>
    `${years}我做了个决定，${ctx}。当时我纠结了很久，最后想明白的是：${detail}。现在回头看，这个决定让我付出了代价，也让我看清了自己真正在意的东西。如果有处境类似的人问我，我会说先想清楚你能承受的最差结果是什么。`,
  (ctx, years, detail) =>
    `我亲身经历过这件事，${ctx}。${years}，我做了很多错误的假设，后来才想明白：${detail}。最难的不是做决定，是做完之后要接受自己的选择。我把当时算的那笔账写下来，希望对后来的人有用。`,
  (ctx, years, detail) =>
    `说说我自己的选择。${years}，${ctx}。当时身边的意见分成两派，我最后选择${detail}。踩过的坑是：我以为过去的经验可以平移，其实完全不行，前半年我几乎每天都在怀疑自己的决定。`,
  (ctx, years, detail) =>
    `${ctx}。这件事我前后想了差不多一年。${detail}，这是当时唯一说服我自己的理由。${years}做的决定，到现在我都不确定对不对，但我不后悔。`,
];

/**
 * 主题 → 第一人称的「处境描述」（写进正文的，不是标题）
 * 刻意用自然口语，不复述问题里的关键词。
 */
const TOPIC_SCENES = {
  'career-transition': [
    '我在一家挺大的公司待了好几年，往上走的路越来越窄',
    '有个小公司找我，给的钱比现在少，但说能给我更大的位置',
    '手上的事情我已经能提前半年预判了，这让我有点慌',
    '我递了辞职信，当时还没找好下家',
    '我面了二十多家，最后选的那个和一开始想的完全不一样',
  ],
  'ic-to-manager': [
    '我从写了很多年代码的位置，换成了带一个小团队',
    '那阵子我还是忍不住自己上手改问题',
    '团队出了事总是我先冲上去兜住',
    '我把大部分时间花在了开会和同步信息上',
    '我上级跟我说了一句话，让我重新分配了时间',
  ],
  'ai-transition': [
    '我三十好几了，做的还是上一个时代的产品',
    '我在简历上找不到一条和新技术相关的经历',
    '我先在公司内部找了个边缘项目蹭了进去',
    '我发现自己在这块懂得比刚毕业的同事少',
    '我花了半年把一个项目从头做到尾',
  ],
  'work-life': [
    '有天我忽然发现自己很久没在家吃过晚饭',
    '我每天要花三个小时在路上',
    '我算了算，为了多拿的那点钱我付出了什么',
    '我把家搬到了离公司很远但便宜的地方',
    '那份体检报告让我停下来了',
  ],
  'startup-equity': [
    'HR 给了我一个看起来很大的数字',
    '我按最保守的方式重新算了一遍那笔账',
    '我拿到的东西要四年才能全部到手',
    '我把两份 offer 摊在桌上比了很久',
    '现金和纸面收益，我最后选了前者',
  ],
};

/** 旁观者/评论型正文：讲别人的故事，没有第一人称决策 */
const OBSERVER_TEMPLATES = [
  (kw) =>
    `我观察过身边不少在「${kw}」这件事上做选择的人。总体上看，那些想清楚自己要什么的人结果都不错，而只是想逃离现状的人往往后悔。所以我觉得关键不在于外部条件，而在于你自己有没有想清楚。`,
  (kw) =>
    `关于「${kw}」，我的看法是：这本质上是一个资源配置问题。很多人把注意力放在外部标签上，其实应该看的是你自己在这件事里的位置有没有变重。`,
];

/** 方法论/科普型正文：框架、维度、步骤 —— 典型的「写过但没做过」 */
const METHODOLOGY_TEMPLATES = [
  (kw) =>
    `「${kw}」是一个常被讨论的话题。本文系统梳理一下相关的分析框架：第一，从机会成本角度；第二，从人力资本增值角度；第三，从风险承受能力角度。这三个框架可以帮助你做出更理性的判断。`,
  (kw) =>
    `如何评估「${kw}」？可以从以下几个维度入手：行业周期、组织阶段、岗位信息密度、直属上级。以上维度没有绝对的权重，需要结合你的具体情况加权。`,
];

/** 名词解释型：明显不相关 */
const DEFINITION_TEMPLATES = [
  (kw) =>
    `很多人问「${kw}」到底该怎么理解。下面给出简要说明：这个概念在不同语境下有不同的含义，本文从定义、来源、常见误解三个方面做一些介绍。`,
];

/** 确定性的伪随机数（不用 Math.random，保证语料可复现） */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    // xorshift32：确定性、零依赖
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

const YEARS = ['三年前', '两年前', '去年', '前年', '2021 年', '2022 年', '2023 年', '四年前'];

const DETAILS = [
  '先算清楚现金流能扛多久，再谈成长',
  '把期权按最保守估值算，发现几乎可以忽略',
  '优先看直属上级愿不愿意带我三年',
  '把注意力从公司标签换到具体岗位的信息密度上',
  '接受自己在新领域是个新人这件事',
  '先在公司内部找相关项目蹭进去，再往外看机会',
];

const SURNAMES = '林苏周陆郝沈陈黄吴郑冯许何吕施张孔曹严华金魏陶姜'.split('');
const GIVEN = [
  '一舟', '明远', '叙', '文康', '知远', '亦航', '之遥', '怀瑾', '听澜', '既定',
  '临川', '子墨', '清和', '砚秋', '南舟', '星野', '元朗', '亦白', '长风', '岁安',
  '静观', '小满', '砚舟', '知微',
];

const BADGES = ['互联网行业 产品经理', '技术管理', 'AI 产品', '职业规划', '人力资源', '', ''];

/**
 * 生成一份合成语料。
 *
 * @param {number} docCount 生成多少条内容（默认 168）
 * @param {number} firstPersonRatio 真·亲历内容的比例（默认 0.42）——
 *   刻意让「噪声」占多数，因为现实里搜索出来的内容大多数是评论与方法论，
 *   这正是 Baseline 会翻车的地方。
 * @returns {Array<object>}
 */
export function generateCorpus(docCount = 168, firstPersonRatio = 0.42) {
  const rng = makeRng(20260912);
  const docs = [];

  // 先造 40 位作者，保证同一作者有多篇内容（sourceCount 才有意义）
  const authors = [];
  for (let i = 0; i < 40; i += 1) {
    authors.push({
      name: `${SURNAMES[i % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`,
      badge: BADGES[i % BADGES.length],
    });
  }

  let authorSeq = 0;

  for (let i = 0; i < docCount; i += 1) {
    const topic = TOPICS[i % TOPICS.length];
    const scenes = TOPIC_SCENES[topic];
    const scene = scenes[Math.floor(rng() * scenes.length)];
    // 每 4 篇换一位作者
    if (i > 0 && i % 4 === 0) authorSeq += 1;
    const author = authors[authorSeq % authors.length];

    const isFirstPerson = rng() < firstPersonRatio;
    const years = YEARS[Math.floor(rng() * YEARS.length)];
    const detail = DETAILS[Math.floor(rng() * DETAILS.length)];

    let text;
    let title;
    let noise;

    if (isFirstPerson) {
      text = FIRST_PERSON_TEMPLATES[i % FIRST_PERSON_TEMPLATES.length](scene, years, detail);
      // 亲历型标题：朴实、具体、不重复 query 关键词
      const tplList = FIRST_PERSON_TITLES[topic];
      title = tplList[Math.floor(rng() * tplList.length)];
    } else {
      // 噪声：故意在标题里堆 query 关键词（这是真实搜索结果里最常见的情况）
      const kws = QUERY_KEYWORDS[topic];
      const kw = kws[Math.floor(rng() * kws.length)];
      const kind = i % 3;
      if (kind === 0) {
        text = OBSERVER_TEMPLATES[i % OBSERVER_TEMPLATES.length](kw);
        title = NOISE_TITLES.observer[Math.floor(rng() * NOISE_TITLES.observer.length)](kw);
        noise = 'observer';
      } else if (kind === 1) {
        text = METHODOLOGY_TEMPLATES[i % METHODOLOGY_TEMPLATES.length](kw);
        title = NOISE_TITLES.methodology[Math.floor(rng() * NOISE_TITLES.methodology.length)](kw);
        noise = 'methodology';
      } else {
        text = DEFINITION_TEMPLATES[i % DEFINITION_TEMPLATES.length](kw);
        title = NOISE_TITLES.definition[Math.floor(rng() * NOISE_TITLES.definition.length)](kw);
        noise = 'definition';
      }
    }

    const contentId = `gold-${String(i + 1).padStart(4, '0')}`;

    docs.push({
      title,
      contentType: i % 3 === 0 ? 'Article' : 'Answer',
      contentId,
      contentText: text,
      url: `https://www.zhihu.com/answer/${contentId}`,
      commentCount: Math.floor(rng() * 80),
      voteUpCount: Math.floor(rng() * 2000),
      authorName: author.name,
      authorAvatar: '',
      authorBadgeText: author.badge,
      // 2023-01 到 2025-12 之间
      editTime: 1672531200 + Math.floor(rng() * 94_000_000),
      comments: [],
      authorityLevel: 1 + Math.floor(rng() * 4),
      rankingScore: 0,
      _gold: { firstPerson: isFirstPerson, topic, noise },
    });
  }

  return docs;
}
