import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Send, Sparkles, X, Search, ChevronRight, Plus } from "lucide-react";
import { applySchema } from "@/lib/schemas";

type Rule = {
  id: string;
  name: string;
  project: string | null;
  achievement: string | null;
  level: string | null;
  identity: string | null;
  credit: number;
  description: string | null;
  source?: "rule" | "case"; // 标记来源，案例库的条目展示"案例"徽章
};

const DIMS = ["project", "achievement", "level", "identity"] as const;
const DIM_LABELS: Record<typeof DIMS[number], string> = {
  project: "项目",
  achievement: "成果",
  level: "级别",
  identity: "身份",
};

type Picked = Partial<Record<typeof DIMS[number], string>>;

// 解析案例摘要中形如 "项目=xxx；成果=yyy；级别=zzz；身份=aaa" 的关键词
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

const ApplyPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Picked>({});
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [description, setDescription] = useState("");
  const [descError, setDescError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [rulesRes, casesRes] = await Promise.all([
        supabase
          .from("rules")
          .select("id, name, project, achievement, level, identity, credit, description")
          .eq("active", true),
        supabase
          .from("cases")
          .select("id, title, summary, awarded_credit"),
      ]);
      const baseRules: Rule[] = ((rulesRes.data as any[]) ?? []).map((r) => ({ ...r, source: "rule" as const }));

      // 把案例库条目"伪装"成 rule，让学生可在导航/搜索中选到
      const caseRules: Rule[] = ((casesRes.data as any[]) ?? []).map((c) => {
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

      setRules([...baseRules, ...caseRules]);
      setLoading(false);
    })();
  }, []);

  // 当前匹配的规则集（按已选维度交集筛选）
  const filteredRules = useMemo(() => {
    return rules.filter((r) =>
      DIMS.every((d) => !picked[d] || r[d] === picked[d])
    );
  }, [rules, picked]);

  // 下一个未选维度的可选项
  const nextDim = useMemo(() => DIMS.find((d) => !picked[d]) ?? null, [picked]);
  const nextOptions = useMemo(() => {
    if (!nextDim) return [];
    const set = new Set<string>();
    filteredRules.forEach((r) => {
      const v = r[nextDim];
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [filteredRules, nextDim]);

  // 搜索
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

  const pickValue = (dim: typeof DIMS[number], v: string) =>
    setPicked({ ...picked, [dim]: v });

  const removePick = (dim: typeof DIMS[number]) => {
    // 移除该维度及其后续维度
    const idx = DIMS.indexOf(dim);
    const next: Picked = {};
    DIMS.slice(0, idx).forEach((d) => { if (picked[d]) next[d] = picked[d]; });
    setPicked(next);
    setSelectedRule(null);
  };

  const reset = () => {
    setPicked({});
    setSelectedRule(null);
    setSearch("");
  };

  const chooseRule = (r: Rule) => {
    setSelectedRule(r);
    setPicked({
      project: r.project ?? undefined,
      achievement: r.achievement ?? undefined,
      level: r.level ?? undefined,
      identity: r.identity ?? undefined,
    });
    setSearch("");
  };

  const addCustomKeyword = () => {
    const k = customInput.trim();
    if (!k) return;
    if (customKeywords.includes(k)) return;
    setCustomKeywords([...customKeywords, k]);
    setCustomInput("");
  };
  const removeCustomKeyword = (k: string) =>
    setCustomKeywords(customKeywords.filter((x) => x !== k));

  const submit = async () => {
    const selected_keywords = DIMS.map((d) => picked[d]).filter(Boolean) as string[];
    const parsed = applySchema.safeParse({
      description,
      selected_keywords,
      custom_keywords: customKeywords,
      rule_id: selectedRule?.id ?? null,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "请检查表单";
      setDescError(msg);
      return toast({ title: msg, variant: "destructive" });
    }
    setDescError(null);
    if (file && file.size > 10 * 1024 * 1024) {
      return toast({ title: "文件不能超过 10MB", variant: "destructive" });
    }
    setSubmitting(true);
    try {
      let filePath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `${user!.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("application-files")
          .upload(filePath, file, { contentType: file.type });
        if (upErr) throw upErr;
      }

      const { data: app, error } = await supabase
        .from("applications")
        .insert({
          student_id: user!.id,
          description: parsed.data.description,
          selected_keywords: parsed.data.selected_keywords,
          custom_keywords: parsed.data.custom_keywords,
          file_path: filePath,
        })
        .select()
        .single();
      if (error) throw error;

      toast({ title: "已提交，系统正在核验材料…" });
      const { data: aiRes, error: aiErr } = await supabase.functions.invoke("evaluate-application", {
        body: { application_id: (app as any).id },
      });
      if (aiErr) {
        toast({ title: "系统核验失败，已转人工复核", description: aiErr.message, variant: "destructive" });
      } else if (aiRes?.status) {
        toast({ title: "系统核验完成" });
      }
      navigate("/my-applications");
    } catch (e: any) {
      toast({ title: "提交失败", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold">申请学分</h1>
          <p className="text-sm text-muted-foreground">按 项目 → 成果 → 级别 → 身份 逐级选择，或直接搜索</p>
        </div>

        {/* 搜索 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> 直接搜索
            </CardTitle>
            <CardDescription>输入项目/成果/级别名称</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="例如：英语四级、pocib、电子商务三创赛…"
            />
            {searchMatches.length > 0 && (
              <div className="space-y-1 rounded-md border">
                {searchMatches.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => chooseRule(r)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
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
          </CardContent>
        </Card>

        {/* 四级关键词导航 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> 关键词导航
            </CardTitle>
            <CardDescription>项目 → 成果 → 级别 → 身份</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 已选路径 */}
            {DIMS.some((d) => picked[d]) && (
              <div className="flex flex-wrap items-center gap-1">
                {DIMS.map((d, i) => picked[d] && (
                  <span key={d} className="flex items-center gap-1">
                    {i > 0 && DIMS.slice(0, i).some((x) => picked[x]) && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                    <Badge variant="default" className="cursor-pointer" onClick={() => removePick(d)}>
                      <span className="mr-1 text-[10px] opacity-70">{DIM_LABELS[d]}:</span>
                      {picked[d]} <X className="ml-1 h-3 w-3" />
                    </Badge>
                  </span>
                ))}
                <Button variant="ghost" size="sm" onClick={reset} className="ml-2 h-6 px-2 text-xs">
                  重置
                </Button>
              </div>
            )}

            {/* 下一级选项 */}
            {nextDim && nextOptions.length > 0 && !selectedRule && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  请选择 <span className="font-medium text-foreground">{DIM_LABELS[nextDim]}</span>
                  （{nextOptions.length} 项）
                </p>
                <div className="flex flex-wrap gap-2">
                  {nextOptions.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => pickValue(nextDim, v)}
                      className="rounded-md border px-2 py-1 text-sm hover:border-primary hover:bg-muted"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 候选规则 */}
            {DIMS.some((d) => picked[d]) && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  匹配到 {filteredRules.length} 条规则{filteredRules.length > 0 ? "，点击选择：" : ""}
                </p>
                {filteredRules.slice(0, 20).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => chooseRule(r)}
                    className={`flex w-full items-start justify-between gap-2 rounded-md border p-3 text-left text-sm transition hover:border-primary hover:bg-muted ${
                      selectedRule?.id === r.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{r.achievement ?? r.name}</div>
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
                  <p className="text-sm text-muted-foreground">没有匹配的规则，请回退或使用自定义关键词补充说明</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 自定义关键词 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">自定义关键词（可选）</CardTitle>
            <CardDescription>
              系统未收录的活动可在此补充。建议按以下格式逐条添加，便于教师人工复核识别：
              <span className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs">
                项目=国家级B类；成果=电子商务三创赛；级别=校级最佳创意奖；身份=第一参与人
              </span>
              你也可以拆成多条，如 <code className="rounded bg-muted px-1">项目=国家级B类</code>、<code className="rounded bg-muted px-1">成果=电子商务三创赛</code> 等。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomKeyword(); } }}
                placeholder="项目=…；成果=…；级别=…；身份=…"
              />
              <Button type="button" variant="outline" onClick={addCustomKeyword}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {customKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customKeywords.map((k) => (
                  <Badge key={k} variant="secondary" className="cursor-pointer" onClick={() => removeCustomKeyword(k)}>
                    {k} <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 已选规则提示 */}
        {selectedRule && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-base">已选规则</CardTitle>
              <CardDescription>
                {selectedRule.achievement ?? selectedRule.name} · {selectedRule.credit} 学分
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* 申请说明 - 始终显示 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">申请说明</CardTitle>
            <CardDescription>详细描述你的活动 / 成果（10-2000 字）</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); if (descError) setDescError(null); }}
              rows={6}
              maxLength={2000}
              placeholder="例如：参加 2024 年 全国大学生英语竞赛 C 类获二等奖…"
              aria-invalid={!!descError}
            />
            <div className="mt-1 flex justify-between text-xs">
              <span className="text-destructive">{descError ?? ""}</span>
              <span className="text-muted-foreground">{description.length}/2000</span>
            </div>
          </CardContent>
        </Card>

        {/* 上传 - 始终显示 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">证明材料（PDF / 图片，可选，≤10MB）</CardTitle>
            <CardDescription>上传获奖证书、成绩单等证明文件</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {file && <p className="mt-2 text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button variant="outline" onClick={reset}>重置选择</Button>
          <Button onClick={submit} disabled={submitting}>
            <Send className="mr-1 h-4 w-4" /> {submitting ? "提交中…" : "提交申请"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default ApplyPage;
