import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DatePickerProps = {
  value?: string | null; // YYYY-MM-DD
  onChange: (v: string) => void; // emits "" when cleared
  placeholder?: string;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  /** Disallow future dates (e.g. birth date). */
  disableFuture?: boolean;
  className?: string;
  allowClear?: boolean;
  align?: "start" | "center" | "end";
};

export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  disabled,
  fromYear,
  toYear,
  disableFuture,
  className,
  allowClear = true,
  align = "start",
}: DatePickerProps) {
  const parsed = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const handleSelect = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      return;
    }
    onChange(format(d, "yyyy-MM-dd"));
  };

  const today = React.useMemo(() => new Date(), []);
  const _fromYear = fromYear ?? 1940;
  const _toYear = toYear ?? today.getFullYear() + 5;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !parsed && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {parsed ? format(parsed, "yyyy 年 M 月 d 日", { locale: zhCN }) : <span>{placeholder}</span>}
          {allowClear && parsed && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange("");
              }}
              className="ml-auto rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              清除
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={handleSelect}
          defaultMonth={parsed ?? new Date(Math.min(today.getFullYear(), _toYear), today.getMonth(), 1)}
          captionLayout="dropdown-buttons"
          fromYear={_fromYear}
          toYear={_toYear}
          disabled={disableFuture ? (d) => d > today : undefined}
          locale={zhCN}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

export default DatePicker;