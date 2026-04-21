import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Tone = "primary" | "success" | "warning" | "danger" | "info";

const toneMap: Record<Tone, { iconBg: string; iconText: string; accent: string }> = {
  primary: { iconBg: "bg-primary/10", iconText: "text-primary", accent: "from-primary/5" },
  success: { iconBg: "bg-success/15", iconText: "text-success", accent: "from-success/5" },
  warning: { iconBg: "bg-warning/15", iconText: "text-warning", accent: "from-warning/5" },
  danger: { iconBg: "bg-danger/10", iconText: "text-danger", accent: "from-danger/5" },
  info: { iconBg: "bg-info/10", iconText: "text-info", accent: "from-info/5" },
};

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  loading?: boolean;
  onClick?: () => void;
}

const StatCard = ({ label, value, icon: Icon, tone = "primary", hint, loading, onClick }: StatCardProps) => {
  const t = toneMap[tone];
  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden border bg-card p-5 shadow-card transition-all",
        "hover:-translate-y-0.5 hover:shadow-cardHover",
        onClick && "cursor-pointer",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-60", t.accent)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <p className="mt-1 animate-fade-in-up text-3xl font-bold tracking-tight">{value}</p>
          )}
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", t.iconBg)}>
          <Icon className={cn("h-5 w-5", t.iconText)} />
        </div>
      </div>
    </Card>
  );
};

export default StatCard;