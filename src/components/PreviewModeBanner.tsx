import { useNavigate } from "react-router-dom";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreviewTheme, type PreviewRoleView } from "@/hooks/usePreviewTheme";
import { cn } from "@/lib/utils";

const ROLE_HOMES: Record<Exclude<PreviewRoleView, null>, string> = {
  admin: "/admin/dashboard",
  teacher: "/teacher/dashboard",
  student: "/",
};
const ROLE_LABELS: Record<Exclude<PreviewRoleView, null>, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

const PreviewModeBanner = () => {
  const { active, roleView, setRoleView, exitPreview } = usePreviewTheme();
  const navigate = useNavigate();
  if (!active) return null;
  const switchRole = (r: Exclude<PreviewRoleView, null>) => {
    setRoleView(r);
    navigate(ROLE_HOMES[r]);
  };
  return (
    <>
      <div className="h-10" aria-hidden />
      <div className="fixed inset-x-0 top-0 z-[60] flex h-10 items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/95 px-3 text-sm text-amber-950 shadow-sm backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="hidden truncate font-medium sm:inline">预览模式 · 仅对你可见</span>
          <div className="ml-1 inline-flex overflow-hidden rounded-md border border-amber-900/30 bg-white/70">
            {(["admin", "teacher", "student"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => switchRole(r)}
                className={cn(
                  "px-2 py-1 text-xs transition-colors",
                  roleView === r ? "bg-amber-900 text-amber-50" : "text-amber-950 hover:bg-white",
                )}
              >
                {ROLE_LABELS[r]}视角
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-900/30 bg-white/80 text-amber-950 hover:bg-white"
            onClick={() => { exitPreview(); navigate("/admin/branding"); }}
          >
            返回风格设置
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-900/30 bg-white/80 text-amber-950 hover:bg-white"
            onClick={() => exitPreview()}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            退出预览
          </Button>
        </div>
      </div>
    </>
  );
};

export default PreviewModeBanner;