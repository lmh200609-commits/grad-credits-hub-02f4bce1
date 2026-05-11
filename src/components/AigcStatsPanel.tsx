import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useSerializedReload } from "@/hooks/useSerializedReload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileText, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type Row = {
  id: string;
  aigc_status: "pending" | "real" | "suspect" | "fake" | "skipped" | "error";
  aigc_score: number | null;
  submitted_at: string;
  college_id: string | null;
  description: string | null;
  student_id?: string | null;
};

type ProfileLite = { user_id: string; full_name: string | null; student_no: string | null };

const STATUS_LABELS: Record<Row["aigc_status"], string> = {
  fake: "高风险",
  suspect: "嫌疑",
  real: "通过",
  pending: "待检测",
  skipped: "跳过",
  error: "失败",
};

const STATUS_COLOR: Record<Row["aigc_status"], string> = {
  fake: "hsl(var(--destructive))",
  suspect: "hsl(var(--warning))",
  real: "hsl(var(--success))",
  pending: "hsl(var(--muted-foreground))",
  skipped: "hsl(var(--muted-foreground) / 0.6)",
  error: "hsl(var(--info))",
};

const ALL_STATUSES: Row["aigc_status"][] = ["fake", "suspect", "real", "pending", "skipped", "error"];

const RANGES: { v: string; label: string; days: number | null }[] = [
  { v: "7", label: "近 7 天", days: 7 },
  { v: "14", label: "近 14 天", days: 14 },
  { v: "30", label: "近 30 天", days: 30 },
  { v: "90", label: "近 90 天", days: 90 },
  { v: "all", label: "全部", days: null },
];

