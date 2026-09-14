/**
 * 领域 · 咨询状态机
 *
 * 状态由**后端持有**，前端只提交动作、绝不自己推导下一状态。
 * 所以非法流转不是简单报错，而是要把当前完整的 `Consultation` 回给前端「回正」——
 * 否则前端面板会停在一个服务端根本不存在的状态上。
 *
 * ⚠️ 这是**模拟支付**。`confirm_mock_payment` 不创建任何真实订单、
 * 不产生任何扣款、不接受任何支付字段（银行卡 / 手机号 / 身份证一概没有）。
 * 这是刻意的产品边界：演示一个「本来该接支付」的流程，而不是伪造一个支付。
 */

import type {
  ActorRole,
  Consultation,
  ConsultationAction,
  ConsultationPackage,
  ConsultationPackageId,
  ConsultationStatus,
} from '@/shared/contract';

/** 套餐价格单位是**人民币分**（契约写死的单位，别用元） */
export const CONSULTATION_PACKAGES: readonly ConsultationPackage[] = [
  {
    id: 'text',
    name: '文字深度问答',
    description: '以文字形式追问细节，答主在 24 小时内回复，可来回三轮。',
    amount: 9900,
    currency: 'CNY',
  },
  {
    id: 'voice-30',
    name: '30 分钟语音通话',
    description: '直接通话 30 分钟，适合需要边说边理清的处境。',
    amount: 29900,
    currency: 'CNY',
  },
  {
    id: 'voice-60',
    name: '60 分钟深度咨询',
    description: '一小时深聊，适合要做决定的重大选择，含一份要点纪要。',
    amount: 49900,
    currency: 'CNY',
  },
];

export function findPackage(packageId: string): ConsultationPackage | null {
  return CONSULTATION_PACKAGES.find((p) => p.id === packageId) ?? null;
}

/**
 * 合法流转表。**这张表必须与前端 `MockApiClient` 的 ALLOWED_TRANSITIONS 一致** ——
 * 两边各写一份迟早会漂移，而漂移的表现是「前端按钮能点、点下去 409」。
 */
const ALLOWED: {
  role: ActorRole;
  action: ConsultationAction;
  from: ConsultationStatus[];
  to: ConsultationStatus;
}[] = [
  { role: 'seeker', action: 'propose', from: ['free_chat'], to: 'proposed' },
  { role: 'seeker', action: 'cancel', from: ['proposed'], to: 'free_chat' },
  {
    role: 'seeker',
    action: 'confirm_mock_payment',
    from: ['offer_created'],
    to: 'mock_paid',
  },
  {
    role: 'creator',
    action: 'create_offer',
    from: ['free_chat', 'proposed'],
    to: 'offer_created',
  },
  { role: 'creator', action: 'withdraw_offer', from: ['offer_created'], to: 'free_chat' },
  { role: 'creator', action: 'start_consultation', from: ['mock_paid'], to: 'consulting' },
];

export interface TransitionInput {
  action: ConsultationAction;
  actorRole: ActorRole;
  packageId?: string;
  current: ConsultationStatus;
}

export type TransitionResult =
  | {
      ok: true;
      status: ConsultationStatus;
      /**
       * 套餐怎么变。三态是刻意的：
       *   `keep` —— 沿用会话里已定的套餐（confirm_mock_payment / start_consultation）
       *   `null` —— 清空（cancel / withdraw_offer）
       *   对象   —— 设成新值（create_offer）
       * 用「是否存在这个字段」来表达「要不要改」很容易漏，显式三态更难写错。
       */
      package: 'keep' | null | { packageId: ConsultationPackageId; amount: number };
    }
  | { ok: false; reason: string };

/**
 * 计算一次动作的结果。**纯函数**，不碰存储也不发消息 ——
 * 状态机是这块最容易写错的地方，纯函数才能被单独测。
 */
export function applyTransition(input: TransitionInput): TransitionResult {
  const rule = ALLOWED.find(
    (r) => r.role === input.actorRole && r.action === input.action,
  );

  if (!rule) {
    return {
      ok: false,
      reason: `${input.actorRole} 不能执行 ${input.action}`,
    };
  }

  if (!rule.from.includes(input.current)) {
    return {
      ok: false,
      reason: `当前状态 ${input.current} 不能执行 ${input.action}（允许：${rule.from.join(' / ')}）`,
    };
  }

  // 只有 create_offer 会带金额进来：它必须指定一个合法套餐
  if (input.action === 'create_offer') {
    const pkg = input.packageId ? findPackage(input.packageId) : null;
    if (!pkg) {
      return {
        ok: false,
        reason: `create_offer 需要一个合法套餐，收到：${input.packageId ?? '(空)'}`,
      };
    }
    return { ok: true, status: rule.to, package: { packageId: pkg.id, amount: pkg.amount } };
  }

  // 撤回 / 取消要把金额一起清掉，否则面板会显示「已取消」却还挂着价格
  if (input.action === 'withdraw_offer' || input.action === 'cancel') {
    return { ok: true, status: rule.to, package: null };
  }

  // 确认支付 / 开始咨询：套餐不变
  return { ok: true, status: rule.to, package: 'keep' };
}

/** 状态变化对应的系统消息。写在这里而不是散落在 handler，是为了和状态机同步改 */
export function transitionMessage(
  action: ConsultationAction,
  status: ConsultationStatus,
  packageName?: string,
): string {
  switch (action) {
    case 'propose':
      return '你发起了付费咨询申请，等待对方给出方案。';
    case 'cancel':
      return '你撤回了咨询申请，已回到免费交流。';
    case 'create_offer':
      return `对方创建了咨询方案${packageName ? `：${packageName}` : ''}。确认后即可开始（模拟支付，不会产生真实扣款）。`;
    case 'withdraw_offer':
      return '对方撤回了咨询方案，已回到免费交流。';
    case 'confirm_mock_payment':
      return '模拟支付完成，等待对方开始咨询。本次为演示流程，不会创建真实订单。';
    case 'start_consultation':
      return '咨询已开始。';
    default:
      return `咨询状态更新为 ${status}`;
  }
}
