import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * jsdom 缺失的浏览器 API 兜底，只为让 Radix 组件在测试环境可用。
 * 这些补丁不进入生产代码。
 */
type Patchable = Record<string, unknown>;

function patch(target: Patchable, key: string, value: unknown): void {
  if (!(key in target)) target[key] = value;
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as Patchable).ResizeObserver = ResizeObserverStub;
}

patch(Element.prototype as unknown as Patchable, "hasPointerCapture", () => false);
patch(Element.prototype as unknown as Patchable, "setPointerCapture", () => undefined);
patch(Element.prototype as unknown as Patchable, "releasePointerCapture", () => undefined);
patch(Element.prototype as unknown as Patchable, "scrollIntoView", () => undefined);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});
