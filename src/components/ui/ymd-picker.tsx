import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type YmdPickerProps = {
  value?: string | null; // YYYY-MM-DD
  onChange: (v: string) => void;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  /** Disallow future dates (e.g. birth date). */
  disableFuture?: boolean;
  allowClear?: boolean;
  className?: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const daysInMonth = (year: number, month: number) => {
  // month: 1-12
  return new Date(year, month, 0).getDate();
};

const parseYmd = (v?: string | null) => {
  if (!v) return { y: "", m: "", d: "" };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1], m: m[2], d: m[3] };
};

export function YmdPicker({
  value,
  onChange,
  disabled,
  fromYear,
  toYear,
  disableFuture,
  allowClear = true,
  className,
}: YmdPickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const _from = fromYear ?? 1940;
  const _to = toYear ?? today.getFullYear();

  const init = parseYmd(value);
  const [y, setY] = React.useState<string>(init.y);
  const [m, setM] = React.useState<string>(init.m);
  const [d, setD] = React.useState<string>(init.d);

  // Sync down when external value changes
  React.useEffect(() => {
    const p = parseYmd(value);
    setY(p.y);
    setM(p.m);
    setD(p.d);
  }, [value]);

  const years = React.useMemo(() => {
    const arr: number[] = [];
    for (let i = _to; i >= _from; i--) arr.push(i);
    return arr;
  }, [_from, _to]);

  const months = React.useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const maxDay = React.useMemo(() => {
    const yi = parseInt(y, 10);
    const mi = parseInt(m, 10);
    if (!yi || !mi) return 31;
    return daysInMonth(yi, mi);
  }, [y, m]);

  const days = React.useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  const emit = (yy: string, mm: string, dd: string) => {
    if (!yy || !mm || !dd) return;
    const yi = parseInt(yy, 10);
    const mi = parseInt(mm, 10);
    let di = parseInt(dd, 10);
    const md = daysInMonth(yi, mi);
    if (di > md) di = md;
    if (disableFuture) {
      const candidate = new Date(yi, mi - 1, di);
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (candidate > t) return; // ignore future
    }
    const out = `${yy}-${pad2(mi)}-${pad2(di)}`;
    if (out !== value) onChange(out);
  };

  const handleY = (v: string) => {
    setY(v);
    if (m && d) {
      // clamp day if needed
      const md = daysInMonth(parseInt(v, 10), parseInt(m, 10));
      const dd = Math.min(parseInt(d, 10), md);
      setD(pad2(dd));
      emit(v, m, pad2(dd));
    }
  };
  const handleM = (v: string) => {
    setM(v);
    if (y && d) {
      const md = daysInMonth(parseInt(y, 10), parseInt(v, 10));
      const dd = Math.min(parseInt(d, 10), md);
      setD(pad2(dd));
      emit(y, v, pad2(dd));
    }
  };
  const handleD = (v: string) => {
    setD(v);
    if (y && m) emit(y, m, v);
  };

  const clear = () => {
    setY(""); setM(""); setD("");
    onChange("");
  };

  const hasValue = !!(y && m && d);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select value={y} onValueChange={handleY} disabled={disabled}>
        <SelectTrigger className="w-[6.5rem]">
          <SelectValue placeholder="年" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {years.map((yy) => (
            <SelectItem key={yy} value={String(yy)}>{yy}年</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={m} onValueChange={handleM} disabled={disabled}>
        <SelectTrigger className="w-[5rem]">
          <SelectValue placeholder="月" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {months.map((mm) => (
            <SelectItem key={mm} value={pad2(mm)}>{mm}月</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={d} onValueChange={handleD} disabled={disabled || !y || !m}>
        <SelectTrigger className="w-[5rem]">
          <SelectValue placeholder="日" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {days.map((dd) => (
            <SelectItem key={dd} value={pad2(dd)}>{dd}日</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {allowClear && hasValue && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={clear}
          aria-label="清除"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default YmdPicker;