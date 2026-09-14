import { Check } from "lucide-react";

import { Button } from "@/front/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/front/components/ui/dialog";
import type { ConsultationPackage } from "@/shared/contracts/consultation";

import { formatMoney } from "@/front/shared/format-money";

/**
 * 模拟支付弹窗。
 *
 * 只展示套餐与格式化后的金额，并明确说明「不会产生扣款」；
 * 不出现银行卡、手机号、身份证或任何真实支付 SDK。
 */
export function PaymentDialog({
  open,
  onOpenChange,
  package: consultationPackage,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  package: ConsultationPackage | null;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认模拟支付</DialogTitle>
          <DialogDescription>
            这只是交互演示，不会创建真实订单，也不会产生扣款。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{consultationPackage?.name ?? "未选择套餐"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {consultationPackage?.description ?? "请先在右侧选择咨询方式。"}
              </p>
            </div>
            <p className="text-2xl font-bold text-primary">
              {consultationPackage
                ? formatMoney(consultationPackage.amount, consultationPackage.currency)
                : "--"}
            </p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          本弹窗不收集任何支付信息，按钮只会驱动演示状态。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={pending || !consultationPackage}>
            <Check /> 确认模拟支付
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
