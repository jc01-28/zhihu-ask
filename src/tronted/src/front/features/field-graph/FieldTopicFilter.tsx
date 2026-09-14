import { cn } from "@/front/shared/cn";
import type { FieldTopic } from "@/shared/contracts/field";

/**
 * 议题筛选器。
 *
 * 语义与星图节点完全一致（同一个 `selectedTopicId`），因此用户点节点还是点这里
 * 得到的结果相同。选项里额外提供「其他」——它对应那些还没归入具体议题的人物，
 * 属于真实存在的分组，不应该在筛选器里消失。
 */
export function FieldTopicFilter({
  topics,
  selectedTopicId,
  onChange,
  counts,
  totalCount,
  otherCount,
  otherLabel,
  otherId,
}: {
  topics: FieldTopic[];
  selectedTopicId: string | null;
  onChange: (topicId: string | null) => void;
  /** 议题 ID → 人物数；一个人可以同时归入多个议题，因此各项之和会大于总人数 */
  counts: Record<string, number>;
  /** 去重后的领域人数。不能由 `counts` 求和得到，否则跨议题人物会被重复计数。 */
  totalCount: number;
  otherCount: number;
  otherLabel: string;
  otherId: string;
}) {
  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition",
      active
        ? "border-primary bg-primary text-white"
        : "border-border bg-white text-muted-foreground hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
    );

  return (
    <div role="group" aria-label="议题筛选" className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={selectedTopicId === null}
        aria-label={`全部领域人物（${totalCount} 人）`}
        onClick={() => onChange(null)}
        className={chip(selectedTopicId === null)}
      >
        全部
        <span className="text-xs opacity-80">{totalCount}</span>
      </button>

      {topics.map((topic) => {
        const active = selectedTopicId === topic.id;
        const count = counts[topic.id] ?? 0;
        return (
          <button
            key={topic.id}
            type="button"
            aria-pressed={active}
            aria-label={`筛选 ${topic.name}（${count} 人）`}
            onClick={() => onChange(active ? null : topic.id)}
            className={chip(active)}
            title={topic.description}
          >
            {topic.name}
            <span className="text-xs opacity-80">{count}</span>
          </button>
        );
      })}

      {otherCount > 0 && (
        <button
          type="button"
          aria-pressed={selectedTopicId === otherId}
          aria-label={`筛选 ${otherLabel}（${otherCount} 人）`}
          onClick={() => onChange(selectedTopicId === otherId ? null : otherId)}
          className={chip(selectedTopicId === otherId)}
        >
          {otherLabel}
          <span className="text-xs opacity-80">{otherCount}</span>
        </button>
      )}
    </div>
  );
}
