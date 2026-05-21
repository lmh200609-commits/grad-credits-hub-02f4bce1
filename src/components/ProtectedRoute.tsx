import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import RouteLoadingSkeleton from "@/components/RouteLoadingSkeleton";
import { hasCachedSupabaseSession } from "@/lib/sessionCache";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) {
    // 已有本地会话：直接放行，由页面内部骨架屏接管，避免出现整屏「加载中…」白屏
    if (hasCachedSupabaseSession()) return <>{children}</>;
    // 真未登录：展示与 AppLayout 一致的轻量骨架，比裸文字更柔和
    return <RouteLoadingSkeleton />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

export default ProtectedRoute;
