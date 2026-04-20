import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Send, Sparkles } from "lucide-react";

type Project = { id: string; name: string; description: string | null; rule_ids: string[] };
type Rule = { id: string; name: string; keywords: string[]; credit: number; description: string | null };

const ApplyPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
      if (!p) return;
      setProject(p as Project);
      const { data: rs } = await supabase.from("rules").select("*").in("id", (p as Project).rule_ids);
      setRules((rs as Rule[]) ?? []);
    })();
  }, [id]);

  const allKeywords = Array.from(new Set(rules.flatMap((r) => r.keywords)));

  const submit = async () => {
    if (!description.trim() || description.trim().length < 10) {
      return toast({ title: "请填写至少 10 字的申请说明", variant: "destructive" });
    }
    setSubmitting(true);
    try {
      let filePath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `${user!.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("application-files")
          .upload(filePath, file, { contentType: file.type });
        if (upErr) throw upErr;
      }

      const { data: app, error } = await supabase
        .from("applications")
        .insert({
          project_id: id,
          student_id: user!.id,
          description: description.trim(),
          selected_keywords: keywords,
          file_path: filePath,
        })
        .select()
        .single();
      if (error) throw error;

      // Trigger AI evaluation (non-blocking; show toast on result)
      toast({ title: "已提交，AI 正在评估…" });
      const { data: aiRes, error: aiErr } = await supabase.functions.invoke("evaluate-application", {
        body: { application_id: (app as any).id },
      });
      if (aiErr) {
        toast({ title: "AI 评估失败，已转人工复核", description: aiErr.message, variant: "destructive" });
      } else if (aiRes?.status) {
        toast({ title: "AI 评估完成", description: `结果：${aiRes.status}` });
      }
      navigate("/my-applications");
    } catch (e: any) {
      toast({ title: "提交失败", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!project) return <AppLayout><p className="text-muted-foreground">加载中…</p></AppLayout>;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold">申请：{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.description}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> 选择关联关键词（可选）
            </CardTitle>
            <CardDescription>从规则库中挑选最贴合你材料的关键词，帮助 AI 更准确地匹配</CardDescription>
          </CardHeader>
          <CardContent>
            {allKeywords.length === 0 ? (
              <p className="text-sm text-muted-foreground">该项目暂无可选关键词</p>
            ) : (
              <ScrollArea className="max-h-40">
                <div className="flex flex-wrap gap-2">
                  {allKeywords.map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={keywords.includes(k)}
                        onCheckedChange={(v) => setKeywords(v ? [...keywords, k] : keywords.filter((x) => x !== k))}
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">申请说明</CardTitle>
            <CardDescription>请详细描述你的活动/成果，便于 AI 与教师判断</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="例如：参加 2024 年 ACM 区域赛获铜牌，参赛队员 3 人，比赛时长 5 小时…"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">证明材料（PDF / 图片，可选）</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {file && <p className="mt-2 text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>取消</Button>
          <Button onClick={submit} disabled={submitting}>
            <Send className="mr-1 h-4 w-4" /> {submitting ? "提交中…" : "提交申请"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default ApplyPage;
