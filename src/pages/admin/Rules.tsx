import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil } from "lucide-react";
import { ruleSchema } from "@/lib/schemas";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";
import { writeAuditLog } from "@/lib/audit";

type Rule = {
  id: string;
  name: string;
  category: string | null;
  keywords: string[];
  credit: number;
  description: string | null;
  active: boolean;
};

const empty = { name: "", category: "", keywords: "", credit: 1, description: "", active: true };

const RulesPage = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("rules").select("*").order("created_at", { ascending: false });
    setRules((data as Rule[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (r: Rule) => {
    setEditing(r);
    setForm({
      name: r.name, category: r.category ?? "", keywords: r.keywords.join(", "),
      credit: Number(r.credit), description: r.description ?? "", active: r.active,
    });
    setOpen(true);
  };

  const save = async () => {
    const parsed = ruleSchema.safeParse(form);
    if (!parsed.success) {
      return toast({ title: parsed.error.issues[0]?.message ?? "请检查表单", variant: "destructive" });
    }
    const v = parsed.data;
    const payload = {
      name: v.name,
      category: v.category?.trim() || null,
      keywords: (v.keywords ?? "").split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
      credit: v.credit,
      description: v.description?.trim() || null,
      active: v.active,
    };
    if (editing) {
      const { error } = await supabase.from("rules").update(payload).eq("id", editing.id);
      if (error) return toast({ title: "保存失败", description: error.message, variant: "destructive" });
      writeAuditLog({
        action: "rule_update",
        target_ids: [editing.id],
        target_labels: [payload.name],
        affected_count: 1,
        success_count: 1,
        metadata: { before: { name: editing.name, credit: editing.credit, active: editing.active }, after: payload },
      });
    } else {
      const { data, error } = await supabase.from("rules").insert(payload).select("id").single();
      if (error) return toast({ title: "保存失败", description: error.message, variant: "destructive" });
      writeAuditLog({
        action: "rule_create",
        target_ids: data?.id ? [data.id] : [],
        target_labels: [payload.name],
        affected_count: 1,
        success_count: 1,
        metadata: { payload },
      });
    }
    toast({ title: editing ? "已更新" : "已新增" });
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("确认删除该规则？")) return;
    const target = rules.find((r) => r.id === id);
    const { error } = await supabase.from("rules").delete().eq("id", id);
    if (error) return toast({ title: "删除失败", description: error.message, variant: "destructive" });
    writeAuditLog({
      action: "rule_delete",
      target_ids: [id],
      target_labels: target ? [target.name] : [],
      affected_count: 1,
      success_count: 1,
      metadata: target ? { name: target.name, credit: target.credit, category: target.category } : {},
    });
    toast({ title: "已删除" });
    load();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title="规则库"
          description="学分认证匹配规则，由 AI 在评估时参考"
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />新增规则</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "编辑规则" : "新增规则"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>规则名称</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>类别</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：竞赛 / 科研 / 实践" /></div>
                <div>
                  <Label>关键词（逗号或空格分隔）</Label>
                  <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="ACM, 算法, 编程竞赛" />
                </div>
                <div><Label>默认学分</Label><Input type="number" step="0.5" value={form.credit} onChange={(e) => setForm({ ...form, credit: Number(e.target.value) })} /></div>
                <div><Label>说明</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                  <Label>启用</Label>
                </div>
              </div>
              <DialogFooter><Button onClick={save}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">规则列表（{rules.length}）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead><TableHead>类别</TableHead>
                  <TableHead>关键词</TableHead><TableHead>学分</TableHead>
                  <TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={4} cols={6} />
                ) : rules.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><EmptyState title="暂无规则" description="点击右上角新增第一条匹配规则" /></TableCell></TableRow>
                ) : rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.category ?? "—"}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {r.keywords.slice(0, 6).map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}
                        {r.keywords.length > 6 && <span className="text-xs text-muted-foreground">+{r.keywords.length - 6}</span>}
                      </div>
                    </TableCell>
                    <TableCell>{r.credit}</TableCell>
                    <TableCell>{r.active ? <Badge>启用</Badge> : <Badge variant="outline">停用</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
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

export default RulesPage;
