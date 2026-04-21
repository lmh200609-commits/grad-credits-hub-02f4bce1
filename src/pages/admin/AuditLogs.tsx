import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";
import TablePagination from "@/components/TablePagination";
import { fetchAll } from "@/lib/fetchAll";

const PAGE_SIZE = 30;

type AuditLog = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  target_ids: string[];
  target_labels: string[];
  affected_count: number;
  success_count: number;
  failure_count: number;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ACTION_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  import_users: { label: "批量导入", variant: "default" },
  delete_user: { label: "删除用户", variant: "destructive" },
  role_change: { label: "角色变更", variant: "secondary" },
  rule_create: { label: "规则新增", variant: "default" },
  rule_update: { label: "规则更新", variant: "secondary" },
  rule_delete: { label: "规则删除", variant: "destructive" },
};

const ACTION_OPTIONS = ["all", ...Object.keys(ACTION_LABEL)];

const fmtTime = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString("zh-CN", { hour12: false });
};

const AuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [actorSearch, setActorSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchAll<AuditLog>(
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }),
    );
    setLogs(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (actorSearch.trim() && !(l.actor_email ?? "").toLowerCase().includes(actorSearch.trim().toLowerCase())) return false;
      if (from && new Date(l.created_at) < new Date(from)) return false;
      if (to && new Date(l.created_at) > new Date(`${to}T23:59:59`)) return false;
      return true;
    });
  }, [logs, actionFilter, actorSearch, from, to]);

  useEffect(() => { setPage(0); }, [actionFilter, actorSearch, from, to]);
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader title="审计日志" description="追踪批量导入、删除、角色变更与规则操作" />

        <Card>
          <CardHeader><CardTitle className="text-base">筛选</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger><SelectValue placeholder="操作类型" /></SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a === "all" ? "全部操作" : ACTION_LABEL[a]?.label ?? a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="操作者邮箱" value={actorSearch} onChange={(e) => setActorSearch(e.target.value)} />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <div className="md:col-span-4 text-sm text-muted-foreground">
              共 {filtered.length} / {logs.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>操作者</TableHead>
                  <TableHead className="text-right">影响</TableHead>
                  <TableHead className="text-right">成功 / 失败</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead className="text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={6} cols={7} />
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7}><EmptyState title="暂无日志" description="完成一次批量操作后将在此处显示" /></TableCell></TableRow>
                ) : paged.map((l) => {
                  const meta = ACTION_LABEL[l.action] ?? { label: l.action, variant: "outline" as const };
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtTime(l.created_at)}</TableCell>
                      <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-sm">{l.actor_email ?? "—"}</TableCell>
                      <TableCell className="text-right">{l.affected_count}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className="text-success">{l.success_count}</span>
                        {" / "}
                        <span className={l.failure_count > 0 ? "text-destructive" : "text-muted-foreground"}>{l.failure_count}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(2)}s` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setDetail(l)}>查看</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!loading && filtered.length > PAGE_SIZE && (
              <TablePagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail && (ACTION_LABEL[detail.action]?.label ?? detail.action)} · {detail && fmtTime(detail.created_at)}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">操作者：</span>{detail.actor_email ?? "—"}</div>
                <div>
                  <span className="text-muted-foreground">影响：</span>
                  共 {detail.affected_count} 条，成功 {detail.success_count}，失败 {detail.failure_count}
                  {detail.duration_ms != null && `，耗时 ${(detail.duration_ms / 1000).toFixed(2)}s`}
                </div>
                {detail.target_labels.length > 0 && (
                  <div>
                    <div className="mb-1 text-muted-foreground">受影响标识（{detail.target_labels.length}）：</div>
                    <div className="flex max-h-40 flex-wrap gap-1 overflow-auto rounded-md border bg-muted/30 p-2">
                      {detail.target_labels.map((t, i) => (
                        <Badge key={i} variant="outline" className="font-mono text-xs">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1 text-muted-foreground">元数据：</div>
                  <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default AuditLogs;