/**
 * 金额格式化。
 *
 * 后端契约中的 `amount` 单位是「分」，前端只负责展示，不做任何业务换算决策。
 * 整数金额不显示小数位（¥99），非整数金额保留两位（¥49.50）。
 */
export function formatMoney(amountInFen: number, currency: "CNY" = "CNY"): string {
  if (!Number.isFinite(amountInFen)) return "--";
  const yuan = amountInFen / 100;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(yuan) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(yuan);
}

/** 便于在 aria-label、日志与测试断言中使用的纯数字展示（不含货币符号）。 */
export function formatYuan(amountInFen: number): string {
  if (!Number.isFinite(amountInFen)) return "--";
  const yuan = amountInFen / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}
