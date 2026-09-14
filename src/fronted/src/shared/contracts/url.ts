import { z } from "zod";

/**
 * 只接受 https 的绝对地址。
 *
 * `z.string().url()` 只校验「能被 URL 解析」，因此 `javascript:alert(1)`、
 * `data:text/html,...` 这类字符串同样会通过；它们一旦落进 `<img src>` 或
 * `<a href>` 就是注入面。这里对协议做白名单，只放行 https。
 */
export const httpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "必须是 https 绝对地址");

/** 头像等可选地址：允许 null，不允许空串。 */
export const nullableHttpsUrlSchema = httpsUrlSchema.nullable();
