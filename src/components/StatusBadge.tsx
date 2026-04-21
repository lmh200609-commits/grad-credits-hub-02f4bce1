import { Badge } from "@/components/ui/badge";

type Status =
  | "pending_ai"
  | "auto_approved"
  | "pending_review"
  | "rejected_by_ai"
  | "approved"
  | "rejected";

const MAP: Record<Status, { label: string; className: string }> = {
  pending_ai: { label: "系统核验中", className: "bg-muted text-muted-foreground border-transparent" },
  auto_approved: { label: "系统初审通过", className: "bg-success/15 text-success border-transparent" },
  pending_review: { label: "待教师复核", className: "bg-warning/15 text-warning border-transparent" },
  rejected_by_ai: { label: "系统未通过", className: "bg-danger/10 text-danger border-transparent" },
  approved: { label: "已通过", className: "bg-success text-success-foreground border-transparent" },
  rejected: { label: "已驳回", className: "bg-danger text-danger-foreground border-transparent" },
};

export const StatusBadge = ({ status }: { status: Status }) => {
  const m = MAP[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
};
