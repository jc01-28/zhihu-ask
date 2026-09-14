import { useState } from "react";
import { Check, ChevronRight, CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/front/components/ui/card";
import {
  CONSULTATION_STATUS_LABELS,
  type Consultation,
  type ConsultationAction,
  type ConsultationPackage,
} from "@/shared/contracts/consultation";

import type { ViewerRole } from "@/front/features/chat/useConversation";
import { formatMoney } from "@/front/shared/format-money";

/**
 * 咨询面板。
 *
 * 前端不推导状态机：每次点击只提交 action，然后用服务端返回的
 * `{ consultation, systemMessage }` 更新界面；409 时用服务端状态回正。
 */
export function ConsultationPanel({
  consultation,
  packages,
  packagesError,
  actionPending,
  notice,
  onDismissNotice,
  onAction,
  onOpenPayment,
  viewerRole,
}: {
  consultation: Consultation;
  packages: ConsultationPackage[];
  packagesError: string | null;
  actionPending: boolean;
  notice: string | null;
  onDismissNotice: () => void;
  onAction: (action: ConsultationAction, packageId?: string) => void;
  onOpenPayment: (packageId: string) => void;
  viewerRole: ViewerRole;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState<string>(
    consultation.packageId ?? packages[1]?.id ?? "voice-30",
  );
  const selected =
    packages.find((item) => item.id === selectedPackageId) ?? packages[1] ?? null;
  const locked =
    consultation.status === "mock_paid" || consultation.status === "consulting";
  const busy = actionPending || packages.length === 0;

  return (
    <Card className="sticky top-24 gap-4 rounded-2xl py-5 shadow-none">
      <CardHeader className="px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-5 text-primary" /> 付费咨询
          </CardTitle>
          <Badge variant="outline">{CONSULTATION_STATUS_LABELS[consultation.status]}</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          先免费沟通，再根据问题复杂度选择咨询方式。
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {packagesError && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            套餐暂时不可用：{packagesError}
          </p>
        )}

        <div className="space-y-2">
          {packages.length === 0 && !packagesError && (
            <p className="text-xs text-muted-foreground">正在加载咨询套餐…</p>
          )}
          {packages.map((item) => {
            const active = item.id === selectedPackageId;
            return (
              <button
                key={item.id}
                type="button"
                disabled={locked}
                onClick={() => setSelectedPackageId(item.id)}
                aria-pressed={active}
                className={`w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  active ? "border-blue-300 bg-blue-50" : "border-border bg-white hover:border-blue-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{item.name}</span>
                  <span className="text-base font-bold text-primary">
                    {formatMoney(item.amount, item.currency)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </div>

        {notice && (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            <p>{notice}</p>
            <button
              type="button"
              onClick={onDismissNotice}
              className="mt-1 font-semibold underline"
            >
              知道了
            </button>
          </div>
        )}

        <ConsultationAction
          role={viewerRole}
          status={consultation.status}
          busy={busy}
          onAction={onAction}
          onPayment={() => onOpenPayment(selectedPackageId)}
          packageId={selectedPackageId}
        />

        <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-muted-foreground">
          <p className="flex items-center gap-1.5 font-semibold text-slate-700">
            <ShieldCheck className="size-3.5" /> 演示边界
          </p>
          <p className="mt-1">价格不影响人物推荐排序；本页不收集任何真实支付信息。</p>
          {selected && (
            <p className="mt-1">
              当前选择：{selected.name} · {formatMoney(selected.amount, selected.currency)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConsultationAction({
  role,
  status,
  busy,
  onAction,
  onPayment,
  packageId,
}: {
  role: ViewerRole;
  status: Consultation["status"];
  busy: boolean;
  onAction: (action: ConsultationAction, packageId?: string) => void;
  onPayment: () => void;
  packageId: string;
}) {
  if (role === "seeker") {
    if (status === "free_chat") {
      return (
        <Button
          className="h-11 w-full rounded-xl"
          disabled={busy}
          onClick={() => onAction("propose", packageId)}
        >
          申请付费咨询 <ChevronRight />
        </Button>
      );
    }
    if (status === "proposed") {
      return (
        <div className="space-y-2">
          <Button disabled className="h-11 w-full rounded-xl">
            等待答主创建方案
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={() => onAction("cancel", packageId)}
          >
            取消意向
          </Button>
        </div>
      );
    }
    if (status === "offer_created") {
      return (
        <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={onPayment}>
          确认方案并模拟支付 <ChevronRight />
        </Button>
      );
    }
    if (status === "mock_paid") {
      return (
        <Button disabled className="h-11 w-full rounded-xl">
          <Clock3 /> 等待答主开始咨询
        </Button>
      );
    }
    return (
      <Button disabled className="h-11 w-full rounded-xl">
        <Check /> 咨询进行中
      </Button>
    );
  }

  if (status === "free_chat" || status === "proposed") {
    return (
      <Button
        className="h-11 w-full rounded-xl"
        disabled={busy}
        onClick={() => onAction("create_offer", packageId)}
      >
        创建咨询方案 <ChevronRight />
      </Button>
    );
  }
  if (status === "offer_created") {
    return (
      <Button
        variant="outline"
        className="h-11 w-full rounded-xl"
        disabled={busy}
        onClick={() => onAction("withdraw_offer", packageId)}
      >
        撤回方案
      </Button>
    );
  }
  if (status === "mock_paid") {
    return (
      <Button
        className="h-11 w-full rounded-xl"
        disabled={busy}
        onClick={() => onAction("start_consultation", packageId)}
      >
        开始咨询 <ChevronRight />
      </Button>
    );
  }
  return (
    <Button disabled className="h-11 w-full rounded-xl">
      <Check /> 咨询进行中
    </Button>
  );
}
