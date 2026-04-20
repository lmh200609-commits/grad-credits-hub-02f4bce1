import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";

type Row = {
  id: string;
  description: string;
  status: any;
  ai_suggested_credit: number | null;
  ai_confidence: number | null;
  submitted_at: string;
  projects: { name: string } | null;
  profiles: { full_name: string | null; student_no: string | null } | null;
};

const FILTERS: Record<string, string[]> = {
  all: [],
  pending_review: ["pending_review"],
  auto_approved: ["auto_approved"],
  rejected_by_ai: ["rejected_by_ai"],
  finished: ["approved", "rejected"],
};

const ReviewsList = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState("pending_review");
  const projectFilter = params.get("project");

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("applications")
        .select("id, description, status, ai_suggested_credit, ai_confidence, submitted_at, projects(name), profiles!applications_student_id_fkey(full_name, student_no)")
        .order("submitted_at", { ascending: false });
      if (FILTERS[tab].length) q = q.in("status", FILTERS[tab] as any);
      if (projectFilter) q = q.eq("project_id", projectFilter);
      const { data } = await q;
      setRows((data as any[]) ?? []);
    })();
  }, [tab, projectFilter]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">申请审核</h1>
          {projectFilter && (
            <Button variant="outline" size="sm" onClick={() => setParams({})}>清除项目筛选</Button>
          )}
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending_review">待复核</TabsTrigger>
            <TabsTrigger value="auto_approved">AI 已通过</TabsTrigger>
            <TabsTrigger value="rejected_by_ai">AI 不通过</TabsTrigger>
            <TabsTrigger value="finished">已完成</TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>
        </Tabs>
        <Card>
          <CardHeader><CardTitle className="text-base">{rows.length} 条记录</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>学生</TableHead><TableHead>项目</TableHead>
                <TableHead>说明</TableHead><TableHead>AI 学分</TableHead>
                <TableHead>置信度</TableHead><TableHead>状态</TableHead>
                <TableHead>提交时间</TableHead><TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.profiles?.full_name ?? "—"} <span className="text-xs text-muted-foreground">{r.profiles?.student_no}</span></TableCell>
                    <TableCell>{r.projects?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                    <TableCell>{r.ai_suggested_credit ?? "—"}</TableCell>
                    <TableCell>{r.ai_confidence != null ? `${(Number(r.ai_confidence) * 100).toFixed(0)}%` : "—"}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-xs">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => navigate(`/applications/${r.id}`)}>复核</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">暂无记录</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ReviewsList;
