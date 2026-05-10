import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePreviewTheme } from "@/hooks/usePreviewTheme";

export type CollegeTheme = {
  primary?: string; // "H S% L%"
  accent?: string;
  background?: string;
  radius?: string; // e.g. "0.5rem"
  layout?: "sidebar" | "top-nav" | "compact";
  fontPair?: string;
};

export type College = {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  system_title: string;
  badge_url: string | null;
  theme: CollegeTheme;
};

export const useCollegeTheme = () => {
  const { collegeId } = useAuth();
  const { active: previewActive } = usePreviewTheme();
  const [college, setCollege] = useState<College | null>(null);

  const resetThemeVars = (root: HTMLElement) => {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--sidebar-ring");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--sidebar-accent");
    root.style.removeProperty("--background");
    root.style.removeProperty("--sidebar-background");
    root.style.removeProperty("--card");
    root.style.removeProperty("--radius");
  };

  // 仅接受形如 "H S% L%" 的 HSL 三元组（H: 0-360，S/L: 0-100%）
  const isValidHsl = (v?: string) => {
    if (!v || typeof v !== "string") return false;
    return /^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$/.test(v);
  };
  const isValidRadius = (v?: string) => !!v && /^\d+(\.\d+)?(rem|px|em)$/.test(v);

  useEffect(() => {
    if (!collegeId) {
      setCollege(null);
      resetThemeVars(document.documentElement);
      return;
    }
    let cancelled = false;
    const applyTheme = (data: any) => {
      if (!data) return;
      setCollege(data as College);
      if (previewActive) return; // 预览中不要覆盖 CSS 变量
      const t = (data.theme ?? {}) as CollegeTheme;
      const root = document.documentElement;
      // 先重置，避免上一次的非法值残留
      resetThemeVars(root);
      if (isValidHsl(t.primary)) {
        root.style.setProperty("--primary", t.primary);
        root.style.setProperty("--ring", t.primary);
        root.style.setProperty("--sidebar-primary", t.primary);
        root.style.setProperty("--sidebar-ring", t.primary);
      }
      if (isValidHsl(t.accent)) {
        root.style.setProperty("--accent", t.accent!);
        root.style.setProperty("--sidebar-accent", t.accent!);
      }
      if (isValidHsl(t.background)) {
        root.style.setProperty("--background", t.background!);
        root.style.setProperty("--card", t.background!);
        root.style.setProperty("--sidebar-background", t.background!);
      }
      if (isValidRadius(t.radius)) root.style.setProperty("--radius", t.radius!);
    };
    const fetchOnce = async () => {
      const { data } = await supabase
        .from("colleges")
        .select("id, code, name, short_name, system_title, badge_url, theme")
        .eq("id", collegeId)
        .maybeSingle();
      if (cancelled) return;
      applyTheme(data);
    };
    void fetchOnce();
    const onExit = () => { void fetchOnce(); };
    window.addEventListener("preview-theme-exit", onExit);
    const channel = supabase
      .channel(`college-theme-${collegeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "colleges", filter: `id=eq.${collegeId}` },
        () => { void fetchOnce(); },
      )
      .subscribe();
    return () => {
      cancelled = true;
      window.removeEventListener("preview-theme-exit", onExit);
      void supabase.removeChannel(channel);
    };
  }, [collegeId, previewActive]);

  return college;
};