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
import { ArrowLeft, Check, X, FileDown, ImageIcon } from "lucide-react";
import { normalizeKeyword } from "@/lib/keywords";
import { formatDepositDate, EMPTY_PLACEHOLDER } from "@/lib/utils";

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
  ai_reasoning_short: string | null;
  final_credit: number | null;
  final_review_note: string | null;
  submitted_at: string;
};
type Review = {
  id: string; action: string; decision: string; credit: number | null;
  confidence: number | null; note: string | null; created_at: string;
};
type KeywordRef = {
  id: string;
  keyword: string;
  category: string | null;
  source: string | null;
  usage_count: number;
  created_at: string;
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
  const [libraryRefs, setLibraryRefs] = useState<KeywordRef[]>([]);

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

    // 加载关键词库中与本申请相关的条目（学生选择 + 自定义关键词命中），用于复核者确认可靠性
    const allKw = Array.from(new Set([
      ...((a as App).selected_keywords ?? []),
      ...((a as App).custom_keywords ?? []),
    ].map((k) => k.trim()).filter(Boolean)));
    if (allKw.length > 0) {
      const { data: kwData } = await supabase
        .from("keywords")
        .select("id, keyword, category, source, usage_count, created_at")
        .in("keyword", allKw);
      setLibraryRefs((kwData as KeywordRef[]) ?? []);
    } else {
      setLibraryRefs([]);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("applications", load, { filter: id ? `id=eq.${id}` : undefined });
  useRealtimeTable("application_reviews", load, { filter: id ? `application_id=eq.${id}` : undefined });

  const isReviewer = !!app && (hasRole("admin") || hasRole("teacher"));

  // 已发生的人工复核次数（teacher_review / admin_review）
  const manualReviewCount = reviews.filter(
    (r) => r.action === "teacher_review" || r.action === "admin_review",
  ).length;
  // 当 status=pending_review 且已存在 ≥1 次人工复核 → 标注"第 N 次人工复核"
  const isReReview =
    !!app &&
    app.status === "pending_review" &&
    manualReviewCount >= 1;
  const reReviewIndex = manualReviewCount + 1;

  const displayFinalCredit = (s: any, c: number | null) =>
    s === "rejected" || s === "rejected_by_ai" ? 0 : c;

  const studentShortReason =
    app?.ai_reasoning_short?.trim() ||
    (app?.ai_reasoning ? app.ai_reasoning.slice(0, 60) + (app.ai_reasoning.length > 60 ? "…" : "") : "");

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

      // 自定义关键词沉淀到关键词库（已存在则累加使用次数，新词自动入库）
      // 输入端按规范化形式去重（避免「ACM」「acm 」「ＡＣＭ」重复落库）
      const customRaw = (app.custom_keywords ?? [])
        .map((k) => k.trim())
        .filter((k) => k && k.length <= 64);
      const seenNorm = new Set<string>();
      const customKws: string[] = [];
      for (const k of customRaw) {
        const n = normalizeKeyword(k);
        if (!n || seenNorm.has(n)) continue;
        seenNorm.add(n);
        customKws.push(k);
      }
      if (customKws.length > 0) {
        // 拉取库内全部关键词，按规范化形式比对（DB 唯一约束基于原文，无法覆盖大小写/空格差异）
        const { data: allLib } = await supabase
          .from("keywords")
          .select("id, keyword, usage_count");
        const libByNorm = new Map<string, { id: string; keyword: string; usage_count: number }>();
        for (const r of (allLib ?? []) as any[]) {
          libByNorm.set(normalizeKeyword(r.keyword), r);
        }
        const toInsert: Array<{
          keyword: string;
          category: string;
          source: string;
          usage_count: number;
          created_by: string;
        }> = [];
        const toBump: typeof libByNorm extends Map<string, infer V> ? V[] : never = [] as any;
        for (const k of customKws) {
          const hit = libByNorm.get(normalizeKeyword(k));
          if (hit) {
            toBump.push(hit);
          } else {
            toInsert.push({
              keyword: k,
              category: "学生申请沉淀",
              source: `人工复核通过 · ${new Date().toISOString().slice(0, 10)}`,
              usage_count: 1,
              created_by: user!.id,
            });
          }
        }
        if (toInsert.length > 0) {
          await supabase.from("keywords").upsert(toInsert, {
            onConflict: "keyword",
            ignoreDuplicates: true,
          });
        }
        await Promise.all(
          toBump.map((k) =>
            supabase
              .from("keywords")
              .update({ usage_count: (k.usage_count ?? 0) + 1 })
              .eq("id", k.id),
          ),
        );
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
          <StatusBadge status={app.status} audience={isReviewer ? "staff" : "student"} />
          {isReviewer && isReReview && (
            <Badge variant="destructive" className="ml-1">
              ⚠ 第 {reReviewIndex} 次人工复核（学生再次申诉）
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
            {matchedRule && isReviewer && <CardDescription>匹配规则：{matchedRule.name}</CardDescription>}
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
            {app.custom_keywords && app.custom_keywords.length > 0 && (
              <div>
                <div className="mb-1 text-muted-foreground">学生自定义关键词</div>
                <div className="flex flex-wrap gap-1">
                  {app.custom_keywords.map((k) => <Badge key={k} variant="outline">{k}</Badge>)}
                </div>
              </div>
            )}
            {app.file_path && (
              <div className="space-y-2">
                <div className="text-muted-foreground flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" /> 提交材料
                  <span className="text-xs break-all">（{app.file_path.split("/").pop()}）</span>
                </div>
                {fileUrl ? (
                  /\.(jpe?g|png|webp|gif)$/i.test(app.file_path) ? (
                    <a href={fileUrl} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={fileUrl}
                        alt="学生提交的材料"
                        className="max-h-96 w-auto rounded border bg-muted/30 object-contain"
                      />
                    </a>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <a href={fileUrl} target="_blank" rel="noreferrer"><FileDown className="mr-1 h-4 w-4" /> 查看附件</a>
                    </Button>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">附件加载中或无访问权限…</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 学生视角：系统未通过简短结论 + 申请人工复核 */}
        {!isReviewer &&
          (app.status === "rejected_by_ai" ||
            (app.status === "pending_review" && manualReviewCount === 0)) && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-base text-destructive">系统未通过</CardTitle>
              <CardDescription>
                {app.status === "pending_review"
                  ? "你已申请人工复核，正在等待教师处理"
                  : "若你认为材料没有问题，可申请教师人工复核"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="rounded bg-destructive/10 p-3 text-sm">
                {studentShortReason || "材料未通过系统核验。"}
              </p>
              <Button
                onClick={requestManualReview}
                variant="outline"
                disabled={app.status === "pending_review"}
                title={app.status === "pending_review" ? "本轮人工复核已提交，请等待教师处理" : undefined}
              >
                {app.status === "pending_review" ? "已提交人工复核，等待教师处理" : "申请人工复核"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* 学生视角：教师已复核且学生仍有异议时申请二次复核 */}
        {!isReviewer &&
          (app.status === "approved" ||
            app.status === "rejected" ||
            (app.status === "pending_review" && manualReviewCount >= 1)) &&
          manualReviewCount >= 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">仍有异议？</CardTitle>
              <CardDescription>
                {app.status === "pending_review"
                  ? `你已申请第 ${reReviewIndex} 次人工复核，正在等待教师处理`
                  : "你可以申请二次人工复核，教师将再次审阅"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={requestManualReview}
                variant="outline"
                disabled={app.status === "pending_review"}
                title={app.status === "pending_review" ? "本轮人工复核已提交，请等待教师处理" : undefined}
              >
                {app.status === "pending_review"
                  ? "已提交人工复核，等待教师处理"
                  : "申请二次人工复核"}
              </Button>
            </CardContent>
          </Card>
        )}

        {isReviewer && libraryRefs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">关键词库推荐</CardTitle>
              <CardDescription>
                本申请的关键词在关键词库中的沉淀来源与日期，便于确认可靠性
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 text-left font-normal">关键词</th>
                      <th className="py-2 pr-3 text-left font-normal">分类</th>
                      <th className="py-2 pr-3 text-left font-normal">来源</th>
                      <th className="py-2 pr-3 text-left font-normal whitespace-nowrap">沉淀日期</th>
                      <th className="py-2 pr-3 text-left font-normal">使用次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryRefs.map((k) => (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{k.keyword}</td>
                        <td className="py-2 pr-3">
                          {k.category ? <Badge variant="secondary">{k.category}</Badge> : <span className="text-muted-foreground">{EMPTY_PLACEHOLDER}</span>}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{k.source ?? EMPTY_PLACEHOLDER}</td>
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {formatDepositDate(k.created_at)}
                        </td>
                        <td className="py-2 pr-3">{k.usage_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {isReviewer && (
          app.ai_reasoning ||
          app.ai_suggested_credit != null ||
          app.ai_matched_rule_id ||
          app.ai_confidence != null ||
          app.status === "rejected_by_ai" ||
          app.status === "auto_approved"
        ) && (
          <Card className={app.status === "rejected_by_ai" ? "border-destructive" : ""}>
            <CardHeader>
              <CardTitle className="text-base">系统核验结果</CardTitle>
              <CardDescription>
                建议匹配规则：{matchedRule?.name ?? "未匹配"} · 建议学分：{app.ai_suggested_credit ?? "—"} · 置信度 {app.ai_confidence != null ? `${(Number(app.ai_confidence) * 100).toFixed(0)}%` : "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-1 text-xs font-medium text-muted-foreground">详细理由</div>
              <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm leading-relaxed">
                {app.ai_reasoning || "系统未给出详细理由。"}
              </p>
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
            {(isReviewer ? reviews : reviews.filter((r) => r.action !== "ai_evaluation")).map((r) => (
              <div key={r.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {r.action === "ai_evaluation"
                        ? "系统核验"
                        : isReviewer
                          ? (r.action === "teacher_review" ? "教师复核" : "管理员复核")
                          : "教师复核"}
                    </Badge>
                    <StatusBadge status={r.decision as any} audience={isReviewer ? "staff" : "student"} />
                    {(r.credit != null || r.decision === "rejected" || r.decision === "rejected_by_ai") && (
                      <span className="text-muted-foreground">
                        学分 {r.decision === "rejected" || r.decision === "rejected_by_ai" ? 0 : r.credit}
                      </span>
                    )}
                    {isReviewer && r.confidence != null && (
                      <span className="text-muted-foreground">置信度 {(Number(r.confidence) * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{r.note}</p>}
              </div>
            ))}
            {(isReviewer ? reviews : reviews.filter((r) => r.action !== "ai_evaluation")).length === 0 && (
              <p className="text-sm text-muted-foreground">暂无审核记录</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ApplicationDetail;
