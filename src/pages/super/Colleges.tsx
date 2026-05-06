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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import EmptyState from "@/components/EmptyState";

type Theme = {
  primary?: string;
  accent?: string;
  background?: string;
  radius?: string;
  layout?: "sidebar" | "top-nav" | "compact";
};

type College = {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  system_title: string;
  badge_url: string | null;
  active: boolean;
  theme: Theme;
};

const emptyForm = {
  code: "",
  name: "",
  short_name: "",
  system_title: "学分认证系统",
  primary: "",
  accent: "",
  radius: "0.5",
  layout: "sidebar" as Theme["layout"],
};

const Colleges = () => {
  const [rows, setRows] = useState<College[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<College | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("colleges").select("*").order("created_at", { ascending: false });
    setRows((data as College[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (c: College) => {
    setEditing(c);
    const t = c.theme ?? {};
    setForm({
      code: c.code,
      name: c.name,
      short_name: c.short_name ?? "",
      system_title: c.system_title,
      primary: t.primary ?? "",
      accent: t.accent ?? "",
      radius: t.radius ? t.radius.replace("rem", "") : "0.5",
      layout: (t.layout ?? "sidebar") as Theme["layout"],
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("代号和名称必填");
      return;
    }
    setSaving(true);
    const theme: Theme = {
      ...(form.primary.trim() && { primary: form.primary.trim() }),
      ...(form.accent.trim() && { accent: form.accent.trim() }),
      ...(form.radius.trim() && { radius: `${form.radius.trim()}rem` }),
      ...(form.layout && { layout: form.layout }),
    };
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      short_name: form.short_name.trim() || null,
      system_title: form.system_title.trim() || "学分认证系统",
      theme,
    };
    const { error } = editing
      ? await supabase.from("colleges").update(payload).eq("id", editing.id)
      : await supabase.from("colleges").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "已更新" : "学院已创建");
    setOpen(false);
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
          <Button size="sm" onClick={openCreate}>新增学院</Button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "编辑学院" : "新增学院"}</DialogTitle></DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>代号 *</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如 INFO" disabled={!!editing} />
                </div>
                <div>
                  <Label>简称</Label>
                  <Input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} placeholder="如 信工" />
                </div>
              </div>
              <div>
                <Label>名称 *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 信息工程学院" />
              </div>
              <div>
                <Label>系统标题</Label>
                <Input value={form.system_title} onChange={(e) => setForm({ ...form, system_title: e.target.value })} />
              </div>
              <div className="pt-2 border-t">
                <div className="text-sm font-semibold mb-2">主题配置</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>主色 (HSL)</Label>
                    <Input value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} placeholder="如 222 80% 50%" />
                  </div>
                  <div>
                    <Label>辅助色 (HSL)</Label>
                    <Input value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} placeholder="如 210 40% 96%" />
                  </div>
                  <div>
                    <Label>圆角 (rem)</Label>
                    <Input value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="0.5" />
                  </div>
                  <div>
                    <Label>布局</Label>
                    <Select value={form.layout} onValueChange={(v) => setForm({ ...form, layout: v as Theme["layout"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sidebar">侧边栏</SelectItem>
                        <SelectItem value="top-nav">顶部导航</SelectItem>
                        <SelectItem value="compact">紧凑</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.primary && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span>预览：</span>
                    <span
                      className="inline-block h-6 w-6 rounded border"
                      style={{ background: `hsl(${form.primary})` }}
                    />
                    <span className="text-muted-foreground">hsl({form.primary})</span>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader><CardTitle className="text-base">共 {rows.length} 个学院</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>代号</TableHead><TableHead>名称</TableHead><TableHead>简称</TableHead>
                <TableHead>系统标题</TableHead><TableHead>主色</TableHead><TableHead>院徽</TableHead>
                <TableHead>启用</TableHead><TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={8}>加载中…</TableCell></TableRow>
                  : rows.length === 0 ? <TableRow><TableCell colSpan={8}><EmptyState title="暂无学院" description="点击右上角「新增学院」开始" /></TableCell></TableRow>
                  : rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.code}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.short_name ?? "—"}</TableCell>
                      <TableCell>{c.system_title}</TableCell>
                      <TableCell>
                        {c.theme?.primary ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block h-4 w-4 rounded border" style={{ background: `hsl(${c.theme.primary})` }} />
                            <span className="text-xs text-muted-foreground">{c.theme.primary}</span>
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>{c.badge_url ? <img src={c.badge_url} alt="" className="h-8 w-8 rounded" /> : "—"}</TableCell>
                      <TableCell><Switch checked={c.active} onCheckedChange={() => toggleActive(c)} /></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>编辑</Button>
                      </TableCell>
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
