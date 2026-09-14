import {
  ArrowRight,
  Compass,
  FolderGit,
  Globe,
  Lock,
  MessagesSquare,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { resolveGithubUrl, resolveLiveSiteUrl } from "@/front/shared/entry-links";

/**
 * 项目推荐页（`/`）。
 *
 * 它只介绍项目并给出两个出口，不读取业务 API、不展示登录用户、不提供搜索框，
 * 也不包含任何人物数据——找人流程整体位于知乎授权之后。
 *
 * 两个按钮的地址都来自构建期环境变量：GitHub 地址未配置时给禁用态而不是死链接，
 * 在线网站地址未配置时回退到本站 `/app`。
 */
export function LandingPage() {
  const githubUrl = resolveGithubUrl(import.meta.env.VITE_GITHUB_URL);
  const liveSite = resolveLiveSiteUrl(import.meta.env.VITE_LIVE_SITE_URL);

  return (
    <main className="hero-grid min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-black text-white shadow-[0_8px_24px_rgba(5,109,232,.24)]">
              问
            </span>
            <div>
              <p className="text-base font-bold tracking-tight">知域</p>
              <p className="text-xs text-muted-foreground">找到真正经历过的人</p>
            </div>
          </div>
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
            知乎黑客松 Demo
          </Badge>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1120px] gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="card-enter">
          <Badge className="mb-5 bg-blue-50 text-blue-700 hover:bg-blue-50">
            <Compass /> 专业领域社交 + 搜索 Agent
          </Badge>
          <h1 className="max-w-2xl text-4xl font-black leading-[1.12] tracking-[-0.04em] sm:text-5xl">
            从一个问题开始，
            <br />
            <span className="text-primary">找到值得问的人。</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
            知域把「找人」拆成两条路：按专业领域浏览议题与人物聚类，
            或者直接描述你的处境，让检索 Agent 从知乎公开内容里找出真正经历过的人，
            并给出可核验的证据与可解释的推荐理由。
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Compass, title: "专业领域", text: "议题 → 人物聚类" },
              { icon: Search, title: "问题找人", text: "六阶段检索 + 证据" },
              { icon: MessagesSquare, title: "虚拟私聊", text: "Agent 回复带 AI 标注" },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-white/90 bg-white/80 px-4 py-3 shadow-sm"
              >
                <item.icon className="size-4 text-primary" />
                <p className="mt-2 text-sm font-semibold">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {githubUrl ? (
              <Button asChild size="lg" variant="outline" className="h-12 rounded-xl bg-white text-base">
                <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                  <FolderGit /> 查看 GitHub 项目
                </a>
              </Button>
            ) : (
              <Button size="lg" variant="outline" disabled className="h-12 rounded-xl bg-white text-base">
                <FolderGit /> GitHub 地址暂未配置
              </Button>
            )}

            {liveSite.kind === "external" ? (
              <Button asChild size="lg" className="h-12 rounded-xl text-base">
                <a href={liveSite.href} target="_blank" rel="noopener noreferrer">
                  <Globe /> 进入在线网站 <ArrowRight />
                </a>
              </Button>
            ) : (
              <Button asChild size="lg" className="h-12 rounded-xl text-base">
                <Link to={liveSite.to}>
                  <Globe /> 进入在线网站 <ArrowRight />
                </Link>
              </Button>
            )}
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            找人流程整体位于知乎授权之后：不登录只能看到本页。
            授权在知乎官方页面完成，访问令牌仅由服务端保存，本项目不接收你的知乎密码。
          </p>
        </div>

        <aside className="card-enter rounded-[26px] border border-white/90 bg-white/92 p-6 shadow-[0_24px_80px_rgba(19,52,95,.14)] backdrop-blur-xl">
          <h2 className="text-lg font-bold">这个 Demo 覆盖什么</h2>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            {[
              "项目推荐：你现在看到的这一页。",
              "知乎 OAuth 授权：完成授权后进入功能首页。",
              "专业领域：领域目录 → 领域星图 → 人物名片。",
              "问题找人：六阶段 Agent 检索 → 人物卡 → 三栏对比。",
              "虚拟私聊：消息、AI 回复、模拟咨询与私有 Agent 展示。",
            ].map((item, index) => (
              <li key={item} className="flex gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-muted-foreground">
            <p className="font-semibold text-slate-700">演示边界</p>
            <p className="mt-1">
              人物、领域与消息均为演示数据或知乎公开内容摘要；私聊不会触达真实用户，
              咨询与支付为模拟流程，不产生任何真实扣款。
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
