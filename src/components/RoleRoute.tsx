import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePreviewTheme } from "@/hooks/usePreviewTheme";
import RouteLoadingSkeleton from "@/components/RouteLoadingSkeleton";
import { hasCachedSupabaseSession } from "@/lib/sessionCache";

type AppRole = "super_admin" | "admin" | "teacher" | "student";

const RoleRoute = ({ role, children }: { role: AppRole | AppRole[]; children: ReactNode }) => {
  const { user, loading, hasRole, isSuperAdmin } = useAuth();
  const { active: previewActive, roleView } = usePreviewTheme();
  const roles = Array.isArray(role) ? role : [role];
  if (loading) {
    if (hasCachedSupabaseSession()) return <>{children}</>;
    return <RouteLoadingSkeleton />;
  }
  if (!user) return <Navigate to="/login" replace />;
  // 预览模式下，若当前预览视角命中本路由所需角色，则放行（仅 UI 预览，不动真实角色）
  if (previewActive && roleView && (roles as string[]).includes(roleView)) {
    return <>{children}</>;
  }
  if (!isSuperAdmin && !roles.some((r) => hasRole(r))) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default RoleRoute;
