#!/usr/bin/env node
/**
 * 联调用的最小后端桩。
 *
 * 存在的理由只有一个：`VITE_API_MODE=mock` 从来不经过真实网络，
 * 所以「HttpApiClient 打真实 HTTP 服务器」这条链路上的一切——
 * 契约校验、错误信封、NDJSON 分块、刷新恢复——在 mock 模式下都验证不到。
 * 这个脚本提供那台服务器，让 live 模式可以被真正跑起来。
 *
 * 用法：
 *   node scripts/live-stub-server.mjs                 # 监听 127.0.0.1:8787
 *   node scripts/live-stub-server.mjs --port 9000
 *   node scripts/live-stub-server.mjs --latency 0     # 关掉逐事件延迟
 *
 * 覆盖范围刻意只到「读路径 + 找人检索流」：
 *   /api/auth/session          会话探测
 *   /api/topics/hot            热榜背景资料
 *   /api/fields/featured       推荐领域
 *   /api/fields?query=&limit=  领域检索
 *   /api/fields/:id/graph      领域星图
 *   /api/creators/:id          人物公开资料
 *   /api/agent/search          六阶段 NDJSON 检索流
 *   /api/agent/runs/:runId     刷新恢复
 * 会话与咨询不在其中：那两个接口带真实状态机，桩里再实现一遍只会变成
 * 「第三套后端」，验证的是桩而不是前端。它们统一返回 501 NOT_IMPLEMENTED。
 *
 * 分支开关（都是给测试用的，真实后端不会有这些东西，全部挂在 /api/__stub/ 下）：
 *   GET /api/__stub/mode?value=<mode>   切换分支
 *   GET /api/__stub/requests            读出此刻为止收到的请求
 *   GET /api/__stub/requests/reset      清空请求记录
 * 分支值：default | anonymous | unconfigured | expired | fields-degraded |
 *         fields-failed | graph-missing | search-failed | search-truncated |
 *         slow-steps
 */

import { createServer } from "node:http";

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const PORT = Number(readArg("port", process.env.PORT ?? "8787"));
const HOST = readArg("host", "127.0.0.1");
/** 逐事件间隔。E2E 需要看到「进度是逐条推进的」，所以默认留一点延迟。 */
const STEP_LATENCY_MS = Number(readArg("latency", "40"));

const MODES = [
  "default",
  "anonymous",
  "unconfigured",
  "expired",
  "fields-degraded",
  "fields-failed",
  "graph-missing",
  "search-failed",
  "search-truncated",
  "slow-steps",
];

/* ------------------------------------------------------------------ */
/* 桩数据                                                              */
/* ------------------------------------------------------------------ */

const USER = {
  id: "public-user-1",
  displayName: "联调用户",
  avatarUrl: null,
};

function creator(id, name, headline, initial, avatarTone) {
  return {
    id,
    name,
    headline,
    initial,
    avatarTone,
    avatarUrl: null,
    profileUrl: `https://www.zhihu.com/people/${id}`,
    identityConfidence: "high",
    role: "经历最接近",
    relevanceLevel: "高度相关",
    score: 91,
    matchedDimensions: ["一线经历", "公开内容可核验"],
    reason: "有公开回答可以逐条核验，且与提问描述的处境重合。",
    evidence: [
      {
        id: `${id}-e1`,
        title: "从 0 到 1 的一次完整复盘",
        excerpt: "公开回答里给出了当时的判断依据与失败点。",
        kind: "亲身经历",
        publishedAt: "2026-03-02",
        source: "zhihu_search",
        url: `https://www.zhihu.com/question/1/answer/${id}`,
      },
    ],
    suitableQuestions: ["当时是怎么判断这条路线值得投的？"],
    limitations: ["未公开团队后续的留存数据"],
  };
}

/** 桩数据刻意与 mock 夹具不同名，以便一眼看出页面上的东西来自服务端。 */
const CREATORS = [
  creator("lu-zhiyuan", "陆知远", "大模型应用负责人", "陆", "bg-violet-500"),
  creator("zhou-yiran", "周亦然", "AI 产品增长负责人", "周", "bg-cyan-500"),
];

