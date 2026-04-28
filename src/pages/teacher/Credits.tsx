import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
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
import { Download, Trophy, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";
import TablePagination from "@/components/TablePagination";
import * as XLSX from "xlsx";

const PAGE_SIZE = 50;

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
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(sp.get("dept") ?? ALL);
  const [passFilter, setPassFilter] = useState<PassFilter>((sp.get("passFilter") as PassFilter) ?? "all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const f = sp.get("passFilter") as PassFilter | null;
    if (f && ["all", "pass", "fail"].includes(f)) setPassFilter(f);
    const d = sp.get("dept");
    if (d) setDept(d);
  }, [sp]);

  const updateFilter = (key: "passFilter" | "dept", value: string) => {
    const next = new URLSearchParams(sp);
    if (!value || value === ALL || value === "all") next.delete(key);
    else next.set(key, value);
    setSp(next, { replace: true });
  };

  useEffect(() => {
    (async () => {
      const [roles, profiles, apps] = await Promise.all([
        fetchAll<{ user_id: string }>(supabase.from("user_roles").select("user_id").eq("role", "student")),
        fetchAll<Omit<Row, "total_credit" | "approved_count">>(supabase.from("profiles").select("user_id, full_name, student_no, department, major, class_name")),
        fetchAll<{ student_id: string; status: string; final_credit: number | null; ai_suggested_credit: number | null }>(
          supabase.from("applications").select("student_id, status, final_credit, ai_suggested_credit")),
      ]);
      const ids = new Set(roles.map((r) => r.user_id));
      const credit = new Map<string, { total: number; count: number }>();
      apps.forEach((a) => {
        if (!APPROVED.includes(a.status)) return;
        const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
        const cur = credit.get(a.student_id) ?? { total: 0, count: 0 };
        credit.set(a.student_id, { total: cur.total + c, count: cur.count + 1 });
      });
      const list: Row[] = profiles
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

  useEffect(() => { setPage(0); }, [search, dept, passFilter]);
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const passStats = useMemo(() => ({
    pass: rows.filter((r) => r.total_credit >= PASS_THRESHOLD).length,
    fail: rows.filter((r) => r.total_credit < PASS_THRESHOLD).length,
  }), [rows]);

  const avgCredit = useMemo(() => {
    if (!rows.length) return 0;
    return rows.reduce((s, r) => s + r.total_credit, 0) / rows.length;
  }, [rows]);
  const maxCredit = useMemo(() => rows.reduce((m, r) => Math.max(m, r.total_credit), 0), [rows]);

  const exportXlsx = () => {
    const header = ["排名", "姓名", "学号", "院系", "专业", "班级", "通过申请数", "累计学分", "是否合格"];
    const data = filtered.map((r, i) => [
      i + 1, r.full_name ?? "", r.student_no ?? "", r.department ?? "",
      r.major ?? "", r.class_name ?? "", r.approved_count, Number(r.total_credit.toFixed(1)),
      r.total_credit >= PASS_THRESHOLD ? "合格" : "不合格",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "学分排名");
    const tag = passFilter === "pass" ? "合格" : passFilter === "fail" ? "不合格" : "全部";
    XLSX.writeFile(wb, `学分排名_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title="学生学分排名"
          description="基于已通过的申请累计计算"
          actions={
            <Button onClick={exportXlsx} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" /> 导出 Excel
            </Button>
          }
        />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard label="学生总数" value={rows.length} icon={Users} tone="primary" />
          <StatCard label="合格人数" value={passStats.pass} icon={CheckCircle2} tone="success" hint={`≥${PASS_THRESHOLD} 学分`} onClick={() => { setPassFilter("pass"); updateFilter("passFilter", "pass"); }} />
          <StatCard label="不合格人数" value={passStats.fail} icon={AlertTriangle} tone="danger" hint={`<${PASS_THRESHOLD} 学分`} onClick={() => { setPassFilter("fail"); updateFilter("passFilter", "fail"); }} />
          <StatCard label="平均 / 最高" value={`${avgCredit.toFixed(1)} / ${maxCredit.toFixed(1)}`} icon={Trophy} tone="info" />
        </div>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">筛选</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Input placeholder="搜索姓名 / 学号 / 班级 / 专业" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={dept} onValueChange={(v) => { setDept(v); updateFilter("dept", v); }}>
              <SelectTrigger><SelectValue placeholder="院系" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部院系</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={passFilter} onValueChange={(v) => { setPassFilter(v as PassFilter); updateFilter("passFilter", v); }}>
              <SelectTrigger><SelectValue placeholder="是否合格" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="pass">合格（≥{PASS_THRESHOLD} 学分）</SelectItem>
                <SelectItem value="fail">不合格（&lt;{PASS_THRESHOLD} 学分）</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center text-sm text-muted-foreground">
              共 {filtered.length} 名 · 合格 <span className="mx-1 font-semibold text-success">{passStats.pass}</span> / 不合格 <span className="mx-1 font-semibold text-danger">{passStats.fail}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
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
                ) : paged.map((r, i) => {
                  const rank = page * PAGE_SIZE + i + 1;
                  const passed = r.total_credit >= PASS_THRESHOLD;
                  return (
                  <TableRow key={r.user_id} className={!passed ? "bg-danger/5 hover:bg-danger/10" : "hover:bg-muted/40"}>
                    <TableCell className="font-mono text-muted-foreground">#{rank}</TableCell>
                    <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                    <TableCell>{r.student_no ?? "—"}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    <TableCell>{r.major ?? "—"}</TableCell>
                    <TableCell>{r.class_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.approved_count}</TableCell>
                    <TableCell className={`text-right font-semibold ${passed ? "text-success" : "text-danger"}`}>{r.total_credit.toFixed(1)}</TableCell>
                    <TableCell className="text-center">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
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
            {filtered.length > PAGE_SIZE && (
              <TablePagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Credits;
