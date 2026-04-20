import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";

type Row = {
  user_id: string;
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  major: string | null;
  class_name: string | null;
  total_credit: number;
  approved_count: number;
};

const ALL = "__all__";
const APPROVED = ["approved", "auto_approved"];

const PASS_THRESHOLD = 4;
type PassFilter = "all" | "pass" | "fail";

const Credits = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(ALL);
  const [passFilter, setPassFilter] = useState<PassFilter>("all");

  useEffect(() => {
    (async () => {
      const [{ data: roles }, { data: profiles }, { data: apps }] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "student"),
        supabase.from("profiles").select("user_id, full_name, student_no, department, major, class_name"),
        supabase.from("applications").select("student_id, status, final_credit, ai_suggested_credit"),
      ]);
      const ids = new Set((roles ?? []).map((r) => r.user_id));
      const credit = new Map<string, { total: number; count: number }>();
      (apps ?? []).forEach((a) => {
        if (!APPROVED.includes(a.status)) return;
        const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
        const cur = credit.get(a.student_id) ?? { total: 0, count: 0 };
        credit.set(a.student_id, { total: cur.total + c, count: cur.count + 1 });
      });
      const list: Row[] = (profiles ?? [])
        .filter((p) => ids.has(p.user_id))
        .map((p) => {
          const c = credit.get(p.user_id) ?? { total: 0, count: 0 };
          return { ...p, total_credit: c.total, approved_count: c.count };
        })
        .sort((a, b) => b.total_credit - a.total_credit);
      setRows(list);
    })();
  }, []);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept !== ALL && r.department !== dept) return false;
      if (passFilter === "pass" && r.total_credit < PASS_THRESHOLD) return false;
      if (passFilter === "fail" && r.total_credit >= PASS_THRESHOLD) return false;
      if (!q) return true;
      return [r.full_name, r.student_no, r.class_name, r.major]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [rows, search, dept, passFilter]);

  const passStats = useMemo(() => ({
    pass: rows.filter((r) => r.total_credit >= PASS_THRESHOLD).length,
    fail: rows.filter((r) => r.total_credit < PASS_THRESHOLD).length,
  }), [rows]);

  const exportCsv = () => {
    const header = ["排名", "姓名", "学号", "院系", "专业", "班级", "通过申请数", "累计学分"];
    const lines = filtered.map((r, i) => [
      i + 1, r.full_name ?? "", r.student_no ?? "", r.department ?? "",
      r.major ?? "", r.class_name ?? "", r.approved_count, r.total_credit.toFixed(1),
    ].join(","));
    const blob = new Blob(["\ufeff" + [header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `学分排名_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">学生学分排名</h1>
            <p className="text-sm text-muted-foreground">基于已通过的申请累计计算</p>
          </div>
          <Button onClick={exportCsv} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> 导出 CSV
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">筛选</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Input placeholder="搜索姓名 / 学号 / 班级 / 专业" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger><SelectValue placeholder="院系" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部院系</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={passFilter} onValueChange={(v) => setPassFilter(v as PassFilter)}>
              <SelectTrigger><SelectValue placeholder="是否合格" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="pass">合格（≥{PASS_THRESHOLD} 学分）</SelectItem>
                <SelectItem value="fail">不合格（&lt;{PASS_THRESHOLD} 学分）</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center text-sm text-muted-foreground">
              共 {filtered.length} 名 · 合格 <span className="mx-1 font-semibold text-emerald-600">{passStats.pass}</span> / 不合格 <span className="mx-1 font-semibold text-rose-600">{passStats.fail}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">排名</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>学号</TableHead>
                  <TableHead>院系</TableHead>
                  <TableHead>专业</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead className="text-right">通过申请</TableHead>
                  <TableHead className="text-right">累计学分</TableHead>
                  <TableHead className="text-center">是否合格</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">暂无数据</TableCell></TableRow>
                ) : filtered.map((r, i) => {
                  const passed = r.total_credit >= PASS_THRESHOLD;
                  return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-mono text-muted-foreground">#{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                    <TableCell>{r.student_no ?? "—"}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    <TableCell>{r.major ?? "—"}</TableCell>
                    <TableCell>{r.class_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.approved_count}</TableCell>
                    <TableCell className={`text-right font-semibold ${passed ? "text-emerald-600" : "text-rose-600"}`}>{r.total_credit.toFixed(1)}</TableCell>
                    <TableCell className="text-center">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${passed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"}`}>
                        {passed ? "合格" : "不合格"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/teacher/students/${r.user_id}`}>详情</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Credits;
