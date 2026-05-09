export type Section = {
  key: "conclusion" | "evidence" | "supplement" | "action" | "summary";
  title: string;
  body: string;
};

const FILLERS = [
  /^作为\s*AI\s*助手[，,。：:]?\s*/,
  /^根据您提供的信息[，,。：:]?\s*/,
  /^我将为您[^\n。.]*[。.]?\s*/,
  /^好的[，,。：:]?\s*/,
  /^以下是[^\n：:]*[：:]\s*/,
];

export function normalizeMarkdown(input: string): string {
  if (!input) return "";
  let s = String(input).trim();
  s = s.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  s = s.replace(/^[ \t]*([*\-=_]\s*){3,}[ \t]*$/gm, "---");
  s = s.replace(/^\s*\|\s*$/gm, "");
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  for (const re of FILLERS) s = s.replace(re, "");
  s = s.replace(/^[ \t]*[•·]\s+/gm, "- ");
  // 剥离装饰性带圈数字（1️⃣ 2️⃣ ...）和提示性 emoji，避免「AI 感」过重。
  s = s.replace(/[\u0030-\u0039]\uFE0F?\u20E3/g, "");
  s = s.replace(/[⚠️📎👇✅❌🎉🤖💡⭐️✨📝📌🔔ℹ️👉👆👀]/g, "");
  return s.trim();
}

/** 剥离 markdown 强调符 / 装饰 emoji，用于纯文本输出场景。 */
export function stripDecorations(input: string): string {
  if (!input) return "";
  let s = String(input);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  s = s.replace(/__([^_\n]+)__/g, "$1");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
  s = s.replace(/[\u0030-\u0039]\uFE0F?\u20E3/g, "");
  s = s.replace(/[⚠️📎👇✅❌🎉🤖💡⭐️✨📝📌🔔ℹ️👉👆👀]/g, "");
  return s.trim();
}

const SECTION_PATTERNS: { key: Section["key"]; title: string; re: RegExp }[] = [
  { key: "conclusion", title: "结论", re: /^\s*(?:#{1,3}\s*)?(?:\*\*)?结论(?:\*\*)?\s*[:：]?\s*/m },
  { key: "evidence", title: "依据", re: /^\s*(?:#{1,3}\s*)?(?:\*\*)?依据(?:\*\*)?\s*[:：]?\s*/m },
  { key: "supplement", title: "补充", re: /^\s*(?:#{1,3}\s*)?(?:\*\*)?补充(?:\*\*)?\s*[:：]?\s*/m },
  { key: "action", title: "操作建议", re: /^\s*(?:#{1,3}\s*)?(?:\*\*)?操作建议(?:\*\*)?\s*[:：]?\s*/m },
];

export function toSections(raw: string): Section[] | null {
  if (!raw) return null;
  const text = raw;
  const hits: { key: Section["key"]; title: string; start: number; matchEnd: number }[] = [];
  for (const p of SECTION_PATTERNS) {
    const m = text.match(p.re);
    if (m && typeof m.index === "number") {
      hits.push({ key: p.key, title: p.title, start: m.index, matchEnd: m.index + m[0].length });
    }
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.start - b.start);
  const sections: Section[] = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const next = hits[i + 1];
    const body = text.slice(cur.matchEnd, next ? next.start : text.length).trim();
    sections.push({ key: cur.key, title: cur.title, body });
  }
  return sections;
}

const JUNK_RE = [/\*{3,}/, /^\s*\|\s*$/m, /#{3,}/, /^={3,}$/m];

export function shouldPolish(raw: string, opts: { toolCalls?: number } = {}): boolean {
  if (!raw) return false;
  if (raw.length > 600) return true;
  let junk = 0;
  for (const re of JUNK_RE) if (re.test(raw)) junk++;
  if (junk >= 2) return true;
  if ((opts.toolCalls || 0) >= 2) return true;
  return false;
}

export async function callPolish(
  supabaseUrl: string,
  serviceKey: string,
  raw: string,
  timeoutMs = 3000,
): Promise<{ text: string; polished: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(`${supabaseUrl}/functions/v1/polish-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ raw }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { text: raw, polished: false };
    const data = await resp.json();
    const polishedText = (data?.polished || "").trim();
    if (!polishedText) return { text: raw, polished: false };
    return { text: polishedText, polished: true };
  } catch (_) {
    return { text: raw, polished: false };
  }
}

export function buildResponse(rawAnswer: string, opts: { polished?: boolean; extra?: Record<string, unknown> } = {}) {
  const answer = normalizeMarkdown(rawAnswer);
  const sections = toSections(answer);
  return {
    answer,
    sections,
    meta: { polished: !!opts.polished },
    ...(opts.extra || {}),
  };
}