const FIELD_LLM = {
  id: "llm-apps",
  name: "大模型应用",
  description: "把模型能力落成可交付的产品",
  icon: "sparkles",
  color: "violet",
  tags: ["应用", "评测"],
  memberCount: 246,
  topicCount: 4,
};

const FIELD_GRAPH = {
  field: FIELD_LLM,
  topics: [
    {
      id: "eval",
      name: "效果评测",
      description: "怎么判断一次改动是真的变好",
      position: { x: 0.28, y: 0.34 },
    },
    {
      id: "cost",
      name: "推理成本",
      description: "把单次调用成本压到可接受区间",
      position: { x: 0.68, y: 0.62 },
    },
  ],
  people: [
    {
      id: "lu-zhiyuan",
      name: "陆知远",
      headline: "大模型应用负责人",
      avatarUrl: null,
      initial: "陆",
      avatarTone: "bg-violet-500",
      topicIds: ["eval", "cost"],
      relevance: 92,
      profileUrl: "https://www.zhihu.com/people/lu-zhiyuan",
    },
    {
      id: "zhou-yiran",
      name: "周亦然",
      headline: "AI 产品增长负责人",
      avatarUrl: null,
      initial: "周",
      avatarTone: "bg-cyan-500",
      topicIds: ["eval"],
      relevance: 74,
      profileUrl: "https://www.zhihu.com/people/zhou-yiran",
    },
  ],
};

const HOT_TOPICS = {
  topics: [
    {
      scope: "background",
      source: "hot_list",
      title: "本周公开讨论集中在推理成本",
      excerpt: "热榜上的讨论与本次提问的处境相关，但只作背景，不参与推荐。",
      url: "https://www.zhihu.com/hot",
      thumbnailUrl: null,
      publishedAt: null,
    },
  ],
  unavailable: false,
};

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const REQUEST_ID = "66666666-7777-4888-8999-000000000000";

const CONTEXT_SOURCE_COUNTS = {
  creation: 26,
  followee: 4,
  collection: 3,
  favlist: 1,
};

const SEARCH_RESULT = {
  cards: CREATORS,
  modeUsed: "live",
  fallbackReason: null,
  modelFallback: false,
  contextStatus: "applied",
  contextSourceCounts: CONTEXT_SOURCE_COUNTS,
  searchedQueries: ["大模型应用 效果评测"],
  background: HOT_TOPICS.topics,
  analyzedContentCount: 34,
  rejectedContentCount: 9,
  runId: RUN_ID,
  persistence: "saved",
};

const RUN_RESTORE = {
  runId: RUN_ID,
  cards: CREATORS,
  mode: "live",
  contextStatus: "applied",
  analyzedCount: SEARCH_RESULT.analyzedContentCount,
  rejectedCount: SEARCH_RESULT.rejectedContentCount,
  fallbackReason: null,
  modelFallback: false,
  contextSourceCounts: CONTEXT_SOURCE_COUNTS,
  searchedQueries: SEARCH_RESULT.searchedQueries,
  background: SEARCH_RESULT.background,
  persistence: "saved",
  createdAt: 1_757_840_000_000,
  expiresAt: 1_757_843_600_000,
};

const AGENT_STEPS = [
  ["loading_context", "读取你的上下文与关注的领域"],
  ["understanding", "理解问题真正的处境"],
  ["retrieving", "检索知乎公开内容"],
  ["verifying", "核验内容证据"],
  ["ranking", "按匹配度排序"],
  ["saving", "保存本次结果"],
];

