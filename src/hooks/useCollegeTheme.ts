import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
  const [college, setCollege] = useState<College | null>(null);

  const resetThemeVars = (root: HTMLElement) => {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--sidebar-ring");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--background");
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
      if (isValidHsl(t.accent)) root.style.setProperty("--accent", t.accent!);
      if (isValidHsl(t.background)) root.style.setProperty("--background", t.background!);
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
      void supabase.removeChannel(channel);
    };
  }, [collegeId]);

  return college;
};