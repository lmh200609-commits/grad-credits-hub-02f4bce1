import { createContext, ReactNode, useCallback, useContext, useState } from "react";

export type PreviewTheme = {
  primary?: string;
  accent?: string;
  background?: string;
  radius?: string;
};

export type PreviewRoleView = "admin" | "teacher" | "student" | null;

type Ctx = {
  active: boolean;
  theme: PreviewTheme;
  roleView: PreviewRoleView;
  enterPreview: (theme: PreviewTheme) => void;
  setRoleView: (r: PreviewRoleView) => void;
  exitPreview: () => void;
};

const PreviewThemeContext = createContext<Ctx | null>(null);

const isValidHsl = (v?: string) =>
  !!v && /^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$/.test(v);
const isValidRadius = (v?: string) => !!v && /^\d+(\.\d+)?(rem|px|em)$/.test(v);

const VARS = [
  "--primary", "--ring", "--sidebar-primary", "--sidebar-ring",
  "--accent", "--sidebar-accent",
  "--background", "--card", "--sidebar-background",
  "--radius",
];

const applyVars = (theme: PreviewTheme) => {
  const root = document.documentElement;
  VARS.forEach((v) => root.style.removeProperty(v));
  if (isValidHsl(theme.primary)) {
    root.style.setProperty("--primary", theme.primary!);
    root.style.setProperty("--ring", theme.primary!);
    root.style.setProperty("--sidebar-primary", theme.primary!);
    root.style.setProperty("--sidebar-ring", theme.primary!);
  }
  if (isValidHsl(theme.accent)) {
    root.style.setProperty("--accent", theme.accent!);
    root.style.setProperty("--sidebar-accent", theme.accent!);
  }
  if (isValidHsl(theme.background)) {
    root.style.setProperty("--background", theme.background!);
    root.style.setProperty("--card", theme.background!);
    root.style.setProperty("--sidebar-background", theme.background!);
  }
  if (isValidRadius(theme.radius)) root.style.setProperty("--radius", theme.radius!);
};

const clearVars = () => {
  const root = document.documentElement;
  VARS.forEach((v) => root.style.removeProperty(v));
};

export const PreviewThemeProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState(false);
  const [theme, setTheme] = useState<PreviewTheme>({});
  const [roleView, setRoleView] = useState<PreviewRoleView>(null);

  const enterPreview = useCallback((t: PreviewTheme) => {
    setTheme(t);
    setActive(true);
    setRoleView("admin");
    applyVars(t);
  }, []);

  const exitPreview = useCallback(() => {
    setActive(false);
    setTheme({});
    setRoleView(null);
    clearVars();
    // Trigger college theme re-apply by dispatching a custom event
    window.dispatchEvent(new CustomEvent("preview-theme-exit"));
  }, []);

  return (
    <PreviewThemeContext.Provider value={{ active, theme, roleView, enterPreview, setRoleView, exitPreview }}>
      {children}
    </PreviewThemeContext.Provider>
  );
};

export const usePreviewTheme = (): Ctx => {
  const ctx = useContext(PreviewThemeContext);
  if (!ctx) {
    return {
      active: false,
      theme: {},
      roleView: null,
      enterPreview: () => {},
      setRoleView: () => {},
      exitPreview: () => {},
    };
  }
  return ctx;
};