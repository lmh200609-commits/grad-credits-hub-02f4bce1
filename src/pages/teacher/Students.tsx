import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Profile = {
  user_id: string;
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  major: string | null;
  class_name: string | null;
  email: string | null;
};

const ALL = "__all__";

const Students = () => {
  const [rows, setRows] = useState<Profile[]>([]);
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState<string>(ALL);
  const [major, setMajor] = useState<string>(ALL);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: roleRows }, { data: profileRows }] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "student"),
        supabase.from("profiles").select("user_id, full_name, student_no, department, major, class_name, email"),
      ]);
      const ids = new Set((roleRows ?? []).map((r) => r.user_id));
      setStudentIds(ids);
      setRows((profileRows ?? []).filter((p) => ids.has(p.user_id)));
      setLoading(false);
    })();
  }, []);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const majors = useMemo(
    () => Array.from(new Set(rows.map((r) => r.major).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept !== ALL && r.department !== dept) return false;
      if (major !== ALL && r.major !== major) return false;
      if (!q) return true;
      return [r.full_name, r.student_no, r.email, r.class_name]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [rows, search, dept, major]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">学生管理</h1>
          <p className="text-sm text-muted-foreground">查看学生基本信息及其所有申请记录与累计学分</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">筛选</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="搜索姓名 / 学号 / 邮箱 / 班级"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger><SelectValue placeholder="院系" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部院系</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={major} onValueChange={setMajor}>
              <SelectTrigger><SelectValue placeholder="专业" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部专业</SelectItem>
                {majors.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center text-sm text-muted-foreground">
              共 {filtered.length} / {rows.length} 名学生
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>学号</TableHead>
                  <TableHead>院系</TableHead>
                  <TableHead>专业</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <>{Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 7 }).map((_, c) => (
                      <TableCell key={c}><div className="h-4 animate-pulse rounded bg-muted" /></TableCell>
                    ))}</TableRow>
                  ))}</>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">暂无符合条件的学生</TableCell></TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                      <TableCell>{r.student_no ?? "—"}</TableCell>
                      <TableCell>{r.department ?? "—"}</TableCell>
                      <TableCell>{r.major ?? "—"}</TableCell>
                      <TableCell>{r.class_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/teacher/students/${r.user_id}`}>查看详情</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Students;
