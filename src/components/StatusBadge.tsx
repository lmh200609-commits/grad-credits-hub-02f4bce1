import { Badge } from "@/components/ui/badge";

type Status =
  | "pending_ai"
  | "auto_approved"
  | "pending_review"
  | "rejected_by_ai"
  | "approved"
  | "rejected";

type Audience = "student" | "staff";

const STAFF_MAP: Record<Status, { label: string; className: string }> = {
  pending_ai: { label: "系统核验中", className: "bg-muted text-muted-foreground border-transparent" },
  auto_approved: { label: "系统初审通过", className: "bg-success/15 text-success border-transparent" },
  pending_review: { label: "待教师复核", className: "bg-warning/15 text-warning border-transparent" },
  rejected_by_ai: { label: "系统未通过", className: "bg-danger/10 text-danger border-transparent" },
  approved: { label: "已通过", className: "bg-success text-success-foreground border-transparent" },
  rejected: { label: "已驳回", className: "bg-danger text-danger-foreground border-transparent" },
};

// 学生侧脱敏：不暴露「AI/系统核验」等环节，统一为 已提交/审核中/已通过/已拒绝
const STUDENT_MAP: Record<Status, { label: string; className: string }> = {
  pending_ai: { label: "审核中", className: "bg-warning/15 text-warning border-transparent" },
  auto_approved: { label: "已通过", className: "bg-success text-success-foreground border-transparent" },
  pending_review: { label: "审核中", className: "bg-warning/15 text-warning border-transparent" },
  rejected_by_ai: { label: "系统未通过", className: "bg-danger/15 text-danger border-transparent" },
  approved: { label: "已通过", className: "bg-success text-success-foreground border-transparent" },
  rejected: { label: "已拒绝", className: "bg-danger text-danger-foreground border-transparent" },
};

export const StatusBadge = ({ status, audience = "staff" }: { status: Status; audience?: Audience }) => {
  const map = audience === "student" ? STUDENT_MAP : STAFF_MAP;
  const m = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
};
