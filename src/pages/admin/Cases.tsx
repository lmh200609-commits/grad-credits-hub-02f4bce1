import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil } from "lucide-react";
import { caseSchema } from "@/lib/schemas";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";

type Rule = { id: string; name: string };
type Case = { id: string; title: string; summary: string; rule_id: string | null; awarded_credit: number | null; notes: string | null };

const empty = { title: "", summary: "", rule_id: "none", awarded_credit: 1, notes: "" };

const CasesPage = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Case | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);

  const load = async () => {
    setLoading(true);
    const [c, r] = await Promise.all([
      supabase.from("cases").select("*").order("created_at", { ascending: false }),
      supabase.from("rules").select("id, name").eq("active", true),
    ]);
    setCases((c.data as Case[]) ?? []);
    setRules((r.data as Rule[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c: Case) => {
    setEditing(c);
    setForm({
      title: c.title, summary: c.summary, rule_id: c.rule_id ?? "none",
      awarded_credit: Number(c.awarded_credit ?? 0), notes: c.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    const parsed = caseSchema.safeParse(form);
    if (!parsed.success) {
      return toast({ title: parsed.error.issues[0]?.message ?? "请检查表单", variant: "destructive" });
    }
    const v = parsed.data;
    const payload = {
      title: v.title,
      summary: v.summary,
      rule_id: v.rule_id === "none" ? null : v.rule_id,
      awarded_credit: v.awarded_credit,
      notes: v.notes?.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("cases").update(payload).eq("id", editing.id)
      : await supabase.from("cases").insert(payload);
    if (error) return toast({ title: "保存失败", description: error.message, variant: "destructive" });
    toast({ title: editing ? "已更新" : "已新增" }); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("删除该案例？")) return;
    const { error } = await supabase.from("cases").delete().eq("id", id);
    if (error) return toast({ title: "删除失败", description: error.message, variant: "destructive" });
    load();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">案例库</h1>
            <p className="text-sm text-muted-foreground">历史通过的认证案例，AI 评估时作为相似度参考</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />新增案例</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "编辑案例" : "新增案例"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>标题</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div><Label>摘要</Label><Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={4} /></div>
                <div>
                  <Label>关联规则</Label>
                  <Select value={form.rule_id} onValueChange={(v) => setForm({ ...form, rule_id: v })}>
                    <SelectTrigger><SelectValue placeholder="选择规则" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未关联</SelectItem>
                      {rules.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>给定学分</Label><Input type="number" step="0.5" value={form.awarded_credit} onChange={(e) => setForm({ ...form, awarded_credit: Number(e.target.value) })} /></div>
                <div><Label>备注</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
              </div>
              <DialogFooter><Button onClick={save}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">案例列表（{cases.length}）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>标题</TableHead><TableHead>关联规则</TableHead>
                <TableHead>学分</TableHead><TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={4} cols={4} />
                ) : cases.length === 0 ? (
                  <TableRow><TableCell colSpan={4}><EmptyState title="暂无案例" description="新增历史通过案例帮助 AI 评估" /></TableCell></TableRow>
                ) : cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>{rules.find((r) => r.id === c.rule_id)?.name ?? "—"}</TableCell>
                    <TableCell>{c.awarded_credit ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
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

export default CasesPage;
