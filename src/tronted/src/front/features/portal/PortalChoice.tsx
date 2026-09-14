import { ArrowRight, Compass, Search } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/front/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/front/components/ui/card";

export type PortalEntryId = "fields" | "find";

type PortalEntry = {
  id: PortalEntryId;
  title: string;
  description: string;
  bullets: string[];
  to: string;
  cta: string;
  icon: typeof Compass;
  tone: string;
};

/**
 * 功能首页只有两个入口，且两者语义不同：
 * 领域入口是「按方向浏览」，找人入口是「按问题检索」。
 * 这里刻意不放搜索框——把领域检索和人物检索混在一处是需求明确禁止的。
 */
const ENTRIES: PortalEntry[] = [
  {
    id: "fields",
    title: "专业领域社交",
    description:
      "从方向出发：先看这个领域有哪些子议题，再看谁在持续输出，最后决定和谁聊。",
    bullets: ["领域目录与检索", "领域星图与人物聚类", "统一人物名片"],
    to: "/app/fields",
    cta: "浏览专业领域",
    icon: Compass,
    tone: "bg-blue-50 text-primary",
  },
  {
    id: "find",
    title: "问题找人",
    description:
      "从处境出发：把你的真实问题交给检索 Agent，得到带内容证据、可解释的人物资料卡。",
    bullets: ["六阶段检索进度", "证据可追溯", "三栏对比测试"],
    to: "/app/find",
    cta: "描述问题找人",
    icon: Search,
    tone: "bg-violet-50 text-violet-700",
  },
];

export function PortalChoice({ entry }: { entry: PortalEntryId }) {
  const item = ENTRIES.find((candidate) => candidate.id === entry);
  if (!item) return null;
  const Icon = item.icon;

  return (
    <Card className="card-enter group gap-0 rounded-2xl py-0 shadow-sm transition-shadow hover:shadow-[0_18px_48px_rgba(19,52,95,.12)]">
      <CardHeader className="gap-3 px-6 py-6">
        <span className={`grid size-11 place-items-center rounded-2xl ${item.tone}`}>
          <Icon className="size-5" />
        </span>
        {/* 用真实标题元素而不是样式化的 div：屏幕阅读器要能按标题跳转。 */}
        <h2 className="text-xl font-semibold leading-none">{item.title}</h2>
        <CardDescription className="leading-6">{item.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        <ul className="space-y-2 text-sm text-muted-foreground">
          {item.bullets.map((bullet) => (
            <li key={bullet} className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
              {bullet}
            </li>
          ))}
        </ul>
        <Button asChild className="h-11 w-full rounded-xl text-base">
          <Link to={item.to}>
            {item.cta}
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
