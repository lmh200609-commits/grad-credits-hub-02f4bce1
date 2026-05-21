import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { randomUUID } from "@/lib/uuid";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import ProcessSteps from "@/components/ProcessSteps";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import {
  Send, Sparkles, X, Search, ChevronRight, Plus, FileText, Image as ImageIcon, File as FileIcon,
  Upload, CheckCircle2, Circle, ArrowLeft, RefreshCw, Trash2, Lightbulb, BookOpen, HelpCircle, ChevronDown,
  Wand2, Clock, Lock,
} from "lucide-react";
import { applySchema } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { sha256Hex } from "@/lib/fileHash";
import { buildKeywordsFingerprint } from "@/lib/keywordFingerprint";
import { toastErrorLegacy } from "@/lib/errors";

type Rule = {
  id: string;
  name: string;
  project: string | null;
  achievement: string | null;
  level: string | null;
  identity: string | null;
  credit: number;
  description: string | null;
  source?: "rule" | "case";
};

const DIMS = ["project", "achievement", "level", "identity"] as const;
const DIM_LABELS: Record<typeof DIMS[number], string> = {
  project: "项目", achievement: "成果", level: "级别", identity: "身份",
};
const DIM_TONE: Record<typeof DIMS[number], string> = {
  project: "bg-info/10 text-info border-info/30",
  achievement: "bg-primary/10 text-primary border-primary/30",
  level: "bg-warning/10 text-warning border-warning/30",
  identity: "bg-success/10 text-success border-success/30",
};

type Picked = Partial<Record<typeof DIMS[number], string>>;

const HINT_KEYWORDS = [
  "级别", "等级", "获奖", "作者", "参赛", "国家级", "省级", "校级", "国际级",
  "一等奖", "二等奖", "三等奖", "竞赛", "证书", "论文", "专利",
];

const TEMPLATES: Record<string, string> = {
  竞赛获奖:
    "我于 ____ 年 __ 月参加【赛事全称】，赛事级别为【国家级/省级/校级】，最终获得【一等奖/二等奖/…】，参与角色为【个人/团队第N参与人】。颁奖单位：____。\n\n附件包含：获奖证书原件扫描件。",
  证书考取:
    "我于 ____ 年 __ 月通过【证书全称】考试，证书等级为【一级/二级/…】，颁发机构为 ____，证书编号 ____。\n\n附件包含：证书扫描件。",
  "论文/专利":
    "我作为【第一作者/通讯作者/第N作者】，于 ____ 年 __ 月在【期刊/会议名称】发表论文《____》（DOI/录用通知号 ____）；或获得授权专利《____》（专利号 ____）。\n\n附件包含：发表证明 / 专利授权书扫描件。",
};

const parseCaseKeywords = (text: string): Picked => {
  const out: Picked = {};
  const map: Record<string, typeof DIMS[number]> = {
    项目: "project", 成果: "achievement", 级别: "level", 身份: "identity",
  };
  text.split(/[、；;\n]/).forEach((seg) => {
    const m = seg.match(/^\s*(项目|成果|级别|身份)\s*[=:：]\s*(.+?)\s*$/);
    if (m) out[map[m[1]]] = m[2];
  });
  return out;
};

const RECENT_KEY = "apply_recent_searches";
const loadRecent = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};
const pushRecent = (q: string) => {
  const arr = loadRecent().filter((x) => x !== q);
  arr.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, 5)));
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const STEPS = [
  { label: "选择关键词", description: "从案例库搜索或导航" },
  { label: "填写说明", description: "可选，描述成果详情" },
  { label: "上传图片", description: "证书 / 截图（必填）" },
  { label: "提交审核", description: "进入审核流程" },
];

