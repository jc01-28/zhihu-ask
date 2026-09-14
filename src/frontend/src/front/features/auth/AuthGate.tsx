import { ArrowRight, CircleAlert, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/front/components/ui/card";
import type { AuthSessionView } from "@/shared/contracts/auth";

import { AUTH_LOGIN_PATH } from "@/front/features/auth/auth-messages";

/**
 * 未授权时的唯一入口：说明授权边界，并且不提供任何绕过方式。
 */
export function AuthGate({
  session,
  message = null,
}: {
  session: AuthSessionView;
  message?: string | null;
}) {
  return (
    <main className="hero-grid min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-black text-white shadow-[0_8px_24px_rgba(5,109,232,.24)]">
              问
            </span>
            <div>
              <p className="text-base font-bold tracking-tight">知域</p>
              <p className="text-xs text-muted-foreground">找到真正经历过的人</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {/* 未授权时也要有明确的退路：回到不依赖登录的项目介绍页。 */}
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/">返回项目介绍</Link>
            </Button>
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              Hackathon Demo
            </Badge>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1120px] items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_410px]">
        <div>
          <Badge className="mb-5 bg-blue-50 text-blue-700 hover:bg-blue-50">
            <Sparkles /> 搜索 Agent
          </Badge>
          <h1 className="max-w-2xl text-4xl font-black leading-[1.12] tracking-[-0.04em] sm:text-6xl">
            从一个问题开始，
            <br />
            <span className="text-primary">找到值得问的人。</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
            授权知乎账号后，Agent 会围绕你的真实问题检索内容、核验证据，并生成可解释的人物资料卡。
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {["理解你的处境", "核验内容证据", "推荐相关人物"].map((label, index) => (
              <div
                key={label}
                className="rounded-xl border border-white/90 bg-white/80 px-4 py-3 text-sm font-semibold shadow-sm"
              >
                <span className="mr-2 text-primary">0{index + 1}</span>
                {label}
              </div>
            ))}
          </div>
        </div>

        <Card className="gap-0 rounded-[26px] border-white/90 bg-white/92 py-0 shadow-[0_24px_80px_rgba(19,52,95,.14)] backdrop-blur-xl">
          <CardHeader className="border-b border-border/70 px-6 py-6">
            <span className="mb-2 grid size-11 place-items-center rounded-2xl bg-blue-50 text-primary">
              <UserRound className="size-5" />
            </span>
            <CardTitle className="text-2xl">使用知乎账号进入</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              完成授权后返回本页，不需要提供知乎密码给本项目。
            </p>
          </CardHeader>
          <CardContent className="space-y-5 px-6 py-6">
            {message && (
              <div
                role="alert"
                className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"
              >
                <CircleAlert className="mt-1 size-4 shrink-0" />
                {message}
              </div>
            )}
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                授权在知乎官方页面完成
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                访问令牌仅由服务端保存和使用
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                可随时退出并清除本项目授权状态
              </li>
            </ul>
            {session.configured ? (
              <Button
                asChild
                size="lg"
                className="h-12 w-full rounded-xl bg-primary text-base shadow-[0_10px_24px_rgba(5,109,232,.2)]"
              >
                <a href={AUTH_LOGIN_PATH}>
                  <LogIn /> 使用知乎账号授权 <ArrowRight />
                </a>
              </Button>
            ) : (
              <Button size="lg" disabled className="h-12 w-full rounded-xl text-base">
                <LogIn /> 当前部署未配置知乎授权
              </Button>
            )}
            <p className="text-center text-xs leading-5 text-muted-foreground">
              {session.configured
                ? "授权完成后才会进入功能首页。"
                : "当前部署缺少知乎授权配置，无法进入。请联系管理员补齐服务端配置后再试。"}
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
