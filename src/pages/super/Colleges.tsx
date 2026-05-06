import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import EmptyState from "@/components/EmptyState";

type College = {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  system_title: string;
  badge_url: string | null;
  active: boolean;
};

const Colleges = () => {
  const [rows, setRows] = useState<College[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", short_name: "", system_title: "学分认证系统" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("colleges").select("*").order("created_at", { ascending: false });
    setRows((data as College[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("代号和名称必填");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("colleges").insert({
      code: form.code.trim(),
      name: form.name.trim(),
      short_name: form.short_name.trim() || null,
      system_title: form.system_title.trim() || "学分认证系统",
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("学院已创建");
    setOpen(false);
    setForm({ code: "", name: "", short_name: "", system_title: "学分认证系统" });
    void load();
  };

  const toggleActive = async (c: College) => {
    const { error } = await supabase.from("colleges").update({ active: !c.active }).eq("id", c.id);
    if (error) toast.error(error.message); else void load();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">学院管理</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">新增学院</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新增学院</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>代号 *</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如 INFO" />
                </div>
                <div>
                  <Label>名称 *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 信息工程学院" />
                </div>
                <div>
                  <Label>简称</Label>
                  <Input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} placeholder="如 信工" />
                </div>
                <div>
                  <Label>系统标题</Label>
                  <Input value={form.system_title} onChange={(e) => setForm({ ...form, system_title: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={saving}>{saving ? "保存中…" : "创建"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">共 {rows.length} 个学院</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>代号</TableHead><TableHead>名称</TableHead><TableHead>简称</TableHead>
                <TableHead>系统标题</TableHead><TableHead>院徽</TableHead><TableHead>启用</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={6}>加载中…</TableCell></TableRow>
                  : rows.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState title="暂无学院" description="点击右上角「新增学院」开始" /></TableCell></TableRow>
                  : rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.code}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.short_name ?? "—"}</TableCell>
                      <TableCell>{c.system_title}</TableCell>
                      <TableCell>{c.badge_url ? <img src={c.badge_url} alt="" className="h-8 w-8 rounded" /> : "—"}</TableCell>
                      <TableCell><Switch checked={c.active} onCheckedChange={() => toggleActive(c)} /></TableCell>
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

export default Colleges;