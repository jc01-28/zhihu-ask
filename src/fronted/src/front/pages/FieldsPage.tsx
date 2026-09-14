import { AppHeader } from "@/front/components/layout/AppHeader";
import { FieldDirectory } from "@/front/features/fields/FieldDirectory";
import { useFields } from "@/front/features/fields/useFields";
import type { AuthSessionView } from "@/shared/contracts/auth";

/**
 * 专业领域目录页（`/app/fields`）。
 *
 * 页面只负责装配头部与目录；领域数据、检索与状态机都在 `useFields`，
 * 因此这一层不出现任何网络调用。
 */
export function FieldsPage({ session }: { session: AuthSessionView }) {
  const controller = useFields();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader session={session} />
      <FieldDirectory controller={controller} />
    </main>
  );
}
