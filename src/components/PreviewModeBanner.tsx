import { useNavigate } from "react-router-dom";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreviewTheme } from "@/hooks/usePreviewTheme";

const PreviewModeBanner = () => {
  const { active, exitPreview } = usePreviewTheme();
  const navigate = useNavigate();
  if (!active) return null;
  return (
    <>
      <div className="h-10" aria-hidden />
      <div className="fixed inset-x-0 top-0 z-[60] flex h-10 items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/95 px-3 text-sm text-amber-950 shadow-sm backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">预览模式 · 当前未保存的样式仅对你可见</span>
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