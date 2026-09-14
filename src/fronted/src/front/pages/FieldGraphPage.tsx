import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AppHeader } from "@/front/components/layout/AppHeader";
import { ErrorPanel, InlineError } from "@/front/components/layout/PageStates";
import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Skeleton } from "@/front/components/ui/skeleton";
import { useApiClient } from "@/front/app/api-context";
import { ApiError } from "@/front/api/ApiError";
import { CreatorDetail } from "@/front/features/creator/CreatorDetail";
import { FieldTopicFilter } from "@/front/features/field-graph/FieldTopicFilter";
import { FieldGraph } from "@/front/features/field-graph/FieldGraph";
import {
  OTHER_GROUP_ID,
  OTHER_GROUP_NAME,
  layoutGraph,
} from "@/front/features/field-graph/graph-layout";
import { useFieldGraph } from "@/front/features/field-graph/useFieldGraph";
import { useStartConversation } from "@/front/features/chat/useConversation";
import { fieldColorClasses, fieldIcon } from "@/front/features/fields/field-theme";
import type { AuthSessionView } from "@/shared/contracts/auth";
import type { CreatorCardData } from "@/shared/contracts/creator";
import type { FieldGraphResponse, FieldPerson } from "@/shared/contracts/field";

function GraphSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-10 sm:px-6">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-full max-w-2xl" />
      <Skeleton className="h-10 w-full max-w-2xl rounded-full" />
      <Skeleton className="h-[520px] w-full rounded-2xl" />
      <span className="sr-only" role="status">
        正在加载领域星图
      </span>
    </div>
  );
}

/**
 * 领域星图页（`/app/fields/:fieldId`）。
 *
 * 页面负责三件事：装配头部与筛选器、把「点击头像」变成一次公开资料查询、
 * 以及在用户确认后创建会话并跳转。星图组件本身不创建会话。
 */
