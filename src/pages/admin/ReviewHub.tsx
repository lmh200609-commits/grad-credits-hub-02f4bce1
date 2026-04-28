import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, Clock, ShieldCheck, ShieldX, Sparkles, ArrowRight,
} from "lucide-react";

type Counts = Record<string, number>;
type SubCounts = { ai_uncertain: number; student_appeal: number };

const CARDS = [
  { key: "pending_ai", label: "系统核验中", desc: "刚提交，系统正在自动核验", icon: CheckCircle2, color: "text-muted-foreground bg-muted" },
  { key: "auto_approved", label: "系统初审通过", desc: "系统已通过，待教师复核", icon: Sparkles, color: "text-success bg-success/15" },
  { key: "rejected_by_ai", label: "系统未通过", desc: "系统判定材料有问题", icon: XCircle, color: "text-danger bg-danger/15" },
  { key: "pending_review", label: "待教师复核", desc: "系统不确定，等待人工判定", icon: Clock, color: "text-warning bg-warning/15" },
  { key: "approved", label: "人工已通过", desc: "教师 / 管理员审核通过", icon: ShieldCheck, color: "text-success bg-success/20" },
  { key: "rejected", label: "人工已驳回", desc: "教师 / 管理员驳回", icon: ShieldX, color: "text-danger bg-danger/20" },
];

const ReviewHub = () => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Counts>({});
  const [pendingBreakdown, setPendingBreakdown] = useState<SubCounts>({ ai_uncertain: 0, student_appeal: 0 });

  const load = useCallback(async () => {
    const statuses = ["pending_ai", "auto_approved", "pending_review", "rejected_by_ai", "approved", "rejected"] as const;
    const results = await Promise.all(
      statuses.map((s) =>
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", s),
      ),
    );
    const c: Counts = {};
    statuses.forEach((s, i) => { c[s] = results[i].count ?? 0; });
    setCounts(c);

    const [ai, appeal] = await Promise.all([
      supabase.from("applications").select("id", { count: "exact", head: true })
        .eq("status", "pending_review").eq("review_source", "ai_uncertain"),
      supabase.from("applications").select("id", { count: "exact", head: true })
        .eq("status", "pending_review").eq("review_source", "student_appeal"),
    ]);
    setPendingBreakdown({
      ai_uncertain: ai.count ?? 0,
      student_appeal: appeal.count ?? 0,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtimeTable("applications", load);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="复核中心"
          description="点击卡片进入对应状态的申请列表，可推翻教师决定"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate("/reviews?status=pending_review")}>
              <Clock className="mr-2 h-4 w-4" /> 待复核
            </Button>
          }
        />

        <Card className="border-primary/30 bg-primary/5 shadow-card">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">
              提示：右下角的「工作助手」可用自然语言一键跳转，例如说「打开待复核」或「查看不合格学生」。
            </span>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.key} to={`/reviews?status=${c.key}`}>
                <Card className="group h-full shadow-card transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-cardHover">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className={`rounded-lg p-3 ${c.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between">
                        <div className="font-medium">{c.label}</div>
                        <div className="text-2xl font-bold tracking-tight">{counts[c.key] ?? 0}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{c.desc}</div>
                      {c.key === "pending_review" && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span><span className="text-warning font-medium">AI 转人工</span> {pendingBreakdown.ai_uncertain}</span>
                          <span><span className="text-orange-600 font-medium">学生申诉</span> {pendingBreakdown.student_appeal}</span>
                        </div>
                      )}
                      <div className="mt-2 inline-flex items-center text-[11px] text-primary opacity-0 transition group-hover:opacity-100">
                        查看 <ArrowRight className="ml-0.5 h-3 w-3" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
};

export default ReviewHub;
