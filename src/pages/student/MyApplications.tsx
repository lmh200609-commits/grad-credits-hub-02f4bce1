import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";

type Row = {
  id: string;
  description: string;
  status: any;
  ai_suggested_credit: number | null;
  final_credit: number | null;
  submitted_at: string;
  projects: { name: string } | null;
};

const MyApplications = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("applications")
        .select("id, description, status, ai_suggested_credit, final_credit, submitted_at, projects(name)")
        .eq("student_id", user.id)
        .order("submitted_at", { ascending: false });
      setRows((data as any[]) ?? []);
    })();
  }, [user]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">我的申请</h1>
        <Card>
          <CardHeader><CardTitle className="text-base">共 {rows.length} 条</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>项目</TableHead><TableHead>说明</TableHead>
                <TableHead>状态</TableHead><TableHead>建议学分</TableHead>
                <TableHead>最终学分</TableHead><TableHead>提交时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.projects?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.ai_suggested_credit ?? "—"}</TableCell>
                    <TableCell>{r.final_credit ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/applications/${r.id}`)}>详情</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">暂无申请</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default MyApplications;
