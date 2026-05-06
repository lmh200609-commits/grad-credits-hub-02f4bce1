import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type College = { id: string; name: string; code: string };
type AdminRow = { user_id: string; college_id: string | null; profiles: { full_name: string | null; email: string | null } | null; colleges: { name: string } | null };

const Admins = () => {
  const [colleges, setColleges] = useState<College[]>([]);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", college_id: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: cs }, { data: rs }] = await Promise.all([
      supabase.from("colleges").select("id, name, code").order("name"),
      supabase.from("user_roles")
        .select("user_id, college_id, profiles!inner(full_name, email), colleges(name)")
        .eq("role", "admin"),
    ]);
    setColleges((cs as College[]) ?? []);
    setRows((rs as any) ?? []);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!form.email || !form.password || form.password.length < 6 || !form.full_name || !form.college_id) {
      toast.error("请完整填写所有字段（密码 ≥ 6 位）");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("create-college-admin", { body: form });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "创建失败");
      return;
    }
    toast.success("学院管理员已创建");
    setOpen(false);
    setForm({ email: "", password: "", full_name: "", college_id: "" });
    void load();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">学院管理员</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm">新建管理员</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建学院管理员</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>邮箱 *</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@school.edu" />
                </div>
                <div><Label>姓名 *</Label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div><Label>初始密码 * (≥6 位)</Label>
                  <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                <div><Label>所属学院 *</Label>
                  <Select value={form.college_id} onValueChange={(v) => setForm({ ...form, college_id: v })}>
                    <SelectTrigger><SelectValue placeholder="选择学院" /></SelectTrigger>
                    <SelectContent>
                      {colleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={saving}>{saving ? "创建中…" : "创建"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">共 {rows.length} 个学院管理员</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>姓名</TableHead><TableHead>邮箱</TableHead><TableHead>所属学院</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                    <TableCell>{r.profiles?.email ?? "—"}</TableCell>
                    <TableCell>{r.colleges?.name ?? "（未绑定）"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Admins;