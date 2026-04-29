import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Bot, Loader2, Paperclip, Send, Sparkles, User, CheckCircle2, AlertCircle } from "lucide-react";

type ParsedRow = {
  student_no: string;
  full_name: string;
  phone?: string;
  class_name?: string;
  department?: string;
  major?: string;
  role: "admin" | "teacher" | "student";
  password: string;
};

type ChatMsg =
  | { kind: "ai"; text: string }
  | { kind: "user"; text: string }
  | { kind: "file"; name: string; rowCount: number }
  | { kind: "preview"; rows: ParsedRow[]; notes?: string }
  | { kind: "result"; ok: boolean; text: string };

const ROLE_LABEL: Record<string, string> = { admin: "管理员", teacher: "教师", student: "学生" };

const ImportUsers = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFileNameRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      kind: "ai",
      text:
        "你好👋，我是名册导入助手。\n\n📋 导入规则：\n• 仅支持 Excel（.xlsx/.xls）和 CSV，第一行必须是表头\n• 必填列：学号/工号、姓名；其他列可选\n• 默认角色可在输入框调整（如「默认角色=学生」）\n• 🔑 密码规则：统一为「学号 + 电话号码后 6 位」，电话不足 6 位时左侧补 0\n• ⚠️ 表格中已填写的「角色」列以表格数据为准，仅当为空时才用默认角色\n\n你可以直接📎上传 Excel/CSV，也可以问我任何关于导入的问题。",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingRows, setPendingRows] = useState<ParsedRow[] | null>(null);
  const [defaults, setDefaults] = useState<{ role: ParsedRow["role"] }>({
    role: "student",
  });

  const push = (m: ChatMsg) => setMessages((prev) => [...prev, m]);

  const handleUserMessage = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    push({ kind: "user", text });

    // Parse simple instructions like 默认角色=教师 / 默认密码=Abc123
    const roleMatch = text.match(/默认角色\s*[=:：]\s*(管理员|教师|老师|学生)/);
    const pwdMatch = text.match(/默认密码\s*[=:：]\s*(\S+)/);
    let updated = false;
    const next = { ...defaults };
    if (roleMatch) {
      const m = roleMatch[1];
      next.role = m === "管理员" ? "admin" : m === "学生" ? "student" : "teacher";
      updated = true;
    }
    if (pwdMatch) {
      push({
        kind: "ai",
        text: "ℹ️ 已不再支持设置默认密码。系统统一按「学号 + 电话后 6 位」生成密码（电话不足 6 位时左侧补 0）。",
      });
      return;
    }
    if (updated) {
      setDefaults(next);
      push({
        kind: "ai",
        text: `好的，已更新默认角色：${ROLE_LABEL[next.role]}。点击 📎 上传 Excel/CSV 即可开始。`,
      });
      return;
    }
    void askAi(text);
  };

  const askAi = async (question: string) => {
    setLoading(true);
    try {
      const history = messages
        .filter((m) => m.kind === "ai" || m.kind === "user")
        .map((m) => ({
          role: m.kind === "ai" ? ("assistant" as const) : ("user" as const),
          content: (m as { text: string }).text,
        }));
      history.push({ role: "user", content: question });

      const { data, error } = await supabase.functions.invoke("import-assistant-chat", {
        body: { messages: history, defaults },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let detail = error.message;
        try {
          const t = await ctx?.text?.();
          if (t) detail = JSON.parse(t).error ?? detail;
        } catch {}
        push({ kind: "ai", text: `❌ 助手暂时不可用：${detail}` });
        return;
      }
      push({ kind: "ai", text: data?.answer ?? "（无回答）" });
    } catch (e) {
      push({ kind: "ai", text: `❌ 助手出错：${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (rawRows.length === 0) {
        push({ kind: "ai", text: "❌ 没有读到任何行，请确认文件第一行是表头、之后是数据。" });
        return;
      }

      push({ kind: "file", name: file.name, rowCount: rawRows.length });
      lastFileNameRef.current = file.name;
      push({ kind: "ai", text: `已读取 ${rawRows.length} 行原始数据，正在让 AI 识别字段并规范化…` });

      const { data, error } = await supabase.functions.invoke("ai-parse-roster", {
        body: { rows: rawRows, defaultRole: defaults.role },
      });

      if (error) {
        const ctx: any = (error as any).context;
        let detail = error.message;
        try {
          const t = await ctx?.text?.();
          if (t) detail = JSON.parse(t).error ?? detail;
        } catch {}
        push({ kind: "ai", text: `❌ 解析失败：${detail}` });
        return;
      }

      const rows = (data?.rows ?? []) as ParsedRow[];
      if (rows.length === 0) {
        push({ kind: "ai", text: "❌ AI 没有识别出任何有效行。请检查表格内容。" });
        return;
      }

      setPendingRows(rows);
      push({ kind: "preview", rows, notes: data?.notes });
      push({
        kind: "ai",
        text: `识别完成 ✅ 共 ${rows.length} 个账号待创建。请核对预览，确认无误后点击下方 "确认导入"。`,
      });
    } catch (e) {
      push({ kind: "ai", text: `❌ 读取文件失败：${(e as Error).message}` });
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const CHUNK_SIZE = 200; // send 200 users per request to avoid timeout

  const confirmImport = async () => {
    if (!pendingRows) return;
    setLoading(true);
    push({ kind: "user", text: "确认导入" });

    const totalRows = pendingRows;
    const chunks = [];
    for (let i = 0; i < totalRows.length; i += CHUNK_SIZE) {
      chunks.push(totalRows.slice(i, i + CHUNK_SIZE));
    }

    let totalCreated = 0;
    let failed = false;

    for (let ci = 0; ci < chunks.length; ci++) {
      push({
        kind: "ai",
        text: `正在导入第 ${ci + 1}/${chunks.length} 批（${chunks[ci].length} 个账号）…`,
      });

      const { data, error } = await supabase.functions.invoke("import-users", {
        body: { rows: chunks[ci], file_name: lastFileNameRef.current },
      });

      if (error) {
        const ctx: any = (error as any).context;
        let detail = error.message;
        let extras: string[] = [];
        let aiErrors: { line: number; message: string }[] = [];
        let aiConflicts: string[] = [];
        try {
          const t = await ctx?.text?.();
          if (t) {
            const j = JSON.parse(t);
            detail = j.error ?? detail;
            if (j.errors) {
              aiErrors = j.errors;
              extras = j.errors.map((e: any) => `第 ${e.line} 行：${e.message}`);
            }
            if (j.conflicts) {
              aiConflicts = j.conflicts;
              extras = j.conflicts.map((c: string) => `已存在：${c}`);
            }
          }
        } catch {}

        // Ask AI for a human-readable explanation (structured errors only — never the raw Excel).
        let aiHint = "";
        if (aiErrors.length || aiConflicts.length) {
          try {
            const { data: ex } = await supabase.functions.invoke("ai-explain-import", {
              body: {
                errors: aiErrors,
                conflicts: aiConflicts,
                total: chunks[ci].length,
              },
            });
            if (ex?.summary) {
              aiHint = `\n\n💡 AI 诊断：${ex.summary}` +
                (ex.suggestions?.length ? `\n建议：\n• ${ex.suggestions.join("\n• ")}` : "");
            }
          } catch { /* ignore */ }
        }

        push({
          kind: "result",
          ok: false,
          text: `第 ${ci + 1} 批失败：${[detail, ...extras].join("\n")}\n已成功导入前 ${totalCreated} 个账号。${aiHint}`,
        });
        toast({ title: "导入部分失败", description: detail, variant: "destructive" });
        failed = true;
        break;
      }

      if (data?.success) {
        totalCreated += data.created;
      }
    }

    if (!failed) {
      push({
        kind: "result",
        ok: true,
        text: `全部完成 🎉 成功创建 ${totalCreated} 个账号，已绑定姓名 / 学号 / 专业 / 班级 / 院系 / 手机号。`,
      });
      toast({ title: "导入成功", description: `已新增 ${totalCreated} 个账号` });
      setPendingRows(null);
    }

    setLoading(false);
  };

  return (
    <AppLayout>
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">AI 名册导入助手</h1>
            <p className="text-xs text-muted-foreground">
              上传 Excel/CSV，自动识别字段并批量创建账号
            </p>
          </div>
          <div className="ml-auto flex gap-2 text-xs">
            <Badge variant="outline">默认角色：{ROLE_LABEL[defaults.role]}</Badge>
            <Badge variant="outline">密码规则：学号 + 电话后 6 位</Badge>
          </div>
        </div>

        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} onConfirm={confirmImport} loading={loading} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 处理中…
              </div>
            )}
          </CardContent>

          <div className="border-t bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                title="上传 Excel/CSV"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUserMessage()}
                placeholder="提问或调整默认角色，如：默认角色=学生"
                disabled={loading}
              />
              <Button onClick={handleUserMessage} disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
};

const MessageBubble = ({
  msg,
  onConfirm,
  loading,
}: {
  msg: ChatMsg;
  onConfirm: () => void;
  loading: boolean;
}) => {
  if (msg.kind === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          {msg.text}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4" />
        </div>
      </div>
    );
  }

  if (msg.kind === "ai") {
    return (
      <div className="flex gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-4 py-2 text-sm">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.kind === "file") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm border bg-background px-4 py-2 text-sm">
          📄 {msg.name} · {msg.rowCount} 行
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4" />
        </div>
      </div>
    );
  }

  if (msg.kind === "preview") {
    return (
      <div className="flex gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
        <div className="w-full max-w-[90%] space-y-2 rounded-2xl rounded-tl-sm border bg-background p-3">
          {msg.notes && (
            <p className="text-xs italic text-muted-foreground">AI 备注：{msg.notes}</p>
          )}
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学号/工号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>院系</TableHead>
                  <TableHead>专业</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead>手机号</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {msg.rows.slice(0, 50).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.student_no}</TableCell>
                    <TableCell>{r.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[r.role]}</Badge>
                    </TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    <TableCell>{r.major ?? "—"}</TableCell>
                    <TableCell>{r.class_name ?? "—"}</TableCell>
                    <TableCell>{r.phone ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {msg.rows.length > 50 && (
              <p className="border-t p-2 text-center text-xs text-muted-foreground">
                仅预览前 50 行，共 {msg.rows.length} 行
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={onConfirm} disabled={loading} size="sm">
              ✅ 确认导入 {msg.rows.length} 个账号
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // result
  return (
    <div className="flex gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border px-4 py-2 text-sm ${
          msg.ok ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"
        }`}
      >
        <div className="mb-1 flex items-center gap-1 font-medium">
          {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {msg.ok ? "导入成功" : "导入失败"}
        </div>
        {msg.text}
      </div>
    </div>
  );
};

export default ImportUsers;
