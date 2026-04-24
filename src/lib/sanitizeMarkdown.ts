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
  // 移除括号中包含的英文路径/URL，例如：规则库（/admin/rules）或 (https://...)
  s = s.replace(/[（(]\s*(?:https?:\/\/)?\/[A-Za-z0-9\-_\/?=&%.]+\s*[)）]/g, "");
  // 移除 markdown 链接中的英文路径目标，仅保留链接文本：[规则库](/admin/rules) -> 规则库
  s = s.replace(/\[([^\]]+)\]\((?:https?:\/\/)?\/[A-Za-z0-9\-_\/?=&%.]+\)/g, "$1");
  // 清理因移除导致的多余空格
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\s+([，。、；：!?])/g, "$1");
  return s.trim();
}
