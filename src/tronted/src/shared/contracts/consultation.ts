import { z } from "zod";

/**
 * 咨询状态机由后端持有；前端只提交动作，不自行推导下一状态。
 * amount 的单位是人民币分。
 */
export const consultationStatusSchema = z.enum([
  "free_chat",
  "proposed",
  "offer_created",
  "mock_paid",
  "consulting",
]);

export const consultationPackageIdSchema = z.enum([
  "text",
  "voice-30",
  "voice-60",
]);

export const consultationSchema = z
  .object({
    id: z.string().min(1),
    status: consultationStatusSchema,
    packageId: consultationPackageIdSchema.nullable(),
    amount: z.number().int().nonnegative().nullable(),
    updatedAt: z.string(),
  })
  .strict();

export const consultationPackageSchema = z
  .object({
    id: consultationPackageIdSchema,
    name: z.string().min(1).max(60),
    description: z.string().max(200),
    amount: z.number().int().nonnegative(),
    currency: z.literal("CNY"),
  })
  .strict();

export const consultationPackageListSchema = z
  .object({ items: z.array(consultationPackageSchema) })
  .strict();

export const consultationActionSchema = z.enum([
  "propose",
  "cancel",
  "create_offer",
  "withdraw_offer",
  "confirm_mock_payment",
  "start_consultation",
]);

export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;
export type Consultation = z.infer<typeof consultationSchema>;
export type ConsultationPackage = z.infer<typeof consultationPackageSchema>;
export type ConsultationAction = z.infer<typeof consultationActionSchema>;

export const CONSULTATION_STATUS_LABELS: Record<ConsultationStatus, string> = {
  free_chat: "免费交流",
  proposed: "已申请咨询",
  offer_created: "咨询方案待确认",
  mock_paid: "模拟支付完成",
  consulting: "咨询进行中",
};