const ApplyPage = () => {
  const navigate = useNavigate();
  const { user, collegeId } = useAuth();
  const [openWindow, setOpenWindow] = useState<{ id: string; name: string; ends_at: string } | null>(null);
  const [windowChecked, setWindowChecked] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Picked>({});
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [libraryKeywords, setLibraryKeywords] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent());
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [description, setDescription] = useState("");
  const [descError, setDescError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [similarCases, setSimilarCases] = useState<Array<{ id: string; title: string; awarded_credit: number | null; created_at: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // 学生端数据源：仅来自案例库（cases）
      const casesRes = await supabase
        .from("cases")
        .select("id, title, summary, awarded_credit")
        .order("created_at", { ascending: false })
        .limit(500);
      const baseRules: Rule[] = ((casesRes.data as any[]) ?? []).map((c) => {
        const kw = parseCaseKeywords(c.summary ?? "");
        return {
          id: `case:${c.id}`,
          name: c.title,
          project: kw.project ?? null,
          achievement: kw.achievement ?? c.title,
          level: kw.level ?? null,
          identity: kw.identity ?? null,
          credit: Number(c.awarded_credit ?? 0),
          description: "来自案例库（教师人工通过沉淀）",
          source: "case" as const,
        };
      });
      setRules(baseRules);
      // 关键词建议库：来自案例库的四维关键词聚合
      const kwSet = new Set<string>();
      baseRules.forEach((r) => {
        DIMS.forEach((d) => { const v = (r as any)[d]; if (v) kwSet.add(String(v)); });
      });
      setLibraryKeywords(Array.from(kwSet).sort());
      setLoading(false);
    })();
  }, []);

  // 检查当前是否在开放提交窗口内
  useEffect(() => {
    (async () => {
      if (!collegeId) { setWindowChecked(true); return; }
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("submission_windows")
        .select("id, name, ends_at")
        .eq("college_id", collegeId)
        .eq("active", true)
        .lte("starts_at", nowIso)
        .gte("ends_at", nowIso)
        .order("ends_at", { ascending: true })
        .limit(1);
      setOpenWindow(((data ?? [])[0] as any) ?? null);
      setWindowChecked(true);
    })();
  }, [collegeId]);

  // 文件预览
  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setFilePreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setFilePreview(null);
  }, [file]);

  // 同类案例
  useEffect(() => {
    if (!selectedRule) { setSimilarCases([]); return; }
    (async () => {
      const q = selectedRule.achievement ?? selectedRule.name;
      const { data } = await supabase
        .from("cases")
        .select("id, title, awarded_credit, created_at")
        .or(`title.ilike.%${q}%,summary.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(3);
      setSimilarCases((data as any[]) ?? []);
    })();
  }, [selectedRule]);

  const filteredRules = useMemo(
    () => rules.filter((r) => DIMS.every((d) => !picked[d] || r[d] === picked[d])),
    [rules, picked]
  );

  const nextDim = useMemo(() => DIMS.find((d) => !picked[d]) ?? null, [picked]);
  const nextOptions = useMemo(() => {
    if (!nextDim) return [];
    const set = new Set<string>();
    filteredRules.forEach((r) => { const v = r[nextDim]; if (v) set.add(v); });
    return Array.from(set).sort();
  }, [filteredRules, nextDim]);

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rules.filter((r) =>
      r.name.toLowerCase().includes(q)
      || (r.project ?? "").toLowerCase().includes(q)
      || (r.achievement ?? "").toLowerCase().includes(q)
      || (r.level ?? "").toLowerCase().includes(q)
      || (r.identity ?? "").toLowerCase().includes(q)
    ).slice(0, 8);
  }, [rules, search]);

  // 热门关键词（按 achievement 频次）
  const hotKeywords = useMemo(() => {
    const c = new Map<string, number>();
    rules.forEach((r) => { if (r.achievement) c.set(r.achievement, (c.get(r.achievement) ?? 0) + 1); });
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  }, [rules]);

  const pickValue = (dim: typeof DIMS[number], v: string) => setPicked({ ...picked, [dim]: v });

  const removePick = (dim: typeof DIMS[number]) => {
    const idx = DIMS.indexOf(dim);
    const next: Picked = {};
    DIMS.slice(0, idx).forEach((d) => { if (picked[d]) next[d] = picked[d]; });
    setPicked(next);
    setSelectedRule(null);
  };

  const reset = () => { setPicked({}); setSelectedRule(null); setSearch(""); };

  const chooseRule = (r: Rule) => {
    setSelectedRule(r);
    setPicked({
      project: r.project ?? undefined,
      achievement: r.achievement ?? undefined,
      level: r.level ?? undefined,
      identity: r.identity ?? undefined,
    });
    if (search.trim()) { pushRecent(search.trim()); setRecent(loadRecent()); }
    setSearch("");
  };

  const addCustomKeyword = (raw?: string) => {
    const k = (raw ?? customInput).trim();
    if (!k || customKeywords.includes(k)) return;
    setCustomKeywords([...customKeywords, k]);
    setCustomInput("");
  };
  const removeCustomKeyword = (k: string) => setCustomKeywords(customKeywords.filter((x) => x !== k));

  // 智能推荐：根据 customInput + 已选关键词 + 申请说明，对关键词库打分排序
  const recommendedKeywords = useMemo(() => {
    const candidates = libraryKeywords.filter((k) => !customKeywords.includes(k));
    if (candidates.length === 0) return [] as Array<{ k: string; s: number }>;
    const ctxParts: string[] = [];
    if (customInput.trim()) ctxParts.push(customInput.trim());
    DIMS.forEach((d) => { if (picked[d]) ctxParts.push(String(picked[d])); });
    customKeywords.forEach((k) => ctxParts.push(k));
    if (description.trim()) ctxParts.push(description.trim());
    const ctx = ctxParts.join(" ").toLowerCase();
    if (!ctx) {
      // 无输入时按出现频次（achievement 越热门越靠前）兜底
      return candidates.slice(0, 8).map((k) => ({ k, s: 0 }));
    }
    // 抽取中文 2~6 字片段 + 英文/数字整词作为查询片段
    const phrases = new Set<string>();
    (ctx.match(/[\u4e00-\u9fa5]{2,6}/g) || []).forEach((p) => phrases.add(p));
    (ctx.match(/[a-z0-9]{2,}/g) || []).forEach((p) => phrases.add(p));
    const scored = candidates.map((k) => {
      const lk = k.toLowerCase();
      let s = 0;
      // 整词包含（双向）
      phrases.forEach((p) => {
        if (lk.includes(p)) s += 5;
        else if (p.length >= 2 && ctx.includes(lk) && lk.length >= 2) s += 3;
      });
      // 单字共现
      const kChars = new Set(lk.match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) || []);
      kChars.forEach((c) => { if (ctx.includes(c)) s += 1; });
      return { k, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
    return scored;
  }, [libraryKeywords, customKeywords, customInput, picked, description]);

  const insertCustomTemplate = () => {
    ["项目=", "成果=", "级别=", "身份="].forEach((p) => {
      if (!customKeywords.some((x) => x.startsWith(p))) setCustomKeywords((prev) => [...prev, p]);
    });
  };

  const insertTemplate = (key: keyof typeof TEMPLATES) => {
    setDescription((prev) => (prev ? prev + "\n\n" : "") + TEMPLATES[key]);
    setTimeout(() => descRef.current?.focus(), 0);
  };

  // 完成度
  const stepsDone = useMemo(() => {
    let n = 0;
    const hasKw = DIMS.some((d) => picked[d]) || customKeywords.length > 0;
    if (hasKw) n = Math.max(n, 1);
    if (description.trim().length > 0) n = Math.max(n, 2);
    if (file) n = Math.max(n, 3);
    return n;
  }, [selectedRule, picked, customKeywords, description, file]);
  const currentStep = stepsDone; // 0..3 → 当前活跃步

  const descLen = description.trim().length;
  const descTone = descLen === 0 ? "warning" : descLen < 50 ? "warning" : "success";
  const descPct = Math.min(100, (descLen / 100) * 100);

  const missingHints = useMemo(() => {
    if (descLen === 0) return [] as string[];
    return HINT_KEYWORDS.filter((kw) => !description.includes(kw)).slice(0, 6);
  }, [description, descLen]);

  // 拖拽
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const FileTypeIcon = file?.type.startsWith("image/") ? ImageIcon : file?.type === "application/pdf" ? FileText : FileIcon;
  const fileTooBig = !!file && file.size > 10 * 1024 * 1024;

  const submit = async () => {
    if (!collegeId) {
      return toast({ title: "账号未分配学院", description: "请联系管理员分配所属学院后再提交", variant: "destructive" });
    }
    if (!openWindow) {
      return toast({ title: "当前不在开放提交时间内", description: "请等待管理员开放下一批次", variant: "destructive" });
    }
    const selected_keywords = DIMS.map((d) => picked[d]).filter(Boolean) as string[];
    const parsed = applySchema.safeParse({
      description, selected_keywords, custom_keywords: customKeywords,
      rule_id: null,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "请检查表单";
      setDescError(msg);
      return toast({ title: msg, variant: "destructive" });
    }
    setDescError(null);
    if (!file) {
      return toast({ title: "请上传图片证明材料", variant: "destructive" });
    }
    if (!file.type.startsWith("image/")) {
      return toast({ title: "证明材料必须为图片格式", variant: "destructive" });
    }
    if (fileTooBig) return toast({ title: "文件不能超过 10MB", variant: "destructive" });
    setSubmitting(true);
    try {
      // 提交前去重预检：图片全平台唯一 + 学生本人「已通过」关键词集合不可重复
      const fileHash = await sha256Hex(file);
      const fingerprint = buildKeywordsFingerprint(
        parsed.data.selected_keywords,
        parsed.data.custom_keywords,
      );
      {
        const { count: dupImg } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("file_hash", fileHash)
          .limit(1);
        if ((dupImg ?? 0) > 0) {
          setSubmitting(false);
          return toast({
            title: "该图片已被提交过",
            description: "请勿重复使用同一张图片，请更换证明材料",
            variant: "destructive",
          });
        }
      }
      if (fingerprint) {
        const { count: dupKw } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("student_id", user!.id)
          .eq("keywords_fingerprint", fingerprint)
          .in("status", ["approved", "auto_approved"])
          .limit(1);
        if ((dupKw ?? 0) > 0) {
          setSubmitting(false);
          return toast({
            title: "该关键词组合已审核通过",
            description: "无需重复提交，可调整关键词后再申请",
            variant: "destructive",
          });
        }
      }

      let filePath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `${user!.id}/${randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("application-files")
          .upload(filePath, file, { contentType: file.type });
        if (upErr) throw upErr;
      }
      const { data: app, error } = await supabase
        .from("applications")
        .insert({
          student_id: user!.id,
          description: parsed.data.description ?? "",
          selected_keywords: parsed.data.selected_keywords,
          custom_keywords: parsed.data.custom_keywords,
          file_path: filePath,
          file_hash: fileHash,
          keywords_fingerprint: fingerprint || null,
        })
        .select().single();
      if (error) {
        // trigger 兜底：删除已上传的图片，避免存储残留
        if (filePath) {
          await supabase.storage.from("application-files").remove([filePath]).catch(() => {});
        }
        throw error;
      }
      toast({ title: "提交成功", description: "正在等待审核" });
      // AI 评估由数据库 trigger 自动入队（ai_eval_queue），后台 worker 异步处理。
      // 后台静默触发人脸比对（不影响材料有效性，仅作教师端提示）
      supabase.functions.invoke("face-compare", {
        body: { application_id: (app as any).id },
      }).catch(() => { /* 静默失败 */ });
      navigate("/my-applications");
    } catch (e: any) {
      toastErrorLegacy(e, "提交失败");
    } finally { setSubmitting(false); }
  };

  if (loading) return (
    <AppLayout>
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </AppLayout>
  );

  // 序号徽章
  const StepBadge = ({ n }: { n: number }) => (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {n}
    </span>
  );

  const checklist = [
    { ok: DIMS.some((d) => picked[d]) || customKeywords.length > 0, label: "已选择/添加关键词" },
    { ok: !!file, label: "已上传图片证明材料" },
    { ok: descLen > 0, label: `申请说明（当前 ${descLen} 字）`, optional: true },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 pb-28">
        <PageHeader
          title="申请学分"
          description="四步完成认定申请，提交后将进入审核流程"
          actions={
            <>
              <Button variant="outline" asChild>
                <Link to="/my-applications"><ArrowLeft className="mr-1 h-4 w-4" /> 我的申请</Link>
              </Button>
              <Button onClick={submit} disabled={submitting || !collegeId || (windowChecked && !openWindow)} className="bg-gradient-to-r from-primary to-primary/80">
                {!collegeId || (windowChecked && !openWindow) ? <Lock className="mr-1 h-4 w-4" /> : <Send className="mr-1 h-4 w-4" />}
                {submitting
                  ? "提交中…"
                  : !collegeId
                    ? "账号未分配学院"
                    : windowChecked && !openWindow
                      ? "未开放提交"
                      : "提交申请"}
              </Button>
            </>
          }
        />

        {!collegeId && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-center gap-3 py-4">
              <Lock className="h-5 w-5 text-destructive" />
              <div className="text-sm">
                <div className="font-medium">账号未分配学院</div>
                <div className="text-muted-foreground">请联系管理员为你的账号分配所属学院后再提交申请。</div>
              </div>
            </CardContent>
          </Card>
        )}
        {collegeId && windowChecked && !openWindow && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="flex items-center gap-3 py-4">
              <Lock className="h-5 w-5 text-warning" />
              <div className="text-sm">
                <div className="font-medium">当前不在开放提交时间内</div>
                <div className="text-muted-foreground">请等待管理员开放新的提交批次后再行提交。</div>
              </div>
            </CardContent>
          </Card>
        )}
        {collegeId && openWindow && (
          <Card className="border-2 border-primary bg-gradient-to-r from-primary/15 to-accent/10 shadow-md">
            <CardContent className="flex items-center gap-3 py-4">
              <Clock className="h-6 w-6 shrink-0 text-primary" />
              <div className="text-sm">
                <div className="text-base font-semibold text-primary">当前批次：{openWindow.name}</div>
                <div className="font-medium text-foreground">
                  截止时间：
                  <span className="font-bold text-destructive">
                    {new Date(openWindow.ends_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-card">
          <CardContent className="py-5">
            <ProcessSteps steps={STEPS} currentStep={currentStep} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 左：主流程 */}
          <div className="space-y-6 lg:col-span-2">
            {/* ① 智能匹配 */}
            <Card className="shadow-card transition-shadow hover:shadow-cardHover">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <StepBadge n={1} />
                  <CardTitle className="text-base">从案例库匹配关键词</CardTitle>
                </div>
                <CardDescription>所有候选内容均来自历史通过案例库</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="search">
                  <TabsList className="grid w-full grid-cols-2 sm:w-auto">
                    <TabsTrigger value="search"><Search className="mr-1 h-4 w-4" />直接搜索</TabsTrigger>
                    <TabsTrigger value="nav"><Sparkles className="mr-1 h-4 w-4" />关键词导航</TabsTrigger>
                  </TabsList>

                  <TabsContent value="search" className="space-y-3">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="例如：英语四级、pocib、电子商务三创赛…"
                    />
                    {(recent.length > 0 || hotKeywords.length > 0) && !search && (
                      <div className="space-y-2 text-xs">
                        {recent.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-muted-foreground">最近搜索：</span>
                            {recent.map((r) => (
                              <button key={r} onClick={() => setSearch(r)}
                                className="rounded-full border px-2 py-0.5 hover:border-primary hover:text-primary">
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                        {hotKeywords.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-muted-foreground">热门：</span>
                            {hotKeywords.map((k) => (
                              <button key={k} onClick={() => setSearch(k)}
                                className="rounded-full bg-primary/5 px-2 py-0.5 text-primary hover:bg-primary/10">
                                {k}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {searchMatches.length > 0 && (
                      <div className="divide-y rounded-md border">
                        {searchMatches.map((r) => (
                          <button key={r.id} type="button" onClick={() => chooseRule(r)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted animate-fade-in">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 truncate font-medium">
                                {r.achievement ?? r.name}
                                {r.source === "case" && <Badge variant="outline" className="shrink-0 text-[10px]">案例</Badge>}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {[r.project, r.level, r.identity].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                            <Badge variant="secondary" className="shrink-0">{r.credit} 学分</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    {search && searchMatches.length === 0 && (
                      <p className="text-xs text-muted-foreground">案例库中未匹配，可切换到「关键词导航」逐级查找，或使用自定义关键词。</p>
                    )}
                  </TabsContent>

                  <TabsContent value="nav" className="space-y-3">
                    {/* breadcrumb */}
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      {DIMS.map((d, i) => (
                        <span key={d} className="flex items-center gap-1">
                          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          {picked[d] ? (
                            <Badge className={cn("cursor-pointer border", DIM_TONE[d])}
                              variant="outline" onClick={() => removePick(d)}>
                              <span className="mr-1 opacity-70">{DIM_LABELS[d]}:</span>
                              {picked[d]} <X className="ml-1 h-3 w-3" />
                            </Badge>
                          ) : (
                            <span className="rounded-full border border-dashed px-2 py-0.5 text-muted-foreground">
                              {DIM_LABELS[d]}
                            </span>
                          )}
                        </span>
                      ))}
                      {DIMS.some((d) => picked[d]) && (
                        <Button variant="ghost" size="sm" onClick={reset} className="ml-2 h-6 px-2 text-xs">
                          <RefreshCw className="mr-1 h-3 w-3" />重置
                        </Button>
                      )}
                    </div>

                    {nextDim && nextOptions.length > 0 && !selectedRule && (
                      <div>
                        <p className="mb-2 text-xs text-muted-foreground">
                          请选择 <span className="font-medium text-foreground">{DIM_LABELS[nextDim]}</span>（{nextOptions.length} 项）
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {nextOptions.map((v) => (
                            <button key={v} type="button" onClick={() => pickValue(nextDim, v)}
                              className="rounded-md border px-2 py-1 text-sm transition hover:border-primary hover:bg-primary/5">
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {DIMS.some((d) => picked[d]) && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          匹配到 {filteredRules.length} 条案例{filteredRules.length > 0 ? "，点击选择关键词：" : ""}
                        </p>
                        {filteredRules.slice(0, 20).map((r) => (
                          <button key={r.id} type="button" onClick={() => chooseRule(r)}
                            className={cn(
                              "flex w-full items-start justify-between gap-2 rounded-md border p-3 text-left text-sm transition hover:border-primary hover:bg-primary/5 animate-fade-in",
                              selectedRule?.id === r.id && "border-primary bg-primary/5"
                            )}>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 font-medium">
                                {r.achievement ?? r.name}
                                {r.source === "case" && <Badge variant="outline" className="text-[10px]">案例</Badge>}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {[r.project, r.level, r.identity].filter(Boolean).map((k) => (
                                  <Badge key={k as string} variant="outline" className="text-xs">{k}</Badge>
                                ))}
                              </div>
                            </div>
                            <Badge variant="secondary" className="shrink-0">{r.credit} 学分</Badge>
                          </button>
                        ))}
                        {filteredRules.length === 0 && (
                          <p className="text-sm text-muted-foreground">案例库中没有匹配项，可回退或使用自定义关键词补充</p>
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* 已选规则卡 */}
            {selectedRule && (
              <Card className="overflow-hidden border-primary/40 shadow-card animate-fade-in">
                <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">已选关键词组合（来自案例库）</p>
                      <h3 className="mt-1 truncate text-lg font-semibold">
                        {selectedRule.achievement ?? selectedRule.name}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {DIMS.map((d, i) => {
                          const v = (selectedRule as any)[d];
                          if (!v) return null;
                          return (
                            <span key={d} className="flex items-center gap-1">
                              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              <Badge variant="outline" className={cn("border", DIM_TONE[d])}>{v}</Badge>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-primary">+{selectedRule.credit}</div>
                      <div className="text-xs text-muted-foreground">参考学分（仅供参考）</div>
                      <Button size="sm" variant="ghost" onClick={reset} className="mt-2">
                        <RefreshCw className="mr-1 h-3 w-3" />换一个
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* ② 自定义关键词 */}
            <Card className="shadow-card transition-shadow hover:shadow-cardHover">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <StepBadge n={2} />
                  <CardTitle className="text-base">自定义关键词（可选）</CardTitle>
                </div>
                <CardDescription>
                  系统未收录的活动可在此补充。建议格式：
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">项目=…；成果=…；级别=…；身份=…</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomKeyword(); } }}
                    placeholder="项目=国家级B类"
                  />
                  <Button type="button" variant="outline" onClick={() => addCustomKeyword()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={insertCustomTemplate}>
                    快速插入模板
                  </Button>
                </div>
                {customKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {customKeywords.map((k) => {
                      const dim = (Object.keys(DIM_LABELS) as Array<keyof typeof DIM_LABELS>).find(
                        (d) => k.startsWith(`${DIM_LABELS[d]}=`)
                      );
                      return (
                        <Badge key={k}
                          variant="outline"
                          className={cn("cursor-pointer border", dim ? DIM_TONE[dim] : "")}
                          onClick={() => removeCustomKeyword(k)}>
                          {k} <X className="ml-1 h-3 w-3" />
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {libraryKeywords.length > 0 && (
                  <>
                  {recommendedKeywords.length > 0 && (
                    <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                          <Wand2 className="h-3.5 w-3.5" />
                          <span>智能推荐（根据您的输入自动匹配前 {recommendedKeywords.length} 个）</span>
                        </div>
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => recommendedKeywords.forEach((r) => addCustomKeyword(r.k))}
                        >
                          一键全部加入
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {recommendedKeywords.map(({ k }) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => addCustomKeyword(k)}
                            className="rounded-full border border-primary/40 bg-background px-2 py-0.5 text-xs text-primary transition hover:bg-primary hover:text-primary-foreground"
                          >
                            + {k}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Collapsible className="rounded-md border border-dashed bg-muted/30">
                    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5" />
                        关键词库（共 {libraryKeywords.length} 个，点击展开作为参考）
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-1.5 px-2 pb-2">
                      <p className="text-[11px] text-muted-foreground">仅供参考，点击标签即可加入自定义关键词</p>
                      <div className="flex flex-wrap gap-1">
                        {libraryKeywords
                          .filter((k) => !customKeywords.includes(k))
                          .slice(0, 40)
                          .map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => addCustomKeyword(k)}
                              className="rounded-full border bg-background px-2 py-0.5 text-xs transition hover:border-primary hover:text-primary"
                            >
                              + {k}
                            </button>
                          ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ③ 申请说明 */}
            <Card className="shadow-card transition-shadow hover:shadow-cardHover">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <StepBadge n={3} />
                  <CardTitle className="text-base">申请说明</CardTitle>
                </div>
                <CardDescription>可选。可补充活动详情；提交不强制要求填写</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>).map((k) => (
                    <Button key={k} type="button" variant="outline" size="sm"
                      onClick={() => insertTemplate(k)}>
                      <FileText className="mr-1 h-3 w-3" />{k}模板
                    </Button>
                  ))}
                </div>
                <Textarea
                  ref={descRef}
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); if (descError) setDescError(null); }}
                  rows={7}
                  maxLength={2000}
                  placeholder="例如：参加 2024 年 全国大学生英语竞赛 C 类获二等奖…"
                  aria-invalid={!!descError}
                />
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn(
                      "font-medium",
                      descTone === "warning" && "text-warning",
                      descTone === "success" && "text-success",
                    )}>
                      {descLen === 0 ? "未填写（可选）" : descLen < 50 ? "可继续补充" : "信息充足"}
                    </span>
                    <span className="text-muted-foreground">{description.length}/2000</span>
                  </div>
                  <Progress value={descPct} className={cn(
                    "h-1.5",
                    descTone === "warning" && "[&>div]:bg-warning",
                    descTone === "success" && "[&>div]:bg-success",
                  )} />
                  {descError && <p className="text-xs text-destructive">{descError}</p>}
                </div>
                {missingHints.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div>
                      <span className="text-muted-foreground">建议补充关键词以提升通过率：</span>
                      {missingHints.map((k) => (
                        <Badge key={k} variant="outline" className="ml-1 text-[10px]">{k}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ④ 上传材料 */}
            <Card className="shadow-card transition-shadow hover:shadow-cardHover">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <StepBadge n={4} />
                  <CardTitle className="text-base">证明材料 <span className="ml-1 text-xs font-normal text-destructive">必填</span></CardTitle>
                </div>
                <CardDescription>仅支持 JPG / PNG / WEBP 等图片格式，必须上传，单个文件 ≤ 10MB</CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {!file ? (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={cn(
                      "flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-muted/30 px-4 py-8 text-center transition-colors",
                      dragOver ? "border-primary bg-primary/5" : "hover:border-primary/60"
                    )}
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">拖拽文件到此处，或点击上传</p>
                    <p className="text-xs text-muted-foreground">仅支持图片格式（JPG / PNG / WEBP 等），最大 10 MB</p>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border p-3">
                    {filePreview ? (
                      <img src={filePreview} alt="preview" className="h-16 w-16 rounded object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded bg-muted">
                        <FileTypeIcon className="h-7 w-7 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className={cn("text-xs", fileTooBig ? "text-danger" : "text-success")}>
                        {formatBytes(file.size)} {fileTooBig && "· 超过 10MB"}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setFile(null)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 右：侧边辅助 */}
          <aside className="space-y-6">
            {/* A. 草稿摘要 */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm">准备清单</CardTitle>
                <CardDescription>实时反映当前申请状态</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {checklist.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {c.ok
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className={cn(c.ok ? "text-foreground" : "text-muted-foreground")}>
                      {c.label}{c.optional && <span className="ml-1 text-xs text-muted-foreground">(可选)</span>}
                    </span>
                  </div>
                ))}
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">完成度</span>
                    <span className="font-medium">{stepsDone}/{STEPS.length - 1} 步就绪</span>
                  </div>
                  <Progress value={(stepsDone / (STEPS.length - 1)) * 100} className="mt-1.5 h-1.5" />
                </div>
              </CardContent>
            </Card>

            {/* C. 同类案例 */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 text-primary" />同类通过案例
                </CardTitle>
                <CardDescription>仅供参考，最终学分以审核为准</CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedRule ? (
                  <p className="text-xs text-muted-foreground">先选择一条规则后，将展示相似的通过案例。</p>
                ) : similarCases.length === 0 ? (
                  <EmptyState title="暂无相似案例" description="该规则尚未沉淀通过案例" />
                ) : (
                  <ul className="space-y-2">
                    {similarCases.map((c) => (
                      <li key={c.id} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{c.title}</span>
                          <Badge variant="secondary" className="shrink-0">{Number(c.awarded_credit ?? 0)} 分</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* B. FAQ */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <HelpCircle className="h-4 w-4 text-info" />学分小贴士
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="text-sm">
                  <AccordionItem value="1">
                    <AccordionTrigger className="py-2 text-sm">审核通常需要多久？</AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground">
                      一般在 1-3 个工作日内出结果，可在「我的申请」中随时查看进度。
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="2">
                    <AccordionTrigger className="py-2 text-sm">由谁来审核？</AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground">
                      由学院审核老师对你的申请材料进行审核，确保学分认定的严谨性。
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="3">
                    <AccordionTrigger className="py-2 text-sm">材料有什么要求？</AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground">
                      推荐上传清晰的证书 / 录用通知 / 获奖名单等；图片确保字迹可辨；PDF 不加密。
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="4">
                    <AccordionTrigger className="py-2 text-sm">提交后还能修改吗？</AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground">
                      在「审核中」状态下可在「我的申请」中查看进度；已出结果的申请不可修改，如有异议请联系老师。
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="5">
                    <AccordionTrigger className="py-2 text-sm">常见拒绝原因？</AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground">
                      关键词与规则不一致、材料无法佐证、级别 / 等级缺失。建议参考"准备清单"完整填写。
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            {/* D. 帮助 */}
            <Card className="shadow-card bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="flex items-start gap-3 py-4">
                <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
                <div className="text-sm">
                  <p className="font-medium">不确定怎么填？</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    点击右下角的「学分助手」，输入活动关键词，将为你解释最贴近的规则。
                  </p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>

        {/* 吸底操作栏 */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3 text-sm">
              <div className="hidden sm:block">
                <div className="text-xs text-muted-foreground">完成度</div>
                <div className="font-semibold">{stepsDone}/{STEPS.length - 1} 步就绪</div>
              </div>
              <div className="hidden h-8 border-l sm:block" />
              <div>
                <div className="text-xs text-muted-foreground">预计学分</div>
                <div className="font-semibold text-primary">
                  {selectedRule ? `+${selectedRule.credit}` : "—"}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="hidden sm:inline-flex">
                <RefreshCw className="mr-1 h-4 w-4" />重置选择
              </Button>
              <Button onClick={submit} disabled={submitting}
                className="bg-gradient-to-r from-primary to-primary/80 active:scale-[0.98]">
                <Send className="mr-1 h-4 w-4" /> {submitting ? "提交中…" : "提交申请"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ApplyPage;