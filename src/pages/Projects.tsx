import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Plus, Send, Users } from "lucide-react";

type Project = {
  id: string; name: string; description: string | null; created_by: string;
  rule_ids: string[]; active: boolean; ends_at: string | null;
};
type Rule = { id: string; name: string; credit: number };
type Profile = { user_id: string; full_name: string | null; email: string | null };

const ProjectsPage = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [open, setOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [collabIds, setCollabIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: "", description: "", rule_ids: [] as string[], ends_at: "", active: true,
  });

  const load = async () => {
    const [p, r] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("rules").select("id, name, credit").eq("active", true),
    ]);
    setProjects((p.data as Project[]) ?? []);
    setRules((r.data as Rule[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const canEditCreate = hasRole("admin") || hasRole("teacher");
  const canEditProject = (p: Project) => hasRole("admin") || p.created_by === user?.id;

  const openCreate = () => {
    setForm({ name: "", description: "", rule_ids: [], ends_at: "", active: true });
    setOpen(true);
  };

  const create = async () => {
    if (!form.name.trim()) return toast({ title: "项目名称必填", variant: "destructive" });
    const { error } = await supabase.from("projects").insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      rule_ids: form.rule_ids,
      ends_at: form.ends_at || null,
      active: form.active,
      created_by: user!.id,
    });
    if (error) return toast({ title: "创建失败", description: error.message, variant: "destructive" });
    toast({ title: "已创建" }); setOpen(false); load();
  };

  const openCollab = async (p: Project) => {
    setSelectedProject(p);
    const [t, c] = await Promise.all([
      supabase.from("user_roles").select("user_id, profiles!inner(full_name, email)").eq("role", "teacher"),
      supabase.from("project_collaborators").select("user_id").eq("project_id", p.id),
    ]);
    const list: Profile[] = ((t.data as any[]) ?? []).map((row) => ({
      user_id: row.user_id,
      full_name: row.profiles?.full_name ?? null,
      email: row.profiles?.email ?? null,
    }));
    setTeachers(list);
    setCollabIds(((c.data as any[]) ?? []).map((x) => x.user_id));
    setCollabOpen(true);
  };

  const saveCollab = async () => {
    if (!selectedProject) return;
    await supabase.from("project_collaborators").delete().eq("project_id", selectedProject.id);
    if (collabIds.length) {
      const { error } = await supabase
        .from("project_collaborators")
        .insert(collabIds.map((uid) => ({ project_id: selectedProject.id, user_id: uid })));
      if (error) return toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
    toast({ title: "协作教师已更新" });
    setCollabOpen(false);
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">项目管理</h1>
            <p className="text-sm text-muted-foreground">学分认证项目，学生从中提交申请</p>
          </div>
          {canEditCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />新建项目</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>新建项目</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>项目名称</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div><Label>说明</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                  <div><Label>截止时间（可选）</Label><Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></div>
                  <div>
                    <Label>可申请的规则</Label>
                    <ScrollArea className="h-40 rounded border p-2">
                      <div className="space-y-2">
                        {rules.map((r) => (
                          <label key={r.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={form.rule_ids.includes(r.id)}
                              onCheckedChange={(v) => setForm({
                                ...form,
                                rule_ids: v ? [...form.rule_ids, r.id] : form.rule_ids.filter((x) => x !== r.id),
                              })}
                            />
                            <span>{r.name}</span>
                            <Badge variant="secondary">{r.credit} 学分</Badge>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                    <Label>立即开放申请</Label>
                  </div>
                </div>
                <DialogFooter><Button onClick={create}>创建</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>
                      {p.active ? <Badge>开放中</Badge> : <Badge variant="outline">已关闭</Badge>}
                      {p.ends_at && <span className="ml-2 text-xs">截止 {new Date(p.ends_at).toLocaleDateString()}</span>}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {p.rule_ids.slice(0, 4).map((rid) => {
                    const r = rules.find((x) => x.id === rid);
                    return r ? <Badge key={rid} variant="secondary">{r.name}</Badge> : null;
                  })}
                  {p.rule_ids.length > 4 && <span className="text-xs text-muted-foreground">+{p.rule_ids.length - 4}</span>}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {hasRole("student") && p.active && (
                    <Button size="sm" onClick={() => navigate(`/projects/${p.id}/apply`)}>
                      <Send className="mr-1 h-4 w-4" /> 提交申请
                    </Button>
                  )}
                  {(hasRole("admin") || hasRole("teacher")) && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/reviews?project=${p.id}`)}>
                      查看申请
                    </Button>
                  )}
                  {canEditProject(p) && (
                    <Button size="sm" variant="outline" onClick={() => openCollab(p)}>
                      <Users className="mr-1 h-4 w-4" /> 协作教师
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {projects.length === 0 && (
            <p className="col-span-full text-center text-sm text-muted-foreground">暂无项目</p>
          )}
        </div>
      </div>

      <Dialog open={collabOpen} onOpenChange={setCollabOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>配置协作教师 · {selectedProject?.name}</DialogTitle></DialogHeader>
          <ScrollArea className="h-72 rounded border p-2">
            <div className="space-y-2">
              {teachers.map((t) => (
                <label key={t.user_id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={collabIds.includes(t.user_id)}
                    onCheckedChange={(v) => setCollabIds(v ? [...collabIds, t.user_id] : collabIds.filter((x) => x !== t.user_id))}
                  />
                  <span>{t.full_name ?? "—"} <span className="text-muted-foreground">{t.email}</span></span>
                </label>
              ))}
              {teachers.length === 0 && <p className="text-sm text-muted-foreground">尚无教师账号</p>}
            </div>
          </ScrollArea>
          <DialogFooter><Button onClick={saveCollab}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default ProjectsPage;