export function FieldGraphPage({ session }: { session: AuthSessionView }) {
  const { fieldId } = useParams<{ fieldId: string }>();
  const client = useApiClient();
  const navigate = useNavigate();
  const { state, reload } = useFieldGraph(fieldId ?? "");
  const startConversation = useStartConversation();

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<CreatorCardData | null>(null);
  const [pendingPersonId, setPendingPersonId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<{
    message: string;
    retryable: boolean;
    person: FieldPerson | null;
  } | null>(null);

  const graph: FieldGraphResponse | null = state.status === "ready" ? state.graph : null;
  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);

  const counts = useMemo(() => {
    if (!layout) return {};
    return Object.fromEntries(
      layout.topics.map((topic) => [
        topic.id,
        layout.people.filter((node) => node.topicIds.includes(topic.id)).length,
      ]),
    );
  }, [layout]);

  const otherCount = useMemo(
    () => (layout ? layout.people.filter((node) => node.topicId === null).length : 0),
    [layout],
  );

  /** 打开人物名片：先取后端公开资料，拿不到就明确报错，不猜也不伪造。 */
  const openPerson = useCallback(
    async (person: FieldPerson) => {
      setProfileError(null);
      setPendingPersonId(person.id);
      try {
        const creator = await client.getCreator(person.id);
        setSelectedCreator(creator);
      } catch (caught) {
        setProfileError({
          message:
            caught instanceof Error
              ? caught.message
              : "无法加载这个人的公开资料，请稍后重试。",
          retryable: caught instanceof ApiError ? caught.retryable : true,
          person,
        });
      } finally {
        setPendingPersonId(null);
      }
    },
    [client],
  );

  const handleStartConversation = useCallback(async () => {
    if (!selectedCreator) return;
    // 领域来源没有检索运行，因此 sourceRunId 固定为 null。
    const conversation = await startConversation.start(selectedCreator.id, null);
    if (!conversation) return;
    setSelectedCreator(null);
    // 记下来路：从星图进的聊天，返回时应该回到**这片星图**，而不是写死的找人页
    navigate(`/app/chat/${encodeURIComponent(conversation.id)}`, {
      state: { from: `/app/fields/${encodeURIComponent(fieldId ?? "")}` },
    });
  }, [fieldId, navigate, selectedCreator, startConversation]);

  if (state.status === "not-found") {
    return (
      <ErrorPanel
        title="领域不存在"
        message={state.message}
        retryable={false}
        backTo="/app/fields"
        backLabel="返回领域目录"
      />
    );
  }

  if (state.status === "error") {
    return (
      <ErrorPanel
        title="领域星图加载失败"
        message={state.message}
        retryable={state.retryable}
        onRetry={reload}
        backTo="/app/fields"
        backLabel="返回领域目录"
      />
    );
  }

  if (!graph || !layout) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AppHeader session={session} />
        <GraphSkeleton />
      </main>
    );
  }

  const colors = fieldColorClasses(graph.field.color);
  const Icon = fieldIcon(graph.field.icon);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader session={session} />

      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
        <nav aria-label="面包屑" className="flex items-center gap-2 text-sm">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link to="/app/fields">
              <ArrowLeft /> 返回领域目录
            </Link>
          </Button>
        </nav>

        <header className="card-enter mt-3">
          <div className="flex items-start gap-4">
            <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${colors.chip}`}>
              <Icon className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-3xl font-black tracking-[-0.02em]">{graph.field.name}</h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-muted-foreground">
                {graph.field.description}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {graph.field.tags.map((tag) => (
              <Badge key={tag} variant="outline" className={colors.tag}>
                {tag}
              </Badge>
            ))}
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
              {graph.topics.length} 个议题 · {graph.people.length} 位可交流的人
            </Badge>
          </div>
        </header>

        <section className="mt-6">
          <h2 className="sr-only">议题筛选</h2>
          <FieldTopicFilter
            topics={graph.topics.map((topic) => ({
              id: topic.id,
              name: topic.name,
              description: topic.description,
              position: topic.position,
            }))}
            selectedTopicId={selectedTopicId}
            onChange={setSelectedTopicId}
            counts={counts}
            totalCount={layout.people.length}
            otherCount={otherCount}
            otherLabel={OTHER_GROUP_NAME}
            otherId={OTHER_GROUP_ID}
          />
        </section>

        {profileError && (
          <div className="mt-4">
            <InlineError
              message={profileError.message}
              onRetry={
                profileError.person
                  ? () => void openPerson(profileError.person as FieldPerson)
                  : undefined
              }
              retryLabel="重新加载公开资料"
            />
          </div>
        )}

        <section className="mt-5" aria-label="领域星图">
          <FieldGraph
            graph={graph}
            selectedTopicId={selectedTopicId}
            onSelectTopic={setSelectedTopicId}
            onOpenPerson={(person) => void openPerson(person)}
          />
        </section>

        {selectedTopicId && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4" />
            已按议题筛选：星图上不相关的节点被淡化，但仍可点击。点击同一议题可取消筛选。
          </p>
        )}

        <section className="mt-8 rounded-2xl border border-border bg-white p-6">
          <h2 className="text-base font-bold">关于这张星图</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>· 中心是领域，第一层是子议题，第二层是与议题相关的人物。</li>
            <li>· 人物位置由前端按议题归属计算，与人物的真实影响力无关。</li>
            <li>
              · 相关度只用于排序展示；领域目录不提供逐条内容证据。
              {otherCount > 0 && " 未归入具体议题的人物统一放在「其他」分组。"}
            </li>
          </ul>
        </section>
      </div>

      <CreatorDetail
        creator={selectedCreator}
        open={Boolean(selectedCreator)}
        onOpenChange={(open) => !open && setSelectedCreator(null)}
        onChat={() => void handleStartConversation()}
        chatPending={Boolean(selectedCreator) && startConversation.pendingCreatorId === selectedCreator?.id}
        source="field"
      />

      {pendingPersonId && (
        <span role="status" className="sr-only">
          正在加载人物公开资料
        </span>
      )}
    </main>
  );
}
