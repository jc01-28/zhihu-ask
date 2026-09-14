import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { ApiProvider } from "@/front/app/ApiProvider";
import { appRoutes } from "@/front/app/router";
import { MockApiClient, type MockApiClientOptions } from "@/front/api/MockApiClient";
import type { ApiClient } from "@/front/api/ApiClient";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";

export function createTestClient(options: MockApiClientOptions = {}): MockApiClient {
  return new MockApiClient({ stepDelayMs: 0, persist: false, ...options });
}

/**
 * 默认路由是登录后的「问题找人」页。
 *
 * 绝大多数用例验证的是授权之后的功能，所以默认值取 `/app/find`；
 * 项目推荐页（`/`）与功能首页（`/app`）的用例显式传入 route。
 */
export function renderApp({
  client,
  route = "/app/find",
}: {
  client: ApiClient;
  route?: string;
}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  const result = render(
    <ApiProvider client={client}>
      <RouterProvider router={router} />
    </ApiProvider>,
  );
  return { ...result, router };
}

/** 把 mock 的 uuid 生成规则暴露给测试，方便断言固定值。 */
export function fixedUuid(seed: number): string {
  const tail = seed.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

/** 直接进入聊天页的测试夹具：先完成一次搜索，再据此创建会话。 */
export async function seedConversation(
  client: MockApiClient,
  creatorId: string = FIXTURE_CREATORS[0].id,
) {
  const search = await client.streamSearch(
    { query: "大厂产品转 AI 创业公司，值得找谁聊？", sessionId: "session-test" },
    () => undefined,
  );
  return client.createConversation({ creatorId, sourceRunId: search.runId });
}