const CONSULTATION_PACKAGES = {
  items: [
    {
      id: "text",
      name: "文字追问",
      description: "围绕提问做一次文字追问",
      amount: 0,
      currency: "CNY",
    },
    {
      id: "voice-30",
      name: "30 分钟语音",
      description: "30 分钟一对一语音交流",
      amount: 9900,
      currency: "CNY",
    },
    {
      id: "voice-60",
      name: "60 分钟语音",
      description: "60 分钟一对一语音交流",
      amount: 16900,
      currency: "CNY",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readCookies(request) {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    // 会话探测这类 GET 一旦被浏览器缓存，「没有请求风暴」就无从验证。
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(payload);
}

function sendNdjsonHead(response) {
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    // 明确关掉任何中间层缓冲，否则「边算边出」在浏览器里会变成一次性到达。
    "X-Accel-Buffering": "no",
  });
}

function notImplemented(response, what) {
  sendJson(response, 501, {
    code: "NOT_IMPLEMENTED",
    message: `桩服务器未实现「${what}」，请接入真实后端。`,
    retryable: false,
  });
}

/* ------------------------------------------------------------------ */
/* 请求处理                                                            */
/* ------------------------------------------------------------------ */

const requests = [];

async function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const path = url.pathname;
  const mode = readCookies(request).stub_mode ?? "default";

  requests.push({ method: request.method, path, search: url.search, mode });

  /* ---- 测试开关（真实后端不会有这一段） ---- */
  if (path === "/api/__stub/mode") {
    const value = url.searchParams.get("value") ?? "default";
    if (!MODES.includes(value)) {
      sendJson(response, 400, {
        code: "UNKNOWN_STUB_MODE",
        message: `未知的桩分支：${value}`,
        retryable: false,
      });
      return;
    }
    sendJson(response, 200, { mode: value }, {
      "Set-Cookie": `stub_mode=${value}; Path=/; SameSite=Lax`,
    });
    return;
  }
  if (path === "/api/__stub/requests") {
    sendJson(response, 200, { items: requests });
    return;
  }
  if (path === "/api/__stub/requests/reset") {
    requests.length = 0;
    sendJson(response, 200, { ok: true });
    return;
  }
  if (path === "/api/__stub/health") {
    sendJson(response, 200, { ok: true, mode, latencyMs: STEP_LATENCY_MS });
    return;
  }

  /* ---- 会话探测 ---- */
  if (path === "/api/auth/session") {
    if (mode === "expired") {
      sendJson(response, 401, {
        code: "ZHIHU_AUTH_EXPIRED",
        message: "知乎授权已失效，请重新登录。",
        retryable: false,
      });
      return;
    }
    if (mode === "unconfigured") {
      sendJson(response, 200, {
        configured: false,
        authenticated: false,
        user: null,
      });
      return;
    }
    if (mode === "anonymous") {
      sendJson(response, 200, {
        configured: true,
        authenticated: false,
        user: null,
      });
      return;
    }
    sendJson(response, 200, {
      configured: true,
      authenticated: true,
      user: USER,
    });
    return;
  }

  /* ---- 热榜背景资料 ---- */
  if (path === "/api/topics/hot") {
    sendJson(response, 200, HOT_TOPICS);
    return;
  }

  /* ---- 专业领域 ---- */
  if (path === "/api/fields/featured") {
    if (mode === "fields-failed") {
      sendJson(response, 503, {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "服务暂时不可用，请稍后重试。",
        retryable: true,
      });
      return;
    }
    sendJson(response, 200, { items: [FIELD_LLM] });
    return;
  }

  if (path === "/api/fields") {
    if (mode === "fields-failed") {
      sendJson(response, 503, {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "服务暂时不可用，请稍后重试。",
        retryable: true,
      });
      return;
    }
    if (mode === "fields-degraded") {
      // 故意退化成人物列表：契约必须在客户端直接拒绝，而不是把人物渲染成领域。
      sendJson(response, 200, { items: CREATORS });
      return;
    }
    const query = (url.searchParams.get("query") ?? "").trim();
    // 检索为空也要返回领域：这里返回推荐领域，表示「没有更贴切的领域」。
    sendJson(response, 200, { items: [FIELD_LLM] });
    void query;
    return;
  }

  const graphMatch = /^\/api\/fields\/([^/]+)\/graph$/.exec(path);
  if (graphMatch) {
    if (mode === "graph-missing" || decodeURIComponent(graphMatch[1]) !== FIELD_LLM.id) {
      sendJson(response, 404, {
        code: "FIELD_NOT_FOUND",
        message: "这个领域不存在或已下线。",
        retryable: false,
      });
      return;
    }
    sendJson(response, 200, FIELD_GRAPH);
    return;
  }

  const creatorMatch = /^\/api\/creators\/([^/]+)$/.exec(path);
  if (creatorMatch) {
    const id = decodeURIComponent(creatorMatch[1]);
    const found = CREATORS.find((item) => item.id === id);
    if (!found) {
      sendJson(response, 404, {
        code: "NOT_FOUND",
        message: "请求的资源不存在或已过期。",
        retryable: false,
      });
      return;
    }
    sendJson(response, 200, found);
    return;
  }

  /* ---- 找人检索流 ---- */
  if (path === "/api/agent/search") {
    sendNdjsonHead(response);

    const writeLine = async (payload, countSplit = false) => {
      const line = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
      if (countSplit) {
        // 刻意在 JSON 中间切断，逼客户端自己把跨 chunk 的一行拼回来。
        const cut = Math.max(1, Math.floor(line.length / 3));
        response.write(line.subarray(0, cut));
        await sleep(10);
        response.write(line.subarray(cut));
      } else {
        response.write(line);
      }
      await sleep(STEP_LATENCY_MS);
    };

    await writeLine({ type: "run.started", requestId: REQUEST_ID }, true);

    if (mode === "search-failed") {
      await writeLine({
        type: "run.failed",
        error: {
          code: "RATE_LIMITED",
          message: "检索被限流，请稍后重试。",
          retryable: true,
        },
      });
      response.end();
      return;
    }

    for (const [step, message] of AGENT_STEPS) {
      await writeLine({ type: "step.started", step, message });
      await writeLine({ type: "step.completed", step, message: `${message}（完成）` });
    }

    if (mode === "search-truncated") {
      // 干净地结束响应但不给终态事件：这正是「后端忘了发 run.completed，
      // 或中间层把响应截断」的样子。客户端必须报「连接中断」而不是当成成功。
      // 这里刻意不用 `destroy()`——那是 TCP 层断开，属于网络故障而非协议缺事件。
      response.end();
      return;
    }

    if (mode === "slow-steps") {
      await sleep(600);
    }

    await writeLine({
      type: "run.completed",
      result: SEARCH_RESULT,
      runId: RUN_ID,
      persistence: "saved",
    });
    response.end();
    return;
  }

  /* ---- 刷新恢复 ---- */
  const runMatch = /^\/api\/agent\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    if (decodeURIComponent(runMatch[1]) !== RUN_ID) {
      sendJson(response, 404, {
        code: "RUN_NOT_FOUND",
        message: "这次运行已过期，请重新搜索。",
        retryable: false,
      });
      return;
    }
    sendJson(response, 200, RUN_RESTORE);
    return;
  }

  /* ---- 咨询套餐（只读，属于读路径） ---- */
  if (path === "/api/consultation/packages") {
    sendJson(response, 200, CONSULTATION_PACKAGES);
    return;
  }

  /* ---- 明确未实现的写路径 ---- */
  if (path.startsWith("/api/conversations")) {
    notImplemented(response, "会话与咨询");
    return;
  }
  if (path === "/api/compare") {
    notImplemented(response, "原始检索对比");
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "请求的资源不存在或已过期。",
    retryable: false,
  });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    process.stderr.write(`[stub] 处理 ${request.url} 失败：${String(error)}\n`);
    if (!response.headersSent) {
      sendJson(response, 500, {
        code: "STUB_FAILURE",
        message: "桩服务器内部错误。",
        retryable: true,
      });
    } else {
      response.destroy();
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `[stub] 已监听 http://${HOST}:${PORT}（逐事件延迟 ${STEP_LATENCY_MS}ms）\n`,
  );
});
