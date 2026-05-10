import { createContext, ReactNode, useCallback, useContext, useState } from "react";

export type PreviewTheme = {
  primary?: string;
  accent?: string;
  background?: string;
  radius?: string;
};

type Ctx = {
  active: boolean;
  theme: PreviewTheme;
  enterPreview: (theme: PreviewTheme) => void;
  exitPreview: () => void;
};

const PreviewThemeContext = createContext<Ctx | null>(null);

const isValidHsl = (v?: string) =>
  !!v && /^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$/.test(v);
const isValidRadius = (v?: string) => !!v && /^\d+(\.\d+)?(rem|px|em)$/.test(v);

const VARS = [
  "--primary", "--ring", "--sidebar-primary", "--sidebar-ring",
  "--accent", "--background", "--card", "--radius",
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
  if (isValidHsl(theme.accent)) root.style.setProperty("--accent", theme.accent!);
  if (isValidHsl(theme.background)) {
    root.style.setProperty("--background", theme.background!);
    root.style.setProperty("--card", theme.background!);
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

  const enterPreview = useCallback((t: PreviewTheme) => {
    setTheme(t);
    setActive(true);
    applyVars(t);
  }, []);

  const exitPreview = useCallback(() => {
    setActive(false);
    setTheme({});
    clearVars();
    // Trigger college theme re-apply by dispatching a custom event
    window.dispatchEvent(new CustomEvent("preview-theme-exit"));
  }, []);

  return (
    <PreviewThemeContext.Provider value={{ active, theme, enterPreview, exitPreview }}>
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
      enterPreview: () => {},
      exitPreview: () => {},
    };
  }
  return ctx;
};