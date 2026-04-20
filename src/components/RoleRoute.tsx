import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

type AppRole = "admin" | "teacher" | "student";

const RoleRoute = ({ role, children }: { role: AppRole; children: ReactNode }) => {
  const { user, loading, hasRole } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default RoleRoute;
