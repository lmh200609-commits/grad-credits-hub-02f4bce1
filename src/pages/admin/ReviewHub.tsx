import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2, XCircle, Clock, ShieldCheck, ShieldX, Sparkles,
} from "lucide-react";

type Counts = Record<string, number>;

const CARDS = [
  { key: "pending_ai", label: "系统核验中", desc: "刚提交，系统正在自动核验", icon: CheckCircle2, color: "text-slate-700 bg-slate-100 dark:bg-slate-900/40" },
  { key: "auto_approved", label: "系统初审通过", desc: "系统已通过，待教师复核", icon: Sparkles, color: "text-emerald-700 bg-emerald-100 dark:bg-emerald-950/30" },
  { key: "rejected_by_ai", label: "系统未通过", desc: "系统判定材料有问题", icon: XCircle, color: "text-rose-700 bg-rose-100 dark:bg-rose-950/30" },
  { key: "pending_review", label: "待教师复核", desc: "系统不确定，等待人工判定", icon: Clock, color: "text-amber-700 bg-amber-100 dark:bg-amber-950/30" },
  { key: "approved", label: "人工已通过", desc: "教师 / 管理员审核通过", icon: ShieldCheck, color: "text-emerald-800 bg-emerald-200 dark:bg-emerald-950/40" },
  { key: "rejected", label: "人工已驳回", desc: "教师 / 管理员驳回", icon: ShieldX, color: "text-rose-800 bg-rose-200 dark:bg-rose-950/40" },
];

const ReviewHub = () => {
  const [counts, setCounts] = useState<Counts>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("applications").select("status");
      const c: Counts = {};
      (data ?? []).forEach((r) => {
        c[r.status] = (c[r.status] ?? 0) + 1;
      });
      setCounts(c);
    })();
  }, []);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">复核中心</h1>
          <p className="text-sm text-muted-foreground">点击卡片进入对应状态的申请列表，可推翻教师决定</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.key} to={`/reviews?status=${c.key}`}>
                <Card className="transition hover:border-primary hover:shadow-sm">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className={`rounded-lg p-3 ${c.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between">
                        <div className="font-medium">{c.label}</div>
                        <div className="text-2xl font-bold">{counts[c.key] ?? 0}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{c.desc}</div>
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
