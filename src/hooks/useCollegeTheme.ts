// Backwards-compatible wrapper around the global CollegeContext.
// The real fetching/theming logic now lives in src/contexts/CollegeContext.tsx
// so route changes (which remount AppLayout) don't trigger refetches and
// the badge / colors don't flicker.
export { useCollege as useCollegeTheme } from "@/contexts/CollegeContext";
export type { College, CollegeTheme } from "@/contexts/CollegeContext";
