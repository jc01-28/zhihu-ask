import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import type { ApiClient } from "@/front/api/ApiClient";
import { createApiClient } from "@/front/api/create-api-client";
import { ApiContext, type ApiContextValue } from "@/front/app/api-context";

/**
 * 全局依赖注入点：整个应用只在这里创建一次 `ApiClient`。
 *
 * Context 与 hook 在 `api-context.ts`，本文件只导出组件——这样改动 hook
 * 不会让这个文件参与 Fast Refresh 的整页刷新，也避免「只要 hook 的模块」
 * 顺带依赖 Provider 组件。
 */
export function ApiProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** 测试可以注入固定实例；生产永远由 createApiClient 按环境创建一次。 */
  client?: ApiClient;
}) {
  const [authEpoch, setAuthEpoch] = useState(0);
  const refreshSession = useCallback(() => setAuthEpoch((value) => value + 1), []);
  const createdRef = useRef<ApiClient | null>(null);

  if (!createdRef.current) {
    createdRef.current =
      client ?? createApiClient({ onUnauthorized: refreshSession });
  }

  const value = useMemo<ApiContextValue>(
    () => ({
      client: createdRef.current as ApiClient,
      authEpoch,
      refreshSession,
    }),
    [authEpoch, refreshSession],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}
