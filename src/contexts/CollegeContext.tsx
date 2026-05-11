import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePreviewTheme } from "@/hooks/usePreviewTheme";

export type CollegeTheme = {
  primary?: string;
  accent?: string;
  background?: string;
  sidebarBg?: string;
  headerTint?: string;
  brandStrong?: string;
  radius?: string;
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

const isValidHsl = (v?: string) =>
  !!v && /^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$/.test(v);
const isValidRadius = (v?: string) => !!v && /^\d+(\.\d+)?(rem|px|em)$/.test(v);

const VAR_KEYS = [
  "--primary", "--ring", "--sidebar-primary", "--sidebar-ring",
  "--accent", "--sidebar-accent",
  "--background", "--sidebar-background", "--card",
  "--radius", "--header-tint", "--brand-strong",
] as const;

const resetThemeVars = (root: HTMLElement) => {
  VAR_KEYS.forEach((k) => root.style.removeProperty(k));
};

const cacheKey = (id: string) => `college-cache:${id}`;
const cssCacheKey = (id: string) => `college-css-vars:${id}`;

const readCache = (id: string | null | undefined): College | null => {
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(id));
    return raw ? (JSON.parse(raw) as College) : null;
  } catch {
    return null;
  }
};

const writeCache = (id: string, data: College) => {
  try {
    sessionStorage.setItem(cacheKey(id), JSON.stringify(data));
  } catch { /* noop */ }
};

const applyToRoot = (data: College) => {
  const t = data.theme ?? {};
  const root = document.documentElement;
  resetThemeVars(root);
  const setVars: Record<string, string> = {};
  const set = (k: string, v: string) => {
    root.style.setProperty(k, v);
    setVars[k] = v;
  };
  if (isValidHsl(t.primary)) {
    set("--primary", t.primary!);
    set("--ring", t.primary!);
    set("--sidebar-primary", t.primary!);
    set("--sidebar-ring", t.primary!);
  }
  if (isValidHsl(t.accent)) {
    set("--accent", t.accent!);
    set("--sidebar-accent", t.accent!);
  }
  if (isValidHsl(t.background)) {
    set("--background", t.background!);
    set("--card", t.background!);
  }
  if (isValidHsl(t.sidebarBg)) set("--sidebar-background", t.sidebarBg!);
  else if (isValidHsl(t.background)) set("--sidebar-background", t.background!);
  if (isValidHsl(t.headerTint)) set("--header-tint", t.headerTint!);
  else if (isValidHsl(t.primary)) set("--header-tint", t.primary!.replace(/(\d+)%\s*$/, "94%"));
  if (isValidHsl(t.brandStrong)) set("--brand-strong", t.brandStrong!);
  else if (isValidHsl(t.primary)) set("--brand-strong", t.primary!);
  if (isValidRadius(t.radius)) set("--radius", t.radius!);
  try {
    localStorage.setItem(cssCacheKey(data.id), JSON.stringify(setVars));
    localStorage.setItem("college-css-vars:last", data.id);
  } catch { /* noop */ }
};

type Ctx = College | null;
const CollegeContext = createContext<Ctx>(null);

export const CollegeProvider = ({ children }: { children: ReactNode }) => {
  const { collegeId } = useAuth();
  const { active: previewActive } = usePreviewTheme();
  const [college, setCollege] = useState<College | null>(() => readCache(collegeId));
  const previewActiveRef = useRef(previewActive);
  previewActiveRef.current = previewActive;

  useEffect(() => {
    if (!collegeId) {
      setCollege(null);
      resetThemeVars(document.documentElement);
      return;
    }
    // Synchronously seed from cache (may already be set in initial state if collegeId matches)
    const cached = readCache(collegeId);
    if (cached) {
      setCollege(cached);
      if (!previewActiveRef.current) applyToRoot(cached);
    }

    let cancelled = false;
    const apply = (data: any) => {
      if (!data) return;
      const c = data as College;
      setCollege(c);
      writeCache(collegeId, c);
      if (!previewActiveRef.current) applyToRoot(c);
    };
    const fetchOnce = async () => {
      const { data } = await supabase
        .from("colleges")
        .select("id, code, name, short_name, system_title, badge_url, theme")
        .eq("id", collegeId)
        .maybeSingle();
      if (cancelled) return;
      apply(data);
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
  }, [collegeId]);

  // Re-apply when exiting preview so cached theme returns immediately
  useEffect(() => {
    if (!previewActive && college) applyToRoot(college);
  }, [previewActive, college]);

  return <CollegeContext.Provider value={college}>{children}</CollegeContext.Provider>;
};

export const useCollege = () => useContext(CollegeContext);