import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Copy } from "lucide-react";

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

type Props = {
  open: boolean;
  mode: "delete" | "reset";
  role: "student" | "teacher";
  onClose: () => void;
  onDone?: () => void;
};

const ALL = "__all__";

export default function BulkUserDialog({ open, mode, role, onClose, onDone }: Props) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(ALL);
  const [major, setMajor] = useState(ALL);
  const [klass, setKlass] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<Array<{ user_id: string; ok: boolean; label: string; password?: string; error?: string }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch(""); setDept(ALL); setMajor(ALL); setKlass(ALL);
    setSelected(new Set()); setResults(null);
    (async () => {
      setLoading(true);
      const [roles, profiles] = await Promise.all([
        fetchAll<{ user_id: string }>(supabase.from("user_roles").select("user_id").eq("role", role)),
        fetchAll<Profile>(supabase.from("profiles").select("user_id, full_name, student_no, department, major, class_name, email, phone")),
      ]);
      const ids = new Set(roles.map((r) => r.user_id));
      setRows(profiles.filter((p) => ids.has(p.user_id)));
      setLoading(false);
    })();
  }, [open, role]);

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
      return [r.full_name, r.student_no, r.phone, r.class_name, r.department, r.major]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(q));
    });
  }, [rows, search, dept, major, klass, role]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.user_id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((r) => next.delete(r.user_id));
    else filtered.forEach((r) => next.add(r.user_id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const execute = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (ids.length > 200) {
      toast.error("单次最多 200 条，请分批操作");
      return;
    }
    setSubmitting(true);
    const fnName = mode === "delete" ? "bulk-delete-users" : "bulk-reset-password";
    const { data, error } = await supabase.functions.invoke(fnName, { body: { user_ids: ids } });
    setSubmitting(false);
    setConfirmOpen(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "操作失败");
      return;
    }
    const d = data as { results: Array<{ user_id: string; ok: boolean; label: string; password?: string; error?: string }>; success_count: number; failure_count: number };
    if (mode === "delete") {
      toast.success(`批量删除完成：成功 ${d.success_count}，失败 ${d.failure_count}`);
      onDone?.();
      onClose();
    } else {
      toast.success(`批量重置完成：成功 ${d.success_count}，失败 ${d.failure_count}`);
      setResults(d.results);
      onDone?.();
    }
  };

  const copyAll = () => {
    if (!results) return;
    const text = results.filter((r) => r.ok).map((r) => `${r.label}\t${r.password}`).join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("已复制到剪贴板"));
  };

  const title = mode === "delete" ? "批量删除账号" : "批量重置密码";
  const desc = mode === "delete"
    ? "选择要删除的账号。删除后不可恢复，请谨慎操作。"
    : "选择要重置密码的账号。默认密码 = 学号 + 身份证后 6 位（缺失则补 0）。";

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}（{role === "student" ? "学生" : "教师"}）</DialogTitle>
            <DialogDescription>{desc}</DialogDescription>
          </DialogHeader>

          {results ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">已生成 {results.filter((r) => r.ok).length} 个默认密码，请通过安全渠道告知用户。</p>
                <Button variant="outline" size="sm" onClick={copyAll}><Copy className="mr-1 h-4 w-4" />复制全部</Button>
              </div>
              <ScrollArea className="h-72 rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>姓名 / 账号</TableHead>
                      <TableHead>默认密码</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.user_id}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="font-mono">{r.password ?? "—"}</TableCell>
                        <TableCell className={r.ok ? "text-emerald-600" : "text-destructive"}>{r.ok ? "成功" : r.error ?? "失败"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <DialogFooter>
                <Button onClick={onClose}>关闭</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <Input placeholder="搜索姓名/学号/工号/手机号/班级/院系" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={dept} onValueChange={setDept}>
                  <SelectTrigger><SelectValue placeholder="院系" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>全部院系</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                {role === "student" && (
                  <>
                    <Select value={major} onValueChange={setMajor}>
                      <SelectTrigger><SelectValue placeholder="专业" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>全部专业</SelectItem>
                        {majors.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={klass} onValueChange={setKlass}>
                      <SelectTrigger><SelectValue placeholder="班级" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>全部班级</SelectItem>
                        {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">已选 {selected.size} / 当前筛选 {filtered.length} / 总 {rows.length}</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>清空选择</Button>
              </div>

              <ScrollArea className="h-80 rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>{role === "student" ? "学号" : "工号"}</TableHead>
                      <TableHead>院系</TableHead>
                      {role === "student" && <TableHead>专业</TableHead>}
                      {role === "student" && <TableHead>班级</TableHead>}
                      <TableHead>手机号</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">加载中…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">无匹配账号</TableCell></TableRow>
                    ) : filtered.map((r) => (
                      <TableRow key={r.user_id}>
                        <TableCell><Checkbox checked={selected.has(r.user_id)} onCheckedChange={() => toggleOne(r.user_id)} /></TableCell>
                        <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                        <TableCell>{r.student_no ?? "—"}</TableCell>
                        <TableCell>{r.department ?? "—"}</TableCell>
                        {role === "student" && <TableCell>{r.major ?? "—"}</TableCell>}
                        {role === "student" && <TableCell>{r.class_name ?? "—"}</TableCell>}
                        <TableCell className="text-muted-foreground">{r.phone ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              <DialogFooter>
                <Button variant="outline" onClick={onClose}>取消</Button>
                <Button
                  variant={mode === "delete" ? "destructive" : "default"}
                  disabled={selected.size === 0 || submitting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {mode === "delete" ? `删除选中 ${selected.size} 个账号` : `重置选中 ${selected.size} 个密码`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && !submitting && setConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mode === "delete" ? "确认批量删除" : "确认批量重置密码"}</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "delete"
                ? `将永久删除 ${selected.size} 个账号及其个人资料、角色，操作不可撤销。`
                : `将把 ${selected.size} 个账号的密码重置为默认值（学号 + 身份证后 6 位）。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); execute(); }}
              disabled={submitting}
              className={mode === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {submitting ? "执行中…" : "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}