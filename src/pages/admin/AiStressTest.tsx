import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Play, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import EmptyState from "@/components/EmptyState";

type Recommendation = "approve" | "review" | "reject";

type Actual = {
  consistency_ok: boolean;
  relevance_ok: boolean;
  authenticity_ok: boolean;
  name_match_ok: boolean | null;
  detected_project: string | null;
  detected_achievement: string | null;
  detected_level: string | null;
  detected_identity: string | null;
  confidence: number;
  recommendation: Recommendation;
  reasoning: string;
};

type CaseMeta = {
  id: string; title: string; description: string;
  selected_keywords: string[]; student_name: string;
  simulated_image_content: string; notes: string; expected: Recommendation;
};

type Row = {
  id: string; title: string; notes: string;
  expected: Recommendation;
  expected_consistency_ok: boolean | null;
  expected_relevance_ok: boolean | null;
  expected_authenticity_ok: boolean | null;
  expected_name_match_ok: boolean | null;
  ok: boolean; pass: boolean; error: string | null;
  duration_ms: number; actual: Actual | null;
};

type Report = {
  total: number; pass: number; fail: number; total_duration_ms: number;
  results: Row[]; cases_meta: CaseMeta[];
};

const recBadge = (r: Recommendation) => {
  const map: Record<Recommendation, { label: string; cls: string }> = {
    approve: { label: "通过", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-300" },
    review: { label: "人工", cls: "bg-amber-500/15 text-amber-700 border-amber-300" },
    reject: { label: "驳回", cls: "bg-rose-500/15 text-rose-700 border-rose-300" },
  };
  return <Badge variant="outline" className={map[r].cls}>{map[r].label}</Badge>;
};

const boolBadge = (v: boolean | null | undefined, expected?: boolean | null) => {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  const mismatch = expected !== undefined && expected !== null && expected !== v;
  return (
    <span className={`inline-flex items-center gap-1 ${mismatch ? "text-destructive font-medium" : v ? "text-emerald-700" : "text-rose-700"}`}>
      {v ? "✓" : "✗"}
    </span>
  );
};

const AiStressTestPage = () => {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  const run = async () => {
    setRunning(true);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-eval-stress-test", { body: {} });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setReport(data as Report);
      const r = data as Report;
      toast({ title: "压测完成", description: `通过 ${r.pass}/${r.total}，用时 ${(r.total_duration_ms / 1000).toFixed(1)}s` });
    } catch (e) {
      toast({ title: "压测失败", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title="AI 初审压测"
          description="用 10 个固定文本用例（无图片）批量调用 Qwen 模型，对比期望与实际，回归 AI 初审准确度"
          actions={
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              {running ? "跑测中…" : "一键跑全部用例"}
            </Button>
          }
        />

        {report && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                总览
                <Badge variant={report.fail === 0 ? "default" : "destructive"}>
                  {report.pass}/{report.total} 通过
                </Badge>
                <span className="text-xs font-normal text-muted-foreground">
                  用时 {(report.total_duration_ms / 1000).toFixed(1)}s
                </span>
              </CardTitle>
              <CardDescription>
                "通过"指 AI 给出的 recommendation 与该用例期望值一致。详细 detected 字段差异见下表。
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!report && !running && (
          <Card><CardContent className="pt-6">
            <EmptyState title="尚未跑过压测" description="点击右上角「一键跑全部用例」启动" />
          </CardContent></Card>
        )}

        {running && (
          <Card><CardContent className="pt-6 flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> 正在调用模型，10 个用例约 30~90s…
          </CardContent></Card>
        )}

        {report?.results.map((r) => {
          const meta = report.cases_meta.find((c) => c.id === r.id)!;
          return (
            <Card key={r.id} className={!r.pass ? "border-destructive/50" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">{r.id}</span>
                  <span>{r.title}</span>
                  {r.pass ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-300">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> PASS
                    </Badge>
                  ) : r.ok ? (
                    <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> FAIL</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      <AlertTriangle className="mr-1 h-3 w-3" /> 调用失败
                    </Badge>
                  )}
                  <span className="text-xs font-normal text-muted-foreground ml-auto">{r.duration_ms} ms</span>
                </CardTitle>
                <CardDescription className="text-xs">{r.notes}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded border bg-muted/30 p-2 space-y-1">
                    <div className="text-xs text-muted-foreground">输入</div>
                    <div><span className="text-muted-foreground">学生：</span>{meta.student_name}</div>
                    <div><span className="text-muted-foreground">关键词：</span>{meta.selected_keywords.join(" / ")}</div>
                    <div><span className="text-muted-foreground">说明：</span>{meta.description}</div>
                    <div><span className="text-muted-foreground">模拟图片内容：</span>{meta.simulated_image_content}</div>
                  </div>
                  <div className="rounded border bg-muted/30 p-2 space-y-1">
                    <div className="text-xs text-muted-foreground">期望</div>
                    <div className="flex items-center gap-2">推荐：{recBadge(r.expected)}</div>
                    <div>一致性：{boolBadge(r.expected_consistency_ok)}　相关性：{boolBadge(r.expected_relevance_ok)}　真实性：{boolBadge(r.expected_authenticity_ok)}　姓名：{boolBadge(r.expected_name_match_ok)}</div>
                  </div>
                </div>

                {r.error && <div className="text-destructive text-xs">错误：{r.error}</div>}

                {r.actual && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">实际</div>
                        <div className="flex items-center gap-2">
                          推荐：{recBadge(r.actual.recommendation)}
                          <span className="text-xs text-muted-foreground">置信度 {(r.actual.confidence * 100).toFixed(0)}%</span>
                          {r.actual.recommendation !== r.expected && (
                            <Badge variant="destructive" className="text-[10px]">与期望不符</Badge>
                          )}
                        </div>
                        <div>
                          一致性：{boolBadge(r.actual.consistency_ok, r.expected_consistency_ok)}　
                          相关性：{boolBadge(r.actual.relevance_ok, r.expected_relevance_ok)}　
                          真实性：{boolBadge(r.actual.authenticity_ok, r.expected_authenticity_ok)}　
                          姓名：{boolBadge(r.actual.name_match_ok, r.expected_name_match_ok)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Detected 字段</div>
                        <div className="text-xs grid grid-cols-2 gap-x-2">
                          <span className="text-muted-foreground">项目：</span><span>{r.actual.detected_project ?? "—"}</span>
                          <span className="text-muted-foreground">成果：</span><span>{r.actual.detected_achievement ?? "—"}</span>
                          <span className="text-muted-foreground">级别：</span><span>{r.actual.detected_level ?? "—"}</span>
                          <span className="text-muted-foreground">身份：</span><span>{r.actual.detected_identity ?? "—"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                      <span className="text-muted-foreground">推理：</span>{r.actual.reasoning}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
};

export default AiStressTestPage;