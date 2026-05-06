import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

type AppRole = "super_admin" | "admin" | "teacher" | "student";

const RoleRoute = ({ role, children }: { role: AppRole | AppRole[]; children: ReactNode }) => {
  const { user, loading, hasRole, isSuperAdmin } = useAuth();
  const roles = Array.isArray(role) ? role : [role];
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperAdmin && !roles.some((r) => hasRole(r))) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default RoleRoute;
