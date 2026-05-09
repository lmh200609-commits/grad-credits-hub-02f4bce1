const FILLERS = [
  /^作为\s*AI\s*助手[，,。：:]?\s*/,
  /^根据您提供的信息[，,。：:]?\s*/,
  /^我将为您[^\n。.]*[。.]?\s*/,
  /^好的[，,。：:]?\s*/,
  /^以下是[^\n：:]*[：:]\s*/,
];

// 装饰性「AI 感」字符：带圈数字、装饰 emoji、提示性图标。这些只用于排版气氛，
// 在纯文本气泡和 markdown 渲染中都会显得突兀，统一剥离。
const KEYCAP_DIGITS = /[\u0030-\u0039]\uFE0F?\u20E3/g; // 1️⃣ 2️⃣ ... 0️⃣
const DECOR_EMOJI = /[⚠️📎👇✅❌🎉🤖💡⭐️✨📝📌🔔ℹ️👉👆👀]/g;

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
  s = s.replace(KEYCAP_DIGITS, "").replace(DECOR_EMOJI, "");
  // 移除括号中包含的英文路径/URL，例如：规则库（/admin/rules）或 (https://...)
  s = s.replace(/[（(]\s*(?:https?:\/\/)?\/[A-Za-z0-9\-_\/?=&%.]+\s*[)）]/g, "");
  // 移除 markdown 链接中的英文路径目标，仅保留链接文本：[规则库](/admin/rules) -> 规则库
  s = s.replace(/\[([^\]]+)\]\((?:https?:\/\/)?\/[A-Za-z0-9\-_\/?=&%.]+\)/g, "$1");
  // 清理因移除导致的多余空格
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\s+([，。、；：!?])/g, "$1");
  return s.trim();
}

/**
 * 把任何文本（含 AI 回复）转成「干净的纯文本」：
 * - 去掉 markdown 强调符 ** __ * _（保留内部文字）
 * - 去掉行首 # > 标记
 * - 去掉装饰性 emoji 和带圈数字
 * 用于不走 ReactMarkdown 渲染、直接 {text} 显示的气泡。
 */
export function toPlainText(input: string): string {
  if (!input) return "";
  let s = String(input);
  // 强调符：**bold** / __bold__ / *italic* / _italic_
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  s = s.replace(/__([^_\n]+)__/g, "$1");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1$2");
  // 行首 markdown 标记
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  // 装饰 emoji & 带圈数字
  s = s.replace(KEYCAP_DIGITS, "").replace(DECOR_EMOJI, "");
  // 链接：[文本](url) -> 文本
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // 多余空格 / 空行
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
