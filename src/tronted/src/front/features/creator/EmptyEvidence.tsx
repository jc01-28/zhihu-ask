import { Info } from "lucide-react";

export function EmptyEvidence({ query }: { query: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <Info className="mx-auto size-6 text-slate-500" />
      <h2 className="mt-3 text-lg font-bold">本次没有找到证据足够的人选</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        针对“{query}”的公开内容没有形成可回链的亲历证据。演示原则是不为了凑满三个人而补入无证据人物；可以换一个更具体的问法再试一次。
      </p>
    </div>
  );
}
