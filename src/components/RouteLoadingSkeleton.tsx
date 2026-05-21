import { Skeleton } from "@/components/ui/skeleton";

/**
 * 路由守卫加载占位：与 AppLayout 视觉一致的轻量骨架屏，
 * 取代以前的全屏「加载中…」白屏，避免切页时出现裸文字闪屏。
 */
const RouteLoadingSkeleton = () => {
  return (
    <div className="flex min-h-screen bg-background">
      {/* 侧边栏占位（小屏自动隐藏，与 AppLayout 一致） */}
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar-background p-4 lg:block">
        <Skeleton className="mb-6 h-8 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </aside>
      {/* 主区占位 */}
      <main className="flex-1 p-4 sm:p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64 w-full" />
      </main>
    </div>
  );
};

export default RouteLoadingSkeleton;