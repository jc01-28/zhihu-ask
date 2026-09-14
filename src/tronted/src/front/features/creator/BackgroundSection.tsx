import { Newspaper } from "lucide-react";

import type { BackgroundDocument } from "@/shared/contracts/search";

/** 背景来源与人物证据严格分开呈现。 */
export function BackgroundSection({
  documents,
}: {
  documents: BackgroundDocument[];
}) {
  if (documents.length === 0) return null;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center gap-2">
        <Newspaper className="size-4 text-slate-500" />
        <h3 className="text-sm font-bold">行业背景（不参与人物推荐）</h3>
      </div>
      <ul className="mt-3 space-y-3">
        {documents.map((document) => (
          <li key={document.url} className="rounded-xl bg-slate-50 p-3">
            <a
              href={document.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold hover:underline"
            >
              {document.title}
            </a>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {document.excerpt}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              来源：{document.source === "global_search" ? "全网搜索" : "热榜"} · 仅作为背景信息
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
