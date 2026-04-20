import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Check, X, FileDown } from "lucide-react";

type App = {
  id: string;
  student_id: string;
  description: string;
  selected_keywords: string[];
  custom_keywords: string[];
  file_path: string | null;
  status: any;
  ai_matched_rule_id: string | null;
  ai_suggested_credit: number | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  final_credit: number | null;
  final_review_note: string | null;
  submitted_at: string;
};
type Review = {
  id: string; action: string; decision: string; credit: number | null;
  confidence: number | null; note: string | null; created_at: string;
};

const ApplicationDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [app, setApp] = useState<App | null>(null);
  const [student, setStudent] = useState<{ full_name: string | null; student_no: string | null; email: string | null } | null>(null);
  const [matchedRule, setMatchedRule] = useState<{ name: string; credit: number } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [credit, setCredit] = useState<number>(0);
  const [note, setNote] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: a } = await supabase.from("applications").select("*").eq("id", id).single();
    if (!a) return;
    setApp(a as App);
    setCredit(Number((a as App).ai_suggested_credit ?? (a as App).final_credit ?? 0));
    const [s, r, rv] = await Promise.all([
      supabase.from("profiles").select("full_name, student_no, email").eq("user_id", (a as App).student_id).single(),
      (a as App).ai_matched_rule_id
        ? supabase.from("rules").select("name, credit").eq("id", (a as App).ai_matched_rule_id).single()
        : Promise.resolve({ data: null }),
      supabase.from("application_reviews").select("*").eq("application_id", id).order("created_at"),
    ]);
    setStudent(s.data as any);
    setMatchedRule(r.data as any);
    setReviews((rv.data as Review[]) ?? []);

    if ((a as App).file_path) {
      const { data: signed } = await supabase.storage
        .from("application-files")
        .createSignedUrl((a as App).file_path!, 3600);
      setFileUrl(signed?.signedUrl ?? null);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("applications", load, { filter: id ? `id=eq.${id}` : undefined });
  useRealtimeTable("application_reviews", load, { filter: id ? `application_id=eq.${id}` : undefined });

  const isReviewer = !!app && (hasRole("admin") || hasRole("teacher"));

  const decide = async (decision: "approved" | "rejected") => {
    if (!app) return;
    if (decision === "approved" && (!credit || credit <= 0)) {
      return toast({ title: "请填写最终学分", variant: "destructive" });
    }
    const action = hasRole("admin") ? "admin_review" : "teacher_review";
    const wasRejectedByAi = app.status === "rejected_by_ai";
    const hasCustom = (app.custom_keywords?.length ?? 0) > 0;

    const { error: re } = await supabase.from("application_reviews").insert({
      application_id: app.id,
      reviewer_id: user!.id,
      action,
      decision,
      credit: decision === "approved" ? credit : null,
      note: note.trim() || null,
    });
    if (re) return toast({ title: "保存失败", description: re.message, variant: "destructive" });

    const { error: ue } = await supabase
      .from("applications")
      .update({
        status: decision,
        final_credit: decision === "approved" ? credit : null,
        final_reviewer_id: user!.id,
        final_review_note: note.trim() || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", app.id);
    if (ue) return toast({ title: "更新失败", description: ue.message, variant: "destructive" });

    // 人工通过时：检查该关键词组合是否已有完全匹配的规则或案例，没有则沉淀到案例库
    if (decision === "approved") {
      const allKw = [...(app.selected_keywords ?? []), ...(app.custom_keywords ?? [])];
      const kwSet = allKw.filter(Boolean).sort().join("|");

      // 检查是否已有规则完全匹配这组关键词
      const { data: existingRules } = await supabase
        .from("rules")
        .select("id, project, achievement, level, identity")
        .eq("active", true);
      const ruleMatch = (existingRules ?? []).some((r) => {
        const dims = [r.project, r.achievement, r.level, r.identity].filter(Boolean).sort().join("|");
        return dims === kwSet;
      });

      // 检查是否已有案例包含完全相同的关键词
      const { data: existingCases } = await supabase
        .from("cases")
        .select("summary")
        .limit(200);
      const caseMatch = (existingCases ?? []).some((c) =>
        allKw.every((kw) => kw && c.summary.includes(kw))
      );

      if (!ruleMatch && !caseMatch) {
        const title = (app.custom_keywords?.[0] ?? allKw[0] ?? app.description).slice(0, 60);
        const summary = `关键词：${allKw.join("、")}\n申请说明：${app.description.slice(0, 300)}`;
        const { error: ce } = await supabase.from("cases").insert({
          title,
          summary,
          rule_id: app.ai_matched_rule_id,
          awarded_credit: credit,
          notes: `人工复核通过沉淀。复核备注：${note.trim() || "（无）"}`,
          created_by: user!.id,
        });
        if (!ce) toast({ title: "已通过", description: "新案例已加入案例库，学生端可搜索使用" });
        else toast({ title: "已通过" });
      } else {
        toast({ title: "已通过" });
      }
    } else {
      toast({ title: "已驳回" });
    }
    load();
  };

  const requestManualReview = async () => {
    if (!app) return;
    const { error } = await supabase
      .from("applications")
      .update({ status: "pending_review" })
      .eq("id", app.id);
    if (error) return toast({ title: "申请失败", description: error.message, variant: "destructive" });
    toast({ title: "已转人工复核", description: "教师将尽快处理" });
    load();
  };

  if (!app) return <AppLayout><p>加载中…</p></AppLayout>;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
          <h1 className="text-2xl font-bold">申请详情</h1>
          <StatusBadge status={app.status} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
            {matchedRule && <CardDescription>匹配规则：{matchedRule.name}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">学生：</span>{student?.full_name} · {student?.student_no} · {student?.email}</div>
            <div><span className="text-muted-foreground">提交时间：</span>{new Date(app.submitted_at).toLocaleString()}</div>
            <Separator />
            <div>
              <div className="mb-1 text-muted-foreground">申请说明</div>
              <p className="whitespace-pre-wrap rounded bg-muted/50 p-3">{app.description}</p>
            </div>
            {app.selected_keywords.length > 0 && (
              <div>
                <div className="mb-1 text-muted-foreground">学生选择的关键词</div>
                <div className="flex flex-wrap gap-1">
                  {app.selected_keywords.map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}
                </div>
              </div>
            )}
            {fileUrl && (
              <div>
                <Button variant="outline" size="sm" asChild>
                  <a href={fileUrl} target="_blank" rel="noreferrer"><FileDown className="mr-1 h-4 w-4" /> 查看附件</a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {app.ai_reasoning && (
          <Card className={app.status === "rejected_by_ai" ? "border-destructive" : ""}>
            <CardHeader>
              <CardTitle className="text-base">系统核验结果</CardTitle>
              <CardDescription>
                {isReviewer ? (
                  <>建议匹配规则：{matchedRule?.name ?? "未匹配"} · 建议学分：{app.ai_suggested_credit ?? "—"} · 置信度 {app.ai_confidence != null ? `${(Number(app.ai_confidence) * 100).toFixed(0)}%` : "—"}</>
                ) : (
                  <>建议匹配规则：{matchedRule?.name ?? "未匹配"}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-1 text-xs font-medium text-muted-foreground">详细理由</div>
              <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm leading-relaxed">{app.ai_reasoning}</p>
              {app.status === "rejected_by_ai" && !isReviewer && app.student_id === user?.id && (
                <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs text-muted-foreground">
                    如果你对系统判定有异议，可申请教师人工复核。教师将根据你的材料和自定义关键词重新评估。
                  </p>
                  <Button size="sm" variant="outline" onClick={requestManualReview} className="self-start">
                    申请人工复核
                  </Button>
                </div>
              )}
              {app.status === "pending_review" && !isReviewer && app.student_id === user?.id && (
                <p className="mt-3 text-xs text-muted-foreground">已转人工复核，请耐心等待教师处理。</p>
              )}
            </CardContent>
          </Card>
        )}

        {isReviewer && app.status !== "pending_ai" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {["approved", "auto_approved"].includes(app.status) || app.status === "rejected" || app.status === "rejected_by_ai"
                  ? "修改审核结果"
                  : "人工复核"}
              </CardTitle>
              <CardDescription>
                {app.status === "auto_approved" && "系统已自动通过并计入学分。如需调整可在此修改。"}
                {app.status === "rejected_by_ai" && "系统已自动驳回。如学生有异议可在此覆盖结果。"}
                {app.status === "approved" && "已通过的申请，可在此调整最终学分或改判驳回。"}
                {app.status === "rejected" && "已驳回的申请，可在此重新通过。"}
                {app.status === "pending_review" && "系统无法自动判定，需要人工复核。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>最终学分（通过时必填）</Label>
                <Input type="number" step="0.5" value={credit} onChange={(e) => setCredit(Number(e.target.value))} />
              </div>
              <div>
                <Label>复核备注</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => decide("approved")}><Check className="mr-1 h-4 w-4" /> 通过</Button>
                <Button variant="destructive" onClick={() => decide("rejected")}><X className="mr-1 h-4 w-4" /> 驳回</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">审核记录</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {r.action === "ai_evaluation" ? "系统核验" : r.action === "teacher_review" ? "教师复核" : "管理员复核"}
                    </Badge>
                    <StatusBadge status={r.decision as any} />
                    {r.credit != null && <span className="text-muted-foreground">学分 {r.credit}</span>}
                    {isReviewer && r.confidence != null && (
                      <span className="text-muted-foreground">置信度 {(Number(r.confidence) * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{r.note}</p>}
              </div>
            ))}
            {reviews.length === 0 && <p className="text-sm text-muted-foreground">暂无审核记录</p>}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ApplicationDetail;
