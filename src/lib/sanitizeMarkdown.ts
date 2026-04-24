const FILLERS = [
  /^作为\s*AI\s*助手[，,。：:]?\s*/,
  /^根据您提供的信息[，,。：:]?\s*/,
  /^我将为您[^\n。.]*[。.]?\s*/,
  /^好的[，,。：:]?\s*/,
  /^以下是[^\n：:]*[：:]\s*/,
];

export function sanitizeMarkdown(input: string): string {
  if (!input) return "";
  let s = String(input).trim();
  s = s.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  s = s.replace(/^[ \t]*([*\-=_]\s*){3,}[ \t]*$/gm, "---");
  s = s.replace(/^\s*\|\s*$/gm, "");
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  for (const re of FILLERS) s = s.replace(re, "");
  s = s.replace(/^[ \t]*[•·]\s+/gm, "- ");
  return s.trim();
}
