import type { ApiClient } from "@/front/api/ApiClient";
import { HttpApiClient } from "@/front/api/HttpApiClient";
import {
  MOCK_AUTH_STATES,
  MOCK_SCENARIOS,
  MockApiClient,
  type MockAuthState,
  type MockScenario,
} from "@/front/api/MockApiClient";

export type ApiMode = "mock" | "live";

export type CreateApiClientOptions = {
  mode?: ApiMode;
  baseUrl?: string;
  onUnauthorized?: () => void;
  mockAuthState?: MockAuthState;
  mockScenario?: MockScenario;
  mockStepDelayMs?: number;
  mockPersist?: boolean;
};

export function resolveApiMode(): ApiMode {
  return import.meta.env.VITE_API_MODE === "live" ? "live" : "mock";
}

function resolveMockAuthState(explicit?: MockAuthState): MockAuthState {
  if (explicit) return explicit;
  const fromEnv = import.meta.env.VITE_MOCK_AUTH_STATE;
  if (fromEnv === "anonymous" || fromEnv === "unconfigured") return fromEnv;
  return "authenticated";
}

function resolveDemoRoleSwitcher(): boolean {
  return import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCHER !== "false";
}

/**
 * Mock 模式的演示开关，只从 URL query 读取、只在 Mock 模式下生效：
 * `?mock_auth=anonymous&mock_scenario=search-failed`
 *
 * 它用来看未授权和各种失败分支，而不用重启 dev server；
 * E2E 也依赖它构造错误场景。真实模式完全忽略这两个参数。
 */
function readMockOverrides(): {
  authState?: MockAuthState;
  scenario?: MockScenario;
} {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("mock_auth");
  const scenario = params.get("mock_scenario");
  const authState = MOCK_AUTH_STATES.find((item) => item === auth);
  const parsedScenario = MOCK_SCENARIOS.find((item) => item === scenario);
  return { authState, scenario: parsedScenario };
}

/**
 * 只在这里决定使用 Mock 还是真实后端。
 * 页面、feature 与组件一律通过 `useApiClient()` 取得接口。
 */
export function createApiClient(options: CreateApiClientOptions = {}): ApiClient {
  const mode = options.mode ?? resolveApiMode();
  if (mode === "live") {
    return new HttpApiClient({
      baseUrl: options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "",
      onUnauthorized: options.onUnauthorized,
    });
  }
  const overrides = readMockOverrides();
  return new MockApiClient({
    authState: resolveMockAuthState(options.mockAuthState ?? overrides.authState),
    demoRoleSwitcher: resolveDemoRoleSwitcher(),
    stepDelayMs: options.mockStepDelayMs,
    scenario: options.mockScenario ?? overrides.scenario,
    persist: options.mockPersist,
  });
}
