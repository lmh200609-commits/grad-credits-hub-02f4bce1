/**
 * 关键词规范化：去除前后空格、压缩内部空白、统一全角/半角标点、英文小写。
 * 用于 upsert 前去重比对，避免「ACM 算法竞赛」「acm  算法竞赛」「ACM，算法竞赛」重复入库。
 */
export const normalizeKeyword = (raw: string): string => {
  if (!raw) return "";
  let s = raw.normalize("NFKC").trim();
  // 全角空格 / 制表 / 换行 → 单个半角空格，并压缩多空格
  s = s.replace(/[\s\u3000]+/g, " ");
  // 常见全角标点 → 半角
  s = s
    .replace(/[，､﹐]/g, ",")
    .replace(/[。．]/g, ".")
    .replace(/[、]/g, ",")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[：﹕]/g, ":")
    .replace(/[；﹔]/g, ";")
    .replace(/[／]/g, "/")
    .replace(/[－—–]/g, "-");
  // 去除标点周围多余空格
  s = s.replace(/\s*([,.:;/()\-])\s*/g, "$1");
  // 英文统一小写（中文字符不受影响）
  s = s.toLowerCase();
  return s;
};

/** 在一组关键词中按规范化形式去重，保留首个出现的原始形态。 */
export const dedupeByNormalized = <T>(
  items: T[],
  getKeyword: (t: T) => string,
): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const norm = normalizeKeyword(getKeyword(it));
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(it);
  }
  return out;
};