import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DateTimePickerProps = {
  /** "YYYY-MM-DDTHH:mm" (compatible with <input type="datetime-local"> value) */
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  className?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function DateTimePicker({
  value,
  onChange,
  placeholder = "选择日期时间",
  disabled,
  fromYear,
  toYear,
  className,
}: DateTimePickerProps) {
  const parsed = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd'T'HH:mm", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const date = parsed;
  const hour = parsed ? parsed.getHours() : 9;
  const minute = parsed ? parsed.getMinutes() : 0;

  const emit = (d: Date | undefined, h: number, m: number) => {
    if (!d) {
      onChange("");
      return;
    }
    onChange(`${format(d, "yyyy-MM-dd")}T${pad(h)}:${pad(m)}`);
  };

  const today = React.useMemo(() => new Date(), []);
  const _fromYear = fromYear ?? today.getFullYear() - 5;
  const _toYear = toYear ?? today.getFullYear() + 10;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("flex-1 min-w-[10rem] justify-start text-left font-normal", !date && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {date ? format(date, "yyyy 年 M 月 d 日", { locale: zhCN }) : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 z-50 max-h-[var(--radix-popover-content-available-height)] overflow-auto"
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => emit(d, hour, minute)}
            defaultMonth={date ?? new Date()}
            locale={zhCN}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      <Select
        value={pad(hour)}
        onValueChange={(v) => emit(date ?? new Date(), Number(v), minute)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[5.5rem]"><SelectValue placeholder="时" /></SelectTrigger>
        <SelectContent className="max-h-60">
          {Array.from({ length: 24 }, (_, i) => (
            <SelectItem key={i} value={pad(i)}>{pad(i)} 时</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={pad(minute - (minute % 5))}
        onValueChange={(v) => emit(date ?? new Date(), hour, Number(v))}
        disabled={disabled}
      >
        <SelectTrigger className="w-[5.5rem]"><SelectValue placeholder="分" /></SelectTrigger>
        <SelectContent className="max-h-60">
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <SelectItem key={m} value={pad(m)}>{pad(m)} 分</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default DateTimePicker;