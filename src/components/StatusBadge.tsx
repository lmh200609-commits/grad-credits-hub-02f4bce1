import { Badge } from "@/components/ui/badge";

type Status =
  | "pending_ai"
  | "auto_approved"
  | "pending_review"
  | "rejected_by_ai"
  | "approved"
  | "rejected";

const MAP: Record<Status, { label: string; className: string }> = {
  pending_ai: { label: "AI 评估中", className: "bg-muted text-foreground" },
  auto_approved: { label: "AI 已通过", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  pending_review: { label: "待教师复核", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  rejected_by_ai: { label: "AI 不予通过", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  approved: { label: "已通过", className: "bg-emerald-600 text-white" },
  rejected: { label: "已驳回", className: "bg-rose-600 text-white" },
};

export const StatusBadge = ({ status }: { status: Status }) => {
  const m = MAP[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
};
