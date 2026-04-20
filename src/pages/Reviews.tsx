import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";

type Row = {
  id: string;
  description: string;
  status: any;
  ai_suggested_credit: number | null;
  ai_confidence: number | null;
  final_credit: number | null;
  submitted_at: string;
  student_id: string;
};

type ProfileLite = { user_id: string; full_name: string | null; student_no: string | null };

const FILTERS: Record<string, string[]> = {
  all: [],
  pending_review: ["pending_review"],
  auto_approved: ["auto_approved"],
  rejected_by_ai: ["rejected_by_ai"],
  approved: ["approved"],
  rejected: ["rejected"],
  pending_ai: ["pending_ai"],
  finished: ["approved", "rejected"],
};

const ReviewsList = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const initial = params.get("status") && FILTERS[params.get("status")!] ? params.get("status")! : "all";
  const [tab, setTab] = useState(initial);

  useEffect(() => {
    const s = params.get("status");
    if (s && FILTERS[s] && s !== tab) setTab(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("applications")
      .select("id, description, status, ai_suggested_credit, ai_confidence, final_credit, submitted_at, student_id")
      .order("submitted_at", { ascending: false });
    if (FILTERS[tab].length) q = q.in("status", FILTERS[tab] as any);
    const { data } = await q;
    const list = (data as Row[]) ?? [];
    setRows(list);

    const ids = Array.from(new Set(list.map((r) => r.student_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name, student_no")
        .in("user_id", ids);
      const m = new Map<string, ProfileLite>();
      (profs ?? []).forEach((p) => m.set(p.user_id, p));
      setProfiles(m);
    } else {
      setProfiles(new Map());
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("applications", load);

  const tabLabel = useMemo(() => ({
    all: "全部", pending_review: "待复核", auto_approved: "系统已通过",
    rejected_by_ai: "系统未通过", approved: "已通过", rejected: "已驳回",
    pending_ai: "系统核验中", finished: "已完成",
  } as Record<string, string>), []);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">申请审核</h1>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="pending_ai">系统核验中</TabsTrigger>
            <TabsTrigger value="pending_review">待复核</TabsTrigger>
            <TabsTrigger value="auto_approved">系统已通过</TabsTrigger>
            <TabsTrigger value="rejected_by_ai">系统未通过</TabsTrigger>
            <TabsTrigger value="finished">人工已完成</TabsTrigger>
          </TabsList>
        </Tabs>
        <Card>
          <CardHeader><CardTitle className="text-base">{rows.length} 条记录 · {tabLabel[tab] ?? tab}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>学生</TableHead>
                <TableHead>说明</TableHead>
                <TableHead>建议学分</TableHead>
                <TableHead>置信度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} cols={7} />
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7}><EmptyState title="暂无记录" description="切换筛选标签或等待新申请" /></TableCell></TableRow>
                ) : rows.map((r) => {
                  const p = profiles.get(r.student_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{p?.full_name ?? "—"} <span className="text-xs text-muted-foreground">{p?.student_no}</span></TableCell>
                      <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                      <TableCell>{r.final_credit ?? r.ai_suggested_credit ?? "—"}</TableCell>
                      <TableCell>{r.ai_confidence != null ? `${(Number(r.ai_confidence) * 100).toFixed(0)}%` : "—"}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => navigate(`/applications/${r.id}`)}>查看</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ReviewsList;
