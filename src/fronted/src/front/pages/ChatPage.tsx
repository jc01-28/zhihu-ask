import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CircleAlert, RotateCcw } from "lucide-react";

import { Button } from "@/front/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/front/components/ui/card";
import { Skeleton } from "@/front/components/ui/skeleton";

import { ChatHeader } from "@/front/features/chat/ChatHeader";
import { MessageComposer } from "@/front/features/chat/MessageComposer";
import { MessageList } from "@/front/features/chat/MessageList";
import { useConversation } from "@/front/features/chat/useConversation";
import { ConsultationPanel } from "@/front/features/consultation/ConsultationPanel";
import { PaymentDialog } from "@/front/features/consultation/PaymentDialog";
import { PrivateAgentPanel } from "@/front/features/private-agent/PrivateAgentPanel";
import { buildPrivateAgentView } from "@/front/features/private-agent/private-agent-state";
import { CreatorAvatar } from "@/front/features/creator/CreatorCard";
import { NotFoundPage } from "@/front/pages/NotFoundPage";

function ChatSkeleton() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border/80 bg-white/92">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <Skeleton className="size-9 rounded-xl" />
          <Skeleton className="h-9 w-56" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] items-start gap-4 p-4 sm:p-6 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-[680px] w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
      <span role="status" className="sr-only">
        正在加载会话
      </span>
    </main>
  );
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const conversation = useConversation(conversationId ?? "");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentPackageId, setPaymentPackageId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 从哪来回哪去。原来是 `<a href="/app/find">`：
   * 一是整页刷新（SPA 里不该发生），二是写死了目标 —— 从领域星图进来的人会被送到无关的页面。
   *
   * ⚠️ 别用 `location.key === 'default'` 判断"有没有历史再回退"：
   * 在 MemoryRouter（也就是全部单测）里初始 key 不是 'default'，`navigate(-1)` 会静默无效。
   * 改成跳转时显式带 `state.from`（见 FindPeoplePage / FieldGraphPage），这里读它。
   * 直达打开（没有 from）时兜底去「问题找人」。
   */
  const goBack = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? "/app/find", { replace: true });
  };

  if (!conversationId) return <NotFoundPage />;

  if (conversation.loadStatus === "loading") return <ChatSkeleton />;

  /**
   * 401：会话凭证失效。
   *
   * 演示环境（zhihu-wenren.vercel.app）已取消登录门槛（见 RequireAuth 的 DEMO_BYPASS_AUTH），
   * 所以这里不该再把用户推回授权门禁 —— 那会让「能看就行」的访客卡死在登录页。
   * 改成普通错误面板，文案保留原句以便用户理解发生了什么，同时给出重试与返回两条出路。
   */
  if (conversation.loadError?.status === 401) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
        <div role="alert" className="max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center">
          <h1 className="text-xl font-bold text-amber-900">会话凭证已失效</h1>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            登录状态已失效，请重新使用知乎账号授权。
            也可以直接返回，用访客身份新建一次咨询。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={conversation.reload}>
              <RotateCcw /> 重试
            </Button>
            <Button variant="outline" onClick={goBack}>
              返回上一页
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (conversation.loadStatus === "not-found") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
        <div role="alert" className="max-w-md rounded-2xl border border-slate-300 bg-white p-6 text-center">
          <h1 className="text-xl font-bold">会话不存在</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {conversation.loadError?.message ?? "这个会话不存在或已过期。"}
            请回到「问题找人」重新搜索并选择人物。
          </p>
          <Button className="mt-4 h-11 rounded-xl" onClick={goBack}>
            返回上一页
          </Button>
        </div>
      </main>
    );
  }

  if (conversation.loadStatus === "error" || !conversation.conversation) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
        <div role="alert" className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="text-xl font-bold text-red-900">会话加载失败</h1>
          <p className="mt-2 text-sm leading-6 text-red-800">
            {conversation.loadError?.message ?? "服务暂时不可用，请稍后重试。"}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {conversation.loadError?.retryable !== false && (
              <Button onClick={conversation.reload}>
                <RotateCcw /> 重试
              </Button>
            )}
            <Button variant="outline" onClick={goBack}>
              返回上一页
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const active = conversation.conversation;
  const fromSearch = Boolean(active.sourceRunId);
  const paymentPackage =
    conversation.packages.find((item) => item.id === paymentPackageId) ?? null;
  const privateAgent = buildPrivateAgentView(active.creator.id, active.creator.name);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <ChatHeader
        conversation={active}
        onReset={() => void conversation.reset()}
        resetting={conversation.actionPending}
      />

      <div
        className={`border-b px-4 py-2 text-center text-sm ${
          fromSearch
            ? "border-blue-200 bg-blue-50 text-blue-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {fromSearch
          ? "本页人物卡来自你本次的搜索结果；本页仍是虚拟聊天演示，消息不会发送给该知乎用户，答主回复由 Agent 生成并标注为 AI。"
          : "模拟聊天：消息不会发送给真实知乎用户；付费咨询不会产生订单或扣款。"}
      </div>

      <div className="mx-auto grid max-w-[1440px] items-start gap-4 p-4 sm:p-6 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <Card className="gap-4 rounded-2xl py-5 shadow-none">
            <CardHeader className="px-5">
              <div className="flex items-center gap-3">
                <CreatorAvatar creator={active.creator} />
                <div>
                  <CardTitle>{active.creator.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {active.creator.relevanceLevel} · {active.creator.score}/100
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <p className="text-sm leading-6 text-muted-foreground">
                {active.creator.reason}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {active.creator.matchedDimensions.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-border bg-white px-2 py-0.5 text-xs"
                  >
                    {item}
                  </span>
                ))}
              </div>
              <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">
                  {active.creator.evidence.length} 条
                  {fromSearch ? "搜索结果证据" : "演示证据"}
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-800">
                  相关度来自内容证据，不代表咨询效果。
                </p>
              </div>
              {active.sourceRunId && (
                <p className="text-xs leading-5 text-muted-foreground">
                  本次搜索运行：{active.sourceRunId.slice(0, 8)}…
                </p>
              )}
              <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-muted-foreground">
                <p className="font-semibold text-slate-700">边界说明</p>
                <ul className="mt-1 space-y-1">
                  {active.creator.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </aside>

        <section
          data-testid="chat-panel"
          className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm xl:h-[calc(100vh-10rem)] xl:min-h-[560px] xl:max-h-[760px]"
        >
          <MessageList
            items={conversation.items}
            viewerRole={conversation.viewerRole}
            nextCursor={conversation.nextCursor}
            loadingOlder={conversation.loadingOlder}
            onLoadOlder={() => void conversation.loadOlder()}
            onRetry={() => void conversation.retryLast()}
            onDiscard={conversation.discardItem}
            retryDisabled={conversation.sending || conversation.streaming}
          />
          {conversation.messageError && (
            <div
              role="alert"
              className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{conversation.messageError.message}</p>
                {conversation.messageError.retryable && (
                  <button
                    type="button"
                    onClick={() => void conversation.retryLast()}
                    className="mt-1 font-semibold underline"
                  >
                    重试上一次发送
                  </button>
                )}
              </div>
            </div>
          )}
          <MessageComposer
            draft={conversation.draft}
            onDraftChange={conversation.setDraft}
            onSend={() => void conversation.send()}
            onCancelStream={conversation.cancelStream}
            streaming={conversation.streaming}
            sending={conversation.sending}
            viewerRole={conversation.viewerRole}
            onViewerRoleChange={conversation.setViewerRole}
            roleSwitcherEnabled={conversation.roleSwitcherEnabled}
            suggestedQuestions={active.creator.suitableQuestions}
          />
        </section>

        <aside className="space-y-4">
          <ConsultationPanel
            consultation={active.consultation}
            packages={conversation.packages}
            packagesError={conversation.packagesError}
            actionPending={conversation.actionPending}
            notice={conversation.notice}
            onDismissNotice={conversation.dismissNotice}
            onAction={(action, packageId) =>
              void conversation.applyConsultationAction(action, packageId)
            }
            onOpenPayment={(packageId) => {
              setPaymentPackageId(packageId);
              setPaymentOpen(true);
            }}
            viewerRole={conversation.viewerRole}
          />

          {/* 私有知识库只是展示：示例问题填进输入框，不自动发送。 */}
          <PrivateAgentPanel
            view={privateAgent}
            onPickQuestion={conversation.setDraft}
          />
        </aside>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        package={paymentPackage}
        pending={conversation.actionPending}
        onConfirm={() => {
          setPaymentOpen(false);
          void conversation.applyConsultationAction(
            "confirm_mock_payment",
            paymentPackageId ?? undefined,
          );
        }}
      />
    </main>
  );
}
