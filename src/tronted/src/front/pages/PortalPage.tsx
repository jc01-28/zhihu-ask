import { Badge } from "@/front/components/ui/badge";
import { AppHeader } from "@/front/components/layout/AppHeader";
import { PortalChoice } from "@/front/features/portal/PortalChoice";
import type { AuthSessionView } from "@/shared/contracts/auth";

/**
 * 授权后的功能首页：只做分流。
 *
 * 它不展示完整搜索结果、不提供搜索框，也不预加载领域或人物数据——
 * 这两个入口各自的页面负责自己的数据与状态。
 */
export function PortalPage({ session }: { session: AuthSessionView }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader session={session} />

      <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-14">
        <section className="card-enter">
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
            登录成功 · {session.user?.displayName ?? "知乎账号已授权"}
          </Badge>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.02em] sm:text-4xl">
            你想怎么开始？
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            两条入口通向同一件事：找到真正经历过的人。按方向浏览适合还不确定要问什么的时候，
            按问题检索适合已经有一个具体决策要验证的时候。
          </p>
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <PortalChoice entry="fields" />
          <PortalChoice entry="find" />
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-white p-6">
          <h2 className="text-base font-bold">边界说明</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>· 领域目录只检索领域，不会把领域关键词自动转成人物搜索。</li>
            <li>· 人物资料来自知乎公开内容与演示数据，相关度不代表咨询效果。</li>
            <li>· 私聊为虚拟演示，消息不会发送给真实知乎用户，Agent 回复会标注为 AI。</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
