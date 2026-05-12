import { normalizeKeyword } from "./keywords";

/**
 * 把 selected + custom 关键词合并 → 规范化 → 去空 → 去重 → 排序 → join('|')
 * 用于检测同一学生是否已存在「关键词集合完全相同」的已通过申请。
 */
export function buildKeywordsFingerprint(
  selected: string[],
  custom: string[],
): string {
  const all = [...(selected ?? []), ...(custom ?? [])];
  const set = new Set<string>();
  for (const raw of all) {
    const n = normalizeKeyword(raw);
    if (n) set.add(n);
  }
  return Array.from(set).sort().join("|");
}