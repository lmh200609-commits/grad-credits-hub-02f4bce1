import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { resetPasswordSchema } from "@/lib/schemas";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";
import { fetchAll } from "@/lib/fetchAll";
import TablePagination from "@/components/TablePagination";

const PAGE_SIZE = 50;

type Profile = {
  user_id: string;
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  major: string | null;
  class_name: string | null;
  email: string | null;
  phone: string | null;
};

const TITLES: Record<string, { title: string; desc: string }> = {
  students: { title: "学生管理", desc: "查看学生信息并重置密码" },
  teachers: { title: "教师管理", desc: "查看教师信息并重置密码" },
};

const UsersManage = () => {
  const { role: roleParam } = useParams<{ role: string }>();
  const role = roleParam === "teachers" ? "teacher" : "student";
  const meta = TITLES[roleParam ?? "students"] ?? TITLES.students;

  const [rows, setRows] = useState<Profile[]>([]);
  const [credits, setCredits] = useState<Map<string, { total: number; count: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    const [roles, profiles, apps] = await Promise.all([
      fetchAll<{ user_id: string }>(supabase.from("user_roles").select("user_id").eq("role", role)),
      fetchAll<Profile>(supabase.from("profiles").select("user_id, full_name, student_no, department, major, class_name, email, phone")),
      role === "student"
        ? fetchAll<{ student_id: string; status: string; final_credit: number | null; ai_suggested_credit: number | null }>(
            supabase.from("applications").select("student_id, status, final_credit, ai_suggested_credit"))
        : Promise.resolve([] as { student_id: string; status: string; final_credit: number | null; ai_suggested_credit: number | null }[]),
    ]);
    const ids = new Set(roles.map((r) => r.user_id));
    setRows(profiles.filter((p) => ids.has(p.user_id)));
    const m = new Map<string, { total: number; count: number }>();
    apps.forEach((a) => {
      if (!["approved", "auto_approved"].includes(a.status)) return;
      const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      const cur = m.get(a.student_id) ?? { total: 0, count: 0 };
      m.set(a.student_id, { total: cur.total + c, count: cur.count + 1 });
    });
    setCredits(m);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [role]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.full_name, r.student_no, r.email, r.class_name, r.department, r.major]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  useEffect(() => { setPage(0); }, [search, role]);
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const resetPassword = async () => {
    if (!resetTarget) return;
    const parsed = resetPasswordSchema.safeParse({ password: newPassword });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "密码不合规";
      setPwError(msg);
      toast.error(msg);
      return;
    }
    setPwError(null);
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("reset-password", {
      body: { user_id: resetTarget.user_id, new_password: parsed.data.password },
    });
    setResetting(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "重置失败");
      return;
    }
    toast.success(`已为 ${resetTarget.full_name ?? resetTarget.email} 重置密码`);
    setResetTarget(null);
    setNewPassword("");
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.desc}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">筛选</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Input placeholder="搜索姓名 / 学号 / 邮箱 / 班级 / 院系" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="flex items-center text-sm text-muted-foreground">
              共 {filtered.length} / {rows.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>{role === "student" ? "学号" : "工号"}</TableHead>
                  <TableHead>院系</TableHead>
                  {role === "student" && <TableHead>专业</TableHead>}
                  {role === "student" && <TableHead>班级</TableHead>}
                  <TableHead>邮箱</TableHead>
                  <TableHead>电话</TableHead>
                  {role === "student" && <TableHead className="text-right">累计学分</TableHead>}
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} cols={role === "student" ? 9 : 6} />
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={role === "student" ? 9 : 6}><EmptyState title="暂无数据" description="请先在「批量导入账号」中导入账号" /></TableCell></TableRow>
                ) : paged.map((r) => {
                  const c = credits.get(r.user_id);
                  return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                    <TableCell>{r.student_no ?? "—"}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    {role === "student" && <TableCell>{r.major ?? "—"}</TableCell>}
                    {role === "student" && <TableCell>{r.class_name ?? "—"}</TableCell>}
                    <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.phone ?? "—"}</TableCell>
                    {role === "student" && (
                      <TableCell className="text-right">
                        <span className={`font-semibold ${(c?.total ?? 0) >= 4 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {(c?.total ?? 0).toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">({c?.count ?? 0})</span>
                      </TableCell>
                    )}
                    <TableCell className="space-x-2 text-right">
                      {role === "student" && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/teacher/students/${r.user_id}`}>详情</Link>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => { setResetTarget(r); setNewPassword(""); setPwError(null); }}>
                        重置密码
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!loading && filtered.length > PAGE_SIZE && (
              <TablePagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码 — {resetTarget?.full_name ?? resetTarget?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="np">新密码（至少 8 位，包含字母和数字）</Label>
            <Input id="np" type="text" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); if (pwError) setPwError(null); }} placeholder="例如：Abc12345" aria-invalid={!!pwError} />
            {pwError && <p className="text-xs text-destructive">{pwError}</p>}
            <p className="text-xs text-muted-foreground">请通过安全渠道告知用户新密码，并提醒尽快修改</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>取消</Button>
            <Button onClick={resetPassword} disabled={resetting}>
              {resetting ? "重置中…" : "确认重置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default UsersManage;
