import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Summary = any;

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const fmtDT = (s?: string | null) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "";

const reportStyles = `
@media print {
  .no-print { display: none !important; }
  .report-page { box-shadow: none !important; margin: 0 !important; max-width: none !important; padding: 18mm 14mm !important; border-radius: 0 !important; }
  body { background: white !important; }
  h2 { page-break-after: avoid; }
  table, .fail-block, .miss-block, .kpi-card { page-break-inside: avoid; }
  thead { display: table-header-group; }
  @page { size: A4; margin: 10mm; }
}
.report-root { background: #f1f5f9; min-height: 100vh; color: #1e293b; font-family: -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif; }
.report-page { max-width: 1040px; margin: 24px auto; background: #fff; padding: 48px 56px; box-shadow: 0 4px 24px rgba(15,23,42,.08); border-radius: 8px; }
.cover { background: linear-gradient(135deg,#1F4E79,#3b6fa0); color: #fff; margin: -48px -56px 32px; padding: 40px 56px; border-radius: 8px 8px 0 0; }
.cover h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 1px; font-weight: 700; }
.cover .sub { opacity: .88; font-size: 14px; margin: 4px 0; }
.section-h { font-size: 18px; margin: 36px 0 16px; padding-left: 12px; border-left: 4px solid #1F4E79; color: #0f172a; font-weight: 600; }
.section-h .hint { font-size: 12px; color: #64748b; font-weight: 400; margin-left: 12px; }
.kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-top: 8px; }
.kpi-card { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px; padding: 12px 14px; }
.kpi-card .l { font-size: 11.5px; color: #64748b; }
.kpi-card .v { font-size: 22px; font-weight: 700; color: #1F4E79; margin-top: 6px; line-height: 1; }
.kpi-card.ok .v { color: #10b981; }
.kpi-card.bad .v { color: #ef4444; }
.kpi-card.warn .v { color: #f59e0b; }
.r-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.r-table th { background: #1F4E79; color: #fff; font-weight: 600; text-align: left; padding: 8px 10px; }
.r-table td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
.r-table tbody tr:nth-child(even) td { background: #f5f8fb; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.pill.ok { background: #dcfce7; color: #15803d; }
.pill.bad { background: #fee2e2; color: #b91c1c; }
.pill.warn { background: #fef3c7; color: #a16207; }
.bar-row { display: grid; grid-template-columns: 130px 1fr 110px; align-items: center; gap: 10px; padding: 5px 0; font-size: 12.5px; }
.bar-track { background: #e2e8f0; height: 10px; border-radius: 5px; overflow: hidden; }
.bar-fill { display: block; height: 100%; background: #1F4E79; }
.bar-fill.ok { background: #10b981; }
.bar-fill.bad { background: #ef4444; }
.bar-fill.warn { background: #f59e0b; }
.fail-block { border: 1px solid #fecaca; background: #fff7f7; border-radius: 8px; padding: 14px 16px; margin: 14px 0; }
.fail-block .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.fail-block .head strong { color: #b91c1c; font-size: 14px; }
.fail-block .head .stat { font-size: 12px; color: #64748b; }
.miss-block { margin: 14px 0; }
.miss-block .head { font-weight: 600; margin-bottom: 6px; color: #0f172a; }
.empty-ok { color: #10b981; font-weight: 600; padding: 10px 0; }
.trend { display: grid; grid-template-columns: repeat(14,1fr); gap: 4px; align-items: end; height: 130px; padding: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.trend .col { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.trend .num { font-size: 9px; color: #1F4E79; font-weight: 600; min-height: 12px; }
.trend .bar2 { width: 100%; background: linear-gradient(to top,#1F4E79,#3b6fa0); border-radius: 3px 3px 0 0; min-height: 2px; }
.trend .lab { font-size: 9px; color: #64748b; }
.toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; padding: 12px 24px; background: rgba(15,23,42,0.95); backdrop-filter: blur(8px); color: #fff; align-items: center; }
.toolbar .meta { margin-left: auto; opacity: .75; font-size: 12px; }
`;

