import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Search } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import TableSkeleton from "@/components/TableSkeleton";
import { writeAuditLog } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";

type Keyword = {
  id: string;
  keyword: string;
  category: string | null;
  source: string | null;
  usage_count: number;
  active: boolean;
  created_at: string;
};

const KeywordsPage = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [bulk, setBulk] = useState({ keywords: "", category: "", source: "" });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("keywords")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "加载失败", description: error.message, variant: "destructive" });
    }
    setItems((data as Keyword[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (k) =>
        k.keyword.toLowerCase().includes(q) ||
        (k.category ?? "").toLowerCase().includes(q) ||
        (k.source ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const save = async () => {
    const list = bulk.keywords
      .split(/[,，\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      return toast({ title: "请至少输入一个关键词", variant: "destructive" });
    }
    const payload = list.map((k) => ({
      keyword: k,
      category: bulk.category.trim() || null,
      source: bulk.source.trim() || null,
      created_by: user?.id ?? null,
    }));
    const { data, error } = await supabase
      .from("keywords")
      .upsert(payload, { onConflict: "keyword", ignoreDuplicates: true })
      .select("id, keyword");
    if (error) {
      return toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
    const inserted = (data ?? []) as { id: string; keyword: string }[];
    writeAuditLog({
      action: "keyword_create",
      target_ids: inserted.map((i) => i.id),
      target_labels: inserted.map((i) => i.keyword),
      affected_count: list.length,
      success_count: inserted.length,
      metadata: { category: bulk.category || null, source: bulk.source || null, attempted: list.length },
    });
    toast({
      title: "已保存",
      description: `新增 ${inserted.length} 个，跳过重复 ${list.length - inserted.length} 个`,
    });
    setBulk({ keywords: "", category: "", source: "" });
    setOpen(false);
    load();
  };

  const remove = async (k: Keyword) => {
    if (!confirm(`确认删除关键词「${k.keyword}」？`)) return;
    const { error } = await supabase.from("keywords").delete().eq("id", k.id);
    if (error) {
      return toast({ title: "删除失败", description: error.message, variant: "destructive" });
    }
    writeAuditLog({
      action: "keyword_delete",
      target_ids: [k.id],
      target_labels: [k.keyword],
      affected_count: 1,
      success_count: 1,
      metadata: { category: k.category, source: k.source },
    });
    toast({ title: "已删除" });
    load();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title="关键词库"
          description="往届毕业生认证材料中提炼的关键词，AI 评估和学分匹配时会优先参考"
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-1 h-4 w-4" />
                  新增关键词
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>新增关键词</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>关键词（支持批量，逗号、空格或换行分隔）</Label>
                    <Textarea
                      value={bulk.keywords}
                      onChange={(e) => setBulk({ ...bulk, keywords: e.target.value })}
                      rows={4}
                      placeholder="如：ACM 算法竞赛, 数学建模, 创新创业大赛"
                    />
                  </div>
                  <div>
                    <Label>分类（可选）</Label>
                    <Input
                      value={bulk.category}
                      onChange={(e) => setBulk({ ...bulk, category: e.target.value })}
                      placeholder="如：竞赛 / 科研 / 实践"
                    />
                  </div>
                  <div>
                    <Label>来源说明（可选）</Label>
                    <Input
                      value={bulk.source}
                      onChange={(e) => setBulk({ ...bulk, source: e.target.value })}
                      placeholder="如：2023 届毕业生认证材料"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={save}>保存</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">
              关键词列表（{filtered.length}
              {search && ` / ${items.length}`}）
            </CardTitle>
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索关键词 / 分类 / 来源"
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>关键词</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>使用次数</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} cols={5} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        title={search ? "无匹配关键词" : "暂无关键词"}
                        description={search ? "换个关键词试试" : "点击右上角新增第一批关键词"}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.keyword}</TableCell>
                      <TableCell>
                        {k.category ? <Badge variant="secondary">{k.category}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {k.source ?? "—"}
                      </TableCell>
                      <TableCell>{k.usage_count}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => remove(k)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default KeywordsPage;
