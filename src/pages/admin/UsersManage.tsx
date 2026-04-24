import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";
import { fetchAll } from "@/lib/fetchAll";
import TablePagination from "@/components/TablePagination";
import BulkUserDialog from "@/components/BulkUserDialog";

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

const ALL = "__all__";

const UsersManage = () => {
  const { role: roleParam } = useParams<{ role: string }>();
  const role = roleParam === "teachers" ? "teacher" : "student";
  const meta = TITLES[roleParam ?? "students"] ?? TITLES.students;
  const [sp] = useSearchParams();
  const initialSearch = sp.get("search") ?? "";

  const [rows, setRows] = useState<Profile[]>([]);
  const [credits, setCredits] = useState<Map<string, { total: number; count: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [dept, setDept] = useState(ALL);
  const [major, setMajor] = useState(ALL);
  const [klass, setKlass] = useState(ALL);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0);
  const [bulkMode, setBulkMode] = useState<"delete" | "reset" | null>(null);

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
  useEffect(() => { setSearch(sp.get("search") ?? ""); }, [sp]);

  const departments = useMemo(() => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(), [rows]);
  const majors = useMemo(() => Array.from(new Set(rows.map((r) => r.major).filter(Boolean) as string[])).sort(), [rows]);
  const classes = useMemo(() => Array.from(new Set(rows.map((r) => r.class_name).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept !== ALL && r.department !== dept) return false;
      if (role === "student" && major !== ALL && r.major !== major) return false;
      if (role === "student" && klass !== ALL && r.class_name !== klass) return false;
      if (!q) return true;
      return [r.full_name, r.student_no, r.email, r.phone, r.class_name, r.department, r.major]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(q));
    });
  }, [rows, search, dept, major, klass, role]);

  useEffect(() => { setPage(0); }, [search, role, dept, major, klass]);
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const resetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("reset-password", {
      body: { user_id: resetTarget.user_id },
    });
    setResetting(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "重置失败");
      return;
    }
    const pwd = (data as { password?: string })?.password;
    toast.success(`已为 ${resetTarget.full_name ?? resetTarget.email} 重置为默认密码：${pwd ?? ""}`, { duration: 8000 });
    setResetTarget(null);
  };

  const deleteAccount = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { user_id: deleteTarget.user_id },
    });
    setDeleting(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "删除失败");
      return;
    }
    toast.success(`已删除 ${deleteTarget.full_name ?? deleteTarget.student_no ?? deleteTarget.email ?? "账号"}`);
    setDeleteTarget(null);
    setRows((prev) => prev.filter((p) => p.user_id !== deleteTarget.user_id));
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader title={meta.title} description={meta.desc} />

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">筛选</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Input placeholder="搜索姓名 / 学号或工号 / 手机号 / 班级 / 院系" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <TableHead>手机号</TableHead>
                  {role === "student" && <TableHead className="text-right">累计学分</TableHead>}
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} cols={role === "student" ? 8 : 5} />
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={role === "student" ? 8 : 5}><EmptyState title="暂无数据" description="请先在「批量导入账号」中导入账号" /></TableCell></TableRow>
                ) : paged.map((r) => {
                  const c = credits.get(r.user_id);
                  return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                    <TableCell>{r.student_no ?? "—"}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    {role === "student" && <TableCell>{r.major ?? "—"}</TableCell>}
                    {role === "student" && <TableCell>{r.class_name ?? "—"}</TableCell>}
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
                      <Button variant="outline" size="sm" onClick={() => { setResetTarget(r); setNewPassword(""); setPwError(null); }}>
                        重置密码
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(r)}>
                        删除账号
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
            <DialogTitle>重置密码 — {resetTarget?.full_name ?? resetTarget?.student_no ?? "用户"}</DialogTitle>
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除账号</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 <span className="font-semibold text-foreground">{deleteTarget?.full_name ?? deleteTarget?.student_no ?? deleteTarget?.email ?? "该用户"}</span> 的账号、个人资料及角色信息，操作不可撤销。请再次点击「确认删除」继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteAccount(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default UsersManage;