const KPI = ({ l, v, tone }: { l: string; v: any; tone?: "ok" | "bad" | "warn" }) => (
  <div className={`kpi-card ${tone ?? ""}`}>
    <div className="l">{l}</div>
    <div className="v">{v}</div>
  </div>
);

const RTable = ({ head, rows }: { head: string[]; rows: (any)[][] }) => (
  <table className="r-table">
    <thead>
      <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
    </thead>
    <tbody>
      {(rows.length ? rows : [head.map(() => "—")]).map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => <td key={j}>{c}</td>)}
        </tr>
      ))}
    </tbody>
  </table>
);

const passPill = (passC: number, sub: number) => {
  const rate = sub > 0 ? passC / sub : 0;
  const tone = rate >= 0.8 ? "ok" : rate < 0.6 ? "bad" : "warn";
  return <span className={`pill ${tone}`}>{pct(passC, sub)}</span>;
};

const WindowReport = () => {
  const { windowId } = useParams<{ windowId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchReport = async () => {
    if (!windowId) return;
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("submission_window_reports")
      .select("summary, generated_at")
      .eq("window_id", windowId)
      .order("generated_at", { ascending: false })
      .limit(1);
    if (error) {
      toast.error(error.message);
      setData(null);
      setLoading(false);
      return;
    }
    if (!rows || rows.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }
    setData(rows[0].summary as Summary);
    setLoading(false);
    document.title = `批次报告 · ${(rows[0].summary as any)?.window?.name ?? ""}`;
  };

  const generateNow = async () => {
    if (!windowId) return;
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke("generate-window-report", {
        body: { window_id: windowId },
      });
      if (error) throw error;
      toast.success("报告已生成");
      await fetchReport();
    } catch (e: any) {
      toast.error(e?.message ?? "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    void fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId]);

  if (loading) {
    return (
      <div className="report-root flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <style>{reportStyles}</style>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="report-root flex flex-col items-center justify-center gap-4 px-6" style={{ minHeight: "60vh" }}>
        <style>{reportStyles}</style>
        <p className="text-base font-medium" style={{ color: "#0f172a" }}>该批次尚未生成报告</p>
        <p className="text-sm" style={{ color: "#64748b" }}>点击下方按钮立即生成详细报告</p>
        <div className="flex gap-2">
          <Button onClick={generateNow} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {generating ? "生成中…" : "立即生成报告"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/admin/submission-windows")}>返回批次列表</Button>
        </div>
      </div>
    );
  }

  const s = data;
  const k = s.kpi;
  const trendMax = Math.max(1, ...s.daily_trend.map((t: any) => t.count));
  const statusEntries = Object.entries(s.status_distribution as Record<string, number>);
  const statusMax = Math.max(1, ...statusEntries.map(([, v]) => v as number));

  return (
    <div className="report-root">
      <style>{reportStyles}</style>
      <div className="toolbar no-print">
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => navigate("/admin/submission-windows")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <Button size="sm" onClick={() => window.print()} className="bg-blue-500 hover:bg-blue-600 text-white">
          <Printer className="h-4 w-4 mr-1" />打印 / 导出 PDF
        </Button>
        <span className="meta">提示：Windows 选「另存为 PDF」；macOS 选左下角「PDF → 存储为 PDF」</span>
      </div>

      <div className="report-page">
        <div className="cover">
          <h1>批次提交报告</h1>
          <div className="sub">{s.college?.name} · {s.window?.name}</div>
          <div className="sub">批次时间：{fmtDT(s.window?.starts_at)} — {fmtDT(s.window?.ends_at)}</div>
          <div className="sub">生成：{fmtDT(s.generated_at)}{s.generated_by ? ` · ${s.generated_by}` : ""}</div>
        </div>

        <h2 className="section-h">关键指标</h2>
        <div className="kpi-grid">
          <KPI l="学院学生总数" v={k.total_students} />
          <KPI l="已提交学生" v={k.submitted_students} />
          <KPI l="未提交学生" v={k.not_submitted} tone={k.not_submitted > 0 ? "warn" : undefined} />
          <KPI l="提交率" v={pct(k.submitted_students, k.total_students)} />
          <KPI l="申请总数" v={k.total_applications} />
          <KPI l="通过申请" v={k.approved} tone="ok" />
          <KPI l="驳回申请" v={k.rejected} tone={k.rejected > 0 ? "bad" : undefined} />
          <KPI l="待审申请" v={k.pending} tone={k.pending > 0 ? "warn" : undefined} />
          <KPI l="累计通过学分" v={Number(k.total_credit).toFixed(1)} />
          <KPI l={`合格人数 (≥${s.pass_threshold})`} v={k.pass} tone="ok" />
          <KPI l="不合格人数" v={k.fail} tone={k.fail > 0 ? "bad" : undefined} />
          <KPI l="合格率" v={pct(k.pass, k.total_students)} />
        </div>

        <h2 className="section-h">申请状态分布</h2>
        {statusEntries.length === 0 ? (
          <div className="empty-ok">本批次暂无申请</div>
        ) : (
          <div>
            {statusEntries.map(([label, val]) => {
              const tone = label.includes("通过") ? "ok" : label.includes("驳回") ? "bad" : "warn";
              const v = val as number;
              return (
                <div className="bar-row" key={label}>
                  <span>{label}</span>
                  <div className="bar-track">
                    <span className={`bar-fill ${tone}`} style={{ width: `${(v / statusMax * 100).toFixed(1)}%` }} />
                  </div>
                  <span style={{ textAlign: "right" }}>{v} · {pct(v, k.total_applications)}</span>
                </div>
              );
            })}
          </div>
        )}

        <h2 className="section-h">学分合格情况 <span className="hint">（全体学生 · 含未提交者）</span></h2>
        <RTable
          head={["合格阈值", "合格人数", "不合格人数", "合格率"]}
          rows={s.pass_tiers.map((t: any) => [
            t.th === s.pass_threshold ? `≥ ${t.th} 学分（主）` : `≥ ${t.th} 学分`,
            t.pass, t.fail, pct(t.pass, k.total_students),
          ])}
        />

        <h2 className="section-h">最近 14 天提交趋势</h2>
        <div className="trend">
          {s.daily_trend.map((t: any) => (
            <div className="col" key={t.date}>
              <div className="num">{t.count || ""}</div>
              <div className="bar2" style={{ height: `${(t.count / trendMax * 90).toFixed(1)}px` }} />
              <div className="lab">{t.date}</div>
            </div>
          ))}
        </div>

        <h2 className="section-h">按院系分布</h2>
        <RTable
          head={["院系", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分"]}
          rows={s.dept_distribution.map((e: any) => [
            e.name, e.total, e.submitted, pct(e.submitted, e.total),
            e.pass_c, e.fail_c, passPill(e.pass_c, e.total), e.credit.toFixed(1),
          ])}
        />

        <h2 className="section-h">按专业分布</h2>
        <RTable
          head={["专业", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分", "人均"]}
          rows={s.major_distribution.map((e: any) => [
            e.name, e.total, e.submitted, pct(e.submitted, e.total),
            e.pass_c, e.fail_c, passPill(e.pass_c, e.total), e.credit.toFixed(1), e.avg.toFixed(2),
          ])}
        />

        <h2 className="section-h">按班级分布</h2>
        <RTable
          head={["班级", "专业", "人数", "已提交", "未提交", "提交率", "通过", "驳回", "待审", "累计学分", "人均", "合格", "不合格", "合格率"]}
          rows={s.class_distribution.map((e: any) => [
            e.name, e.major, e.total, e.submitted, e.not_sub, pct(e.submitted, e.total),
            e.approved, e.rejected, e.pending, e.credit.toFixed(1), e.avg.toFixed(2),
            e.pass_c, e.fail_c, passPill(e.pass_c, e.total),
          ])}
        />

        <h2 className="section-h">班级合格情况 <span className="hint">（按班级 · 含未提交者 · 阈值 {s.pass_threshold} 学分）</span></h2>
        {(() => {
          const failMap = new Map<string, any>(
            (s.fail_classes ?? []).map((e: any) => [e.class, e]),
          );
          const list = (s.class_distribution ?? []).map((c: any) => {
            const fc = failMap.get(c.name);
            return {
              class: c.name,
              major: c.major,
              total: c.total,
              submitted: c.submitted,
              not_sub: c.not_sub,
              pass_c: c.pass_c,
              fail_c: c.fail_c,
              fails: fc?.fails ?? [],
            };
          });
          if (list.length === 0) {
            return <div className="empty-ok">✓ 当前批次无班级数据</div>;
          }
          return list.map((e: any) => {
            const allPass = e.fails.length === 0;
            return (
              <div className="fail-block" key={e.class} style={allPass ? { borderColor: "#bbf7d0", background: "#f0fdf4" } : undefined}>
                <div className="head">
                  <strong style={allPass ? { color: "#15803d" } : undefined}>
                    {e.class}{" "}
                    <span style={{ color: "#64748b", fontWeight: 400 }}>（{e.major}）</span>
                  </strong>
                  <span className="stat">
                    不合格 <b style={{ color: allPass ? "#15803d" : "#ef4444" }}>{e.fail_c}</b> / 班级总数 {e.total} 人 · 合格率 {pct(e.pass_c, e.total)} · 未提交 {e.not_sub} 人
                  </span>
                </div>
                {allPass ? (
                  <div className="empty-ok" style={{ padding: "4px 0" }}>✓ 该班级全部合格</div>
                ) : (
                  <RTable
                    head={["学号", "姓名", "已提交", "通过", "驳回", "待审", "当前学分", `距合格(${s.pass_threshold})`]}
                    rows={e.fails.map((f: any) => [
                      f.student_no,
                      <span key="n">{f.full_name}{f.not_submitted ? <span className="pill warn" style={{ marginLeft: 6 }}>未提交</span> : null}</span>,
                      f.submitted, f.approved, f.rejected, f.pending,
                      f.total_credit.toFixed(1),
                      <b key="g" style={{ color: "#ef4444" }}>{f.gap.toFixed(1)}</b>,
                    ])}
                  />
                )}
              </div>
            );
          });
        })()}

        <h2 className="section-h">未提交学生名单 <span className="hint">（按班级）</span></h2>
        {s.miss_classes.length === 0 ? (
          <div className="empty-ok">✓ 学院全部学生均已提交</div>
        ) : (
          s.miss_classes.map((m: any) => (
            <div className="miss-block" key={m.class}>
              <div className="head">
                {m.class}{" "}
                <span style={{ color: "#64748b", fontWeight: 400 }}>未提交 {m.list.length} 人</span>
              </div>
              <RTable
                head={["学号", "姓名", "专业", "院系"]}
                rows={m.list.map((s2: any) => [s2.student_no, s2.full_name, s2.major, s2.department])}
              />
            </div>
          ))
        )}

        <h2 className="section-h">申请明细 <span className="hint">（共 {s.details.length} 条）</span></h2>
        <RTable
          head={["时间", "学号", "姓名", "班级", "状态", "匹配规则", "AI建议", "最终", "描述"]}
          rows={s.details.map((d: any) => {
            const tone = d.status_label.includes("通过") ? "ok" : d.status_label.includes("驳回") ? "bad" : "warn";
            return [
              fmtDT(d.submitted_at).slice(5, 16),
              d.student_no, d.full_name, d.class_name,
              <span key="s" className={`pill ${tone}`}>{d.status_label}</span>,
              d.rule_name || "—",
              d.ai_suggested_credit ?? "",
              d.final_credit ?? "",
              d.description,
            ];
          })}
        />

        <div style={{ marginTop: 32, color: "#94a3b8", fontSize: 11, textAlign: "center" }}>
          {s.college?.name} · {s.window?.name} · 由系统自动生成于 {fmtDT(s.generated_at)}
        </div>
      </div>
    </div>
  );
};

export default WindowReport;
