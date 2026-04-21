import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProcessStep {
  label: string;
  description?: string;
}

interface ProcessStepsProps {
  steps: ProcessStep[];
  /** index of current step (0-based). steps before are completed, step at index is active. -1 = none active */
  currentStep: number;
  /** mark current step as failed (red) */
  failed?: boolean;
}

const ProcessSteps = ({ steps, currentStep, failed }: ProcessStepsProps) => {
  return (
    <ol className="flex flex-col gap-4 md:flex-row md:items-start md:gap-0">
      {steps.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        const isLast = i === steps.length - 1;
        const activeFailed = isActive && failed;

        return (
          <li key={i} className="flex flex-1 items-start gap-3 md:flex-col md:items-center md:gap-2 md:text-center">
            <div className="flex items-center md:w-full md:flex-col">
              <div className="flex items-center md:w-full">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                    isDone && "border-success bg-success text-success-foreground",
                    isActive && !activeFailed && "border-primary bg-primary text-primary-foreground animate-pulse-soft",
                    activeFailed && "border-danger bg-danger text-danger-foreground",
                    !isDone && !isActive && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                {!isLast && (
                  <div
                    className={cn(
                      "mx-2 hidden h-0.5 flex-1 md:block",
                      isDone ? "bg-success" : "bg-border",
                    )}
                  />
                )}
              </div>
            </div>
            <div className="min-w-0 md:mt-1">
              <div
                className={cn(
                  "text-sm font-medium",
                  isActive && !activeFailed && "text-primary",
                  activeFailed && "text-danger",
                  !isActive && !isDone && "text-muted-foreground",
                )}
              >
                {step.label}
              </div>
              {step.description && (
                <div className="text-xs text-muted-foreground">{step.description}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default ProcessSteps;