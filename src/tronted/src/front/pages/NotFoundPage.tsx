import { ArrowLeft, Search } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/front/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-primary">
          <Search className="size-5" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">页面不存在</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          这个地址没有对应的页面。回到首页重新开始一次找人搜索。
        </p>
        <Button asChild className="mt-5 h-11 rounded-xl">
          <Link to="/">
            <ArrowLeft /> 返回首页
          </Link>
        </Button>
      </div>
    </main>
  );
}
