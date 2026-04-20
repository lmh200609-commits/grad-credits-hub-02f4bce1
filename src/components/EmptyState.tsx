import { ReactNode } from "react";
import { Inbox } from "lucide-react";

type Props = {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export const EmptyState = ({
  icon,
  title = "暂无数据",
  description,
  action,
  className,
}: Props) => (
  <div
    className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center ${className ?? ""}`}
  >
    <div className="text-muted-foreground">
      {icon ?? <Inbox className="h-8 w-8" />}
    </div>
    <p className="text-sm font-medium">{title}</p>
    {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export default EmptyState;
