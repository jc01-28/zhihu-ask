import { expect, test as base } from "@playwright/test";

/**
 * 所有 E2E 共用的 `page` fixture。
 *
 * 它额外做一件计划第 7 节要求、但普通断言覆盖不到的事：
 * **收集浏览器控制台错误**，并在用例结束时断言为零。
 * 未捕获异常、React 渲染告警、资源 404 都会在这里暴露出来，
 * 而不是被「页面看起来对」悄悄放过。
 */

export type ConsoleGuard = {
  /**
   * 允许出现的 HTTP 失败状态码。
   *
   * 浏览器会把任何 4xx/5xx 响应都记成一条 `console.error`，包括用例
   * **刻意制造**的服务端失败。默认不放行任何状态码（mock 模式从来不返回
   * 真实失败状态，所以以前没遇到这个问题）；只有明确要验证失败分支的用例
   * 才通过 `createTest({ allowedHttpStatuses })` 放行对应状态。
   *
   * 刻意不做成「整个文件统一放行」：那样连静态资源的 404 都会被一起放过。
   */
  allowedHttpStatuses?: number[];
};

const HTTP_FAILURE =
  /Failed to load resource: the server responded with a status of (\d{3})/;

export function createTest(guard: ConsoleGuard = {}) {
  const allowed = new Set(guard.allowedHttpStatuses ?? []);

  const isExpectedHttpFailure = (text: string): boolean => {
    const match = HTTP_FAILURE.exec(text);
    return match ? allowed.has(Number(match[1])) : false;
  };

  return base.extend({
    page: async ({ page }, use, testInfo) => {
      const errors: string[] = [];

      page.on("pageerror", (error) => {
        errors.push(`[pageerror] ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (isExpectedHttpFailure(text)) return;
        errors.push(`[console.error] ${text}`);
      });
      page.on("requestfailed", (request) => {
        // 被主动取消的请求（例如切换页面中断的流）不算运行错误。
        if (request.failure()?.errorText === "net::ERR_ABORTED") return;
        errors.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ""}`);
      });

      await use(page);

      if (errors.length > 0) {
        testInfo.attach("console-errors", {
          body: errors.join("\n"),
          contentType: "text/plain",
        });
      }
      expect(errors, `浏览器控制台出现错误：\n${errors.join("\n")}`).toEqual([]);
    },
  });
}

/** 默认用例：任何控制台错误都算失败。 */
export const test = createTest();

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