function fmtDate(d: Date) {
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AigcStatsPanel() {
  const { collegeId, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<string>("14");
  const [statuses, setStatuses] = useState<Row["aigc_status"][]>([...ALL_STATUSES]);
  const [collegeFilter, setCollegeFilter] = useState<string>("all"); // 仅超管
  const [colleges, setColleges] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [dayFocus, setDayFocus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // 学院列表（仅超管）
  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      const { data } = await supabase.from("colleges").select("id, name").eq("active", true).order("name");
      setColleges((data ?? []) as any);
    })();
  }, [isSuperAdmin]);

  const sinceIso = useMemo(() => {
    const r = RANGES.find((x) => x.v === range);
    if (!r?.days) return null;
    const d = new Date();
    d.setDate(d.getDate() - r.days);
    return d.toISOString();
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("applications")
      .select("id, aigc_status, aigc_score, submitted_at, college_id, description, student_id")
      .order("submitted_at", { ascending: false })
      .limit(2000);
    if (sinceIso) q = q.gte("submitted_at", sinceIso);
    if (isSuperAdmin && collegeFilter !== "all") q = q.eq("college_id", collegeFilter);
    const { data, error } = await q;
    if (error) {
      toast({ title: "加载 AI 鉴别数据失败", description: error.message, variant: "destructive" });
    } else {
      const list = (data ?? []) as Row[];
      setRows(list);
      const ids = Array.from(new Set(list.map((r) => r.student_id).filter(Boolean) as string[]));
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles").select("user_id, full_name, student_no").in("user_id", ids);
        const m = new Map<string, ProfileLite>();
        (ps ?? []).forEach((p: any) => m.set(p.user_id, p));
        setProfiles(m);
      } else {
        setProfiles(new Map());
      }
    }
    setLoading(false);
  }, [sinceIso, isSuperAdmin, collegeFilter]);

  const reload = useSerializedReload(load);
  useEffect(() => { reload(); }, [reload, load]);

  const realtimeFilter = isSuperAdmin
    ? undefined
    : (collegeId ? `college_id=eq.${collegeId}` : null);
  useRealtimeTable("applications", reload, { filter: realtimeFilter });

  // 应用状态筛选
  const filtered = useMemo(
    () => rows.filter((r) => statuses.includes(r.aigc_status)),
    [rows, statuses],
  );

  // KPI
  const kpi = useMemo(() => {
    const checked = filtered.filter((r) => ["real", "suspect", "fake"].includes(r.aigc_status));
    const fake = filtered.filter((r) => r.aigc_status === "fake").length;
    const suspect = filtered.filter((r) => r.aigc_status === "suspect").length;
    const pending = filtered.filter((r) => r.aigc_status === "pending").length;
    const checkedN = checked.length;
    const detected = fake + suspect;
    const detectRate = checkedN ? (detected / checkedN) * 100 : 0;
    const scored = filtered.filter((r) => typeof r.aigc_score === "number");
    const avgScore = scored.length
      ? (scored.reduce((s, r) => s + (r.aigc_score ?? 0), 0) / scored.length) * 100
      : 0;
    return { checked: checkedN, fake, suspect, pending, detectRate, avgScore };
  }, [filtered]);

  // 柱状图：按天聚合 fake / suspect / real
  const barData = useMemo(() => {
    const days = RANGES.find((x) => x.v === range)?.days ?? 30;
    const map = new Map<string, { date: string; fake: number; suspect: number; real: number }>();
    if (RANGES.find((x) => x.v === range)?.days) {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        map.set(fmtDay(d), { date: fmtDate(d), fake: 0, suspect: 0, real: 0 });
      }
    }
    for (const r of filtered) {
      const d = new Date(r.submitted_at);
      const key = fmtDay(d);
      if (!map.has(key)) {
        map.set(key, { date: fmtDate(d), fake: 0, suspect: 0, real: 0 });
      }
      const slot = map.get(key)!;
      if (r.aigc_status === "fake") slot.fake++;
      else if (r.aigc_status === "suspect") slot.suspect++;
      else if (r.aigc_status === "real") slot.real++;
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v]) => v);
  }, [filtered, range]);

  // 饼图：状态分布
  const piePartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) counts[r.aigc_status] = (counts[r.aigc_status] ?? 0) + 1;
    return ALL_STATUSES
      .filter((s) => counts[s])
      .map((s) => ({ name: STATUS_LABELS[s], value: counts[s], status: s }));
  }, [filtered]);

  // Top 20 高风险
  const topRisky = useMemo(() => {
    return filtered
      .filter((r) => r.aigc_status === "fake" || r.aigc_status === "suspect")
      .sort((a, b) => (b.aigc_score ?? 0) - (a.aigc_score ?? 0))
      .slice(0, 20);
  }, [filtered]);

  const scopeLabel = isSuperAdmin
    ? (collegeFilter === "all" ? "全校" : (colleges.find((c) => c.id === collegeFilter)?.name ?? "—"))
    : "本学院";
  const rangeLabel = RANGES.find((x) => x.v === range)?.label ?? "";

  const exportCsv = () => {
    const header = ["申请ID", "提交时间", "AI状态", "AI概率(%)", "申请描述", "学院ID"];
    const lines = filtered.map((r) => [
      r.id,
      new Date(r.submitted_at).toLocaleString(),
      STATUS_LABELS[r.aigc_status],
      typeof r.aigc_score === "number" ? (r.aigc_score * 100).toFixed(1) : "",
      (r.description ?? "").slice(0, 40).replace(/[\r\n]+/g, " "),
      r.college_id ?? "",
    ]);
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = "\uFEFF" + [header, ...lines].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `AIGC统计_${scopeLabel}_${rangeLabel}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExportingPdf(true);
    try {
      // 等一帧让隐藏 DOM 完成布局/图表渲染
      await new Promise((r) => setTimeout(r, 250));
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(dataUrl, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
      let pageNo = 1;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(dataUrl, "JPEG", 0, position, imgW, imgH);
        heightLeft -= pageH;
        pageNo++;
      }
      // 页脚 页码
      const totalPages = pageNo;
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(120);
        pdf.text(`第 ${i} / ${totalPages} 页`, pageW - 25, pageH - 6);
      }
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      pdf.save(`AIGC统计报告_${scopeLabel}_${rangeLabel}_${ts}.pdf`);
    } catch (e: any) {
      toast({ title: "导出 PDF 失败", description: e?.message ?? "未知错误", variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <CardTitle className="text-base">AI 生成材料鉴别</CardTitle>
          <Badge variant="outline" className="text-xs">{filtered.length} 条</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading || filtered.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf} disabled={loading || exportingPdf || filtered.length === 0}>
            {exportingPdf ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
            {exportingPdf ? "生成中…" : "PDF"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 筛选 */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">时间</span>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">状态</span>
            <ToggleGroup
              type="multiple"
              size="sm"
              value={statuses}
              onValueChange={(v) => setStatuses((v as Row["aigc_status"][]).length ? (v as any) : [...ALL_STATUSES])}
              className="flex-wrap"
            >
              {ALL_STATUSES.map((s) => (
                <ToggleGroupItem key={s} value={s} className="h-7 px-2 text-xs">
                  {STATUS_LABELS[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {isSuperAdmin && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">学院</span>
              <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部学院</SelectItem>
                  {colleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label="已检测" value={kpi.checked} />
          <Kpi
            label="高风险"
            value={kpi.fake}
            accent="text-destructive"
            onClick={() => setStatuses(["fake"])}
          />
          <Kpi
            label="嫌疑"
            value={kpi.suspect}
            accent="text-warning"
            onClick={() => setStatuses(["suspect"])}
          />
          <Kpi label="检出率" value={`${kpi.detectRate.toFixed(1)}%`} accent={kpi.detectRate > 5 ? "text-destructive" : "text-foreground"} />
          <Kpi label="平均概率" value={`${kpi.avgScore.toFixed(1)}%`} />
        </div>

        {kpi.pending > 0 && (
          <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              当前范围内有 <span className="font-semibold text-foreground">{kpi.pending}</span> 条待检测申请（多为 AI 文本审驳回或无图片，未跑过图像鉴别）
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatuses(["pending"])}
              disabled={statuses.length === 1 && statuses[0] === "pending"}
            >
              仅看待检测
            </Button>
          </div>
        )}

        {/* 图表 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-[260px]">
            {barData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  onClick={(s: any) => {
                    if (s?.activeLabel) setDayFocus(String(s.activeLabel));
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="real" name="通过" stackId="a" fill={STATUS_COLOR.real} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="suspect" name="嫌疑" stackId="a" fill={STATUS_COLOR.suspect} />
                  <Bar dataKey="fake" name="高风险" stackId="a" fill={STATUS_COLOR.fake} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="h-[260px]">
            {piePartData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={piePartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label
                    onClick={(d: any) => {
                      const s = d?.payload?.status as Row["aigc_status"] | undefined;
                      if (s) setStatuses([s]);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {piePartData.map((d, i) => (
                      <Cell key={i} fill={STATUS_COLOR[d.status as Row["aigc_status"]]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 高风险 / 嫌疑 申请清单 —— 可点击跳转 */}
        <RiskyTable
          rows={topRisky}
          profiles={profiles}
          dayFocus={dayFocus}
          onClearFocus={() => setDayFocus(null)}
          onRowClick={(id) => navigate(`/applications/${id}`)}
        />

        {/* 隐藏的 PDF 报告 DOM —— 截屏专用 */}
        <div className="pointer-events-none fixed -left-[10000px] top-0 -z-10" aria-hidden>
          <div
            ref={reportRef}
            style={{ width: 794, padding: 32, background: "#fff", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}
          >
            <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>AI 生成材料鉴别报告</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
                范围：{scopeLabel} · {rangeLabel} · 状态筛选：{statuses.map((s) => STATUS_LABELS[s]).join(" / ")} · 生成于 {new Date().toLocaleString()}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
              {[
                { l: "已检测", v: kpi.checked, c: "#0f172a" },
                { l: "高风险", v: kpi.fake, c: "#b91c1c" },
                { l: "嫌疑", v: kpi.suspect, c: "#b45309" },
                { l: "检出率", v: `${kpi.detectRate.toFixed(1)}%`, c: kpi.detectRate > 5 ? "#b91c1c" : "#0f172a" },
                { l: "平均概率", v: `${kpi.avgScore.toFixed(1)}%`, c: "#0f172a" },
              ].map((k, i) => (
                <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{k.l}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: k.c, marginTop: 4 }}>{k.v}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>每日鉴别趋势</div>
                <div style={{ width: "100%", height: 220, background: "#fff" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#475569" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#475569" />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="real" name="通过" stackId="a" fill="#10b981" />
                      <Bar dataKey="suspect" name="嫌疑" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="fake" name="高风险" stackId="a" fill="#ef4444" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>状态分布</div>
                <div style={{ width: "100%", height: 220, background: "#fff" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={piePartData} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 10 }}>
                        {piePartData.map((d, i) => {
                          const map: Record<string, string> = {
                            fake: "#ef4444", suspect: "#f59e0b", real: "#10b981",
                            pending: "#94a3b8", skipped: "#cbd5e1", error: "#3b82f6",
                          };
                          return <Cell key={i} fill={map[d.status]} />;
                        })}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Top {topRisky.length} 高风险申请明细
              </div>
              {topRisky.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b" }}>当前范围内无高风险或嫌疑申请。</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={th}>#</th>
                      <th style={th}>提交时间</th>
                      <th style={th}>状态</th>
                      <th style={th}>AI 概率</th>
                      <th style={{ ...th, textAlign: "left" }}>申请描述</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRisky.map((r, i) => (
                      <tr key={r.id}>
                        <td style={td}>{i + 1}</td>
                        <td style={td}>{new Date(r.submitted_at).toLocaleString()}</td>
                        <td style={{ ...td, color: r.aigc_status === "fake" ? "#b91c1c" : "#b45309", fontWeight: 600 }}>
                          {STATUS_LABELS[r.aigc_status]}
                        </td>
                        <td style={td}>{typeof r.aigc_score === "number" ? `${(r.aigc_score * 100).toFixed(1)}%` : "—"}</td>
                        <td style={{ ...td, textAlign: "left" }}>{(r.description ?? "").slice(0, 40)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const th: React.CSSProperties = {
  border: "1px solid #e2e8f0", padding: "4px 6px", textAlign: "center", fontWeight: 600, color: "#334155",
};
const td: React.CSSProperties = {
  border: "1px solid #e2e8f0", padding: "4px 6px", textAlign: "center", color: "#0f172a",
};

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function EmptyChart() {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无数据</div>;
}