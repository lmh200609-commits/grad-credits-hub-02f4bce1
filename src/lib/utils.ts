import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 空值占位符，统一在表格/列表中显示。
 */
export const EMPTY_PLACEHOLDER = "—";

/**
 * 统一的日期格式化（YYYY-MM-DD），不依赖浏览器 locale，跨浏览器一致。
 * 空值或非法日期返回 EMPTY_PLACEHOLDER。
 * 用于关键词沉淀日期、审核时间等需要稳定显示的场景。
 */
export function formatDepositDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY_PLACEHOLDER;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY_PLACEHOLDER;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
