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
import { Send, Sparkles, X, Search, ChevronRight } from "lucide-react";
import { applySchema } from "@/lib/schemas";

type Rule = {
  id: string;
  name: string;
  category: string | null;
  keywords: string[];
  credit: number;
  description: string | null;
};

const ApplyPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]); // 已选关键词路径
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
      const { data } = await supabase
        .from("rules")
        .select("id, name, category, keywords, credit, description")
        .eq("active", true);
      setRules((data as Rule[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // 根据已选关键词筛选规则（交集匹配）
  const filteredRules = useMemo(() => {
    if (picked.length === 0) return rules;
    return rules.filter((r) => picked.every((k) => r.keywords.includes(k)));
  }, [rules, picked]);

  // 下一级可选关键词 = 候选规则中未被选过的关键词去重
  const nextKeywords = useMemo(() => {
    const set = new Set<string>();
    filteredRules.forEach((r) => r.keywords.forEach((k) => {
      if (!picked.includes(k)) set.add(k);
    }));
    return Array.from(set).sort();
  }, [filteredRules, picked]);

  // 搜索匹配
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rules.filter((r) =>
      r.name.toLowerCase().includes(q)
      || (r.description ?? "").toLowerCase().includes(q)
      || r.keywords.some((k) => k.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [rules, search]);

  const pickKeyword = (k: string) => setPicked([...picked, k]);
  const popPicked = (k: string) => {
    const idx = picked.indexOf(k);
    if (idx >= 0) setPicked(picked.slice(0, idx));
  };
  const reset = () => {
    setPicked([]); setSelectedRule(null); setSearch("");
  };

  // 选中规则：自动把规则的所有关键词作为已选路径
  const chooseRule = (r: Rule) => {
    setSelectedRule(r);
    setPicked(r.keywords);
    setSearch("");
  };

  const submit = async () => {
    if (!selectedRule) {
      return toast({ title: "请先选择一条学分规则", variant: "destructive" });
    }
    const parsed = applySchema.safeParse({
      description,
      selected_keywords: picked,
      rule_id: selectedRule.id,
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
          file_path: filePath,
        })
        .select()
        .single();
      if (error) throw error;

      toast({ title: "已提交，AI 正在评估…" });
      const { data: aiRes, error: aiErr } = await supabase.functions.invoke("evaluate-application", {
        body: { application_id: (app as any).id },
      });
      if (aiErr) {
        toast({ title: "AI 评估失败，已转人工复核", description: aiErr.message, variant: "destructive" });
      } else if (aiRes?.status) {
        toast({ title: "AI 评估完成", description: `结果：${aiRes.status}` });
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
          <p className="text-sm text-muted-foreground">通过关键词逐步缩小范围，或直接搜索匹配学分规则</p>
        </div>

        {/* 搜索 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> 直接搜索
            </CardTitle>
            <CardDescription>输入活动名称或关键词，例如"挑战杯""志愿者"</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索规则名称或关键词…"
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
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.keywords.join(" · ")}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{r.credit} 学分</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 关键词逐级筛选 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> 关键词导航
            </CardTitle>
            <CardDescription>
              逐级点击关键词，候选规则会越来越少
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 已选路径 */}
            {picked.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {picked.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <Badge variant="default" className="cursor-pointer" onClick={() => popPicked(k)}>
                      {k} <X className="ml-1 h-3 w-3" />
                    </Badge>
                  </span>
                ))}
                <Button variant="ghost" size="sm" onClick={reset} className="ml-2 h-6 px-2 text-xs">
                  重置
                </Button>
              </div>
            )}

            {/* 下一级关键词 */}
            {nextKeywords.length > 0 && !selectedRule && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {picked.length === 0 ? "请选择一个关键词开始" : "继续缩小范围（可选）"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {nextKeywords.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => pickKeyword(k)}
                      className="rounded-md border px-2 py-1 text-sm hover:border-primary hover:bg-muted"
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 候选规则 */}
            {picked.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  匹配到 {filteredRules.length} 条规则{filteredRules.length > 0 ? "，点击选择：" : ""}
                </p>
                {filteredRules.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => chooseRule(r)}
                    className={`flex w-full items-start justify-between gap-2 rounded-md border p-3 text-left text-sm transition hover:border-primary hover:bg-muted ${
                      selectedRule?.id === r.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{r.name}</div>
                      {r.description && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.description}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.keywords.map((k) => (
                          <Badge key={k} variant="outline" className="text-xs">{k}</Badge>
                        ))}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{r.credit} 学分</Badge>
                  </button>
                ))}
                {filteredRules.length === 0 && (
                  <p className="text-sm text-muted-foreground">没有匹配的规则，请减少关键词</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 选中规则确认 + 申请说明 */}
        {selectedRule && (
          <>
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="text-base">已选规则</CardTitle>
                <CardDescription>
                  {selectedRule.name} · {selectedRule.credit} 学分
                </CardDescription>
              </CardHeader>
              {selectedRule.description && (
                <CardContent className="text-sm text-muted-foreground">
                  {selectedRule.description}
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">申请说明</CardTitle>
                <CardDescription>详细描述你的活动 / 成果，便于 AI 与教师判断（10-2000 字）</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); if (descError) setDescError(null); }}
                  rows={6}
                  maxLength={2000}
                  placeholder="例如：参加 2024 年 ACM 区域赛获铜牌，参赛队员 3 人，比赛时长 5 小时…"
                  aria-invalid={!!descError}
                />
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-destructive">{descError ?? ""}</span>
                  <span className="text-muted-foreground">{description.length}/2000</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">证明材料（PDF / 图片，可选，≤10MB）</CardTitle>
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
              <Button variant="outline" onClick={reset}>重新选择</Button>
              <Button onClick={submit} disabled={submitting}>
                <Send className="mr-1 h-4 w-4" /> {submitting ? "提交中…" : "提交申请"}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default ApplyPage;
