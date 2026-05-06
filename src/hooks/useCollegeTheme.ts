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

  useEffect(() => {
    if (!collegeId) {
      setCollege(null);
      // reset CSS overrides
      const root = document.documentElement;
      root.style.removeProperty("--primary");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--radius");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("colleges")
        .select("id, code, name, short_name, system_title, badge_url, theme")
        .eq("id", collegeId)
        .maybeSingle();
      if (cancelled || !data) return;
      setCollege(data as College);
      const t = (data.theme ?? {}) as CollegeTheme;
      const root = document.documentElement;
      if (t.primary) {
        root.style.setProperty("--primary", t.primary);
        root.style.setProperty("--ring", t.primary);
        root.style.setProperty("--sidebar-primary", t.primary);
        root.style.setProperty("--sidebar-ring", t.primary);
      }
      if (t.accent) root.style.setProperty("--accent", t.accent);
      if (t.background) root.style.setProperty("--background", t.background);
      if (t.radius) root.style.setProperty("--radius", t.radius);
    })();
    return () => {
      cancelled = true;
    };
  }, [collegeId]);

  return college;
};