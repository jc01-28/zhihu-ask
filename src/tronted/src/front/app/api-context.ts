import { createContext, useContext } from "react";

import type { ApiClient } from "@/front/api/ApiClient";

/**
 * `ApiClient` 的 React 边界：Context 与三个 hook。
 *
 * 单独成文件而不是和 `ApiProvider` 放在一起，有两个原因：
 *  - 只取 hook 的模块（`useFields` / `usePersonSearch` / …）不必把 Provider
 *    组件一起拖进自己的依赖图；
 *  - 组件与非组件混在一个文件里会让 Fast Refresh 退化成整页刷新，
 *    `react-refresh/only-export-components` 报的就是这件事。拆开之后
 *    改 hook 不会连带刷新整个应用壳。
 */
export type ApiContextValue = {
  client: ApiClient;
  /** 任何 401 都会自增它，触发全局会话刷新。 */
  authEpoch: number;
  refreshSession: () => void;
};

export const ApiContext = createContext<ApiContextValue | null>(null);

function useApiContext(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) {
    throw new Error("ApiProvider 缺失：所有 API 访问必须经过 useApiClient()。");
  }
  return value;
}

export function useApiClient(): ApiClient {
  return useApiContext().client;
}

export function useAuthEpoch(): number {
  return useApiContext().authEpoch;
}

export function useRefreshSession(): () => void {
  return useApiContext().refreshSession;
}
