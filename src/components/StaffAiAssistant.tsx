import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, Send, Loader2, Zap, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Candidate = {
  user_id: string;
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  class_name: string | null;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  candidates?: Candidate[] | null;
  stats?: any;
  action?: { type: string; payload: any } | null;
};

const WELCOME: Msg = {
  role: "assistant",
  content:
    "你好，我是工作助手。可以用自然语言告诉我要做什么，例如：\n• 「查看不合格学生」\n• 「调出张三的档案」\n• 「打开复核中心」\n• 「本周通过了多少申请」",
};

const QUICK_ACTIONS: { label: string; prompt: string; icon?: any }[] = [
  { label: "待我审核", prompt: "打开复核中心，列出待复核的申请" },
  { label: "不合格学生", prompt: "列出累计学分不合格的学生" },
  { label: "数据看板", prompt: "打开数据看板" },
  { label: "查学生档案", prompt: "查找学生档案" },
  { label: "学分排名", prompt: "打开学分排名页面" },
  { label: "本月新提交", prompt: "本月一共有多少新提交的申请" },
];

const StaffAiAssistant = () => {
  const { hasRole } = useAuth();
  const role = hasRole("admin") ? "admin" : "teacher";
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("quick");
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setTab("chat");
    const next: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const history = next.filter((m) => m !== WELCOME).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("staff-ai-assistant", {
        body: { messages: history, role },
      });
      if (error) throw error;
      const d = data as any;
      const assistantMsg: Msg = {
        role: "assistant",
        content: d?.answer || "（无回答）",
        candidates: d?.candidates ?? null,
        stats: d?.stats ?? null,
        action: d?.action ?? null,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Auto-navigate when there's a navigate action and no candidates to disambiguate
      if (d?.action?.type === "navigate" && !d?.candidates?.length && d?.action?.payload?.path) {
        setTimeout(() => {
          navigate(d.action.payload.path);
          setOpen(false);
        }, 400);
      }
    } catch (e: any) {
      toast({
        title: "助手暂时不可用",
        description: e?.message || "请稍后再试",
        variant: "destructive",
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "抱歉，服务暂时不可用，请稍后再试。" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const goCandidate = (c: Candidate) => {
    const path = role === "admin" ? `/admin/users/students?search=${encodeURIComponent(c.student_no || c.full_name || "")}` : `/teacher/students/${c.user_id}`;
    navigate(path);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="打开工作助手"
        className="fixed bottom-20 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-6 z-50 flex h-[min(560px,calc(100vh-6rem))] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-[420px] flex-col rounded-xl border bg-background shadow-2xl sm:w-[420px]">
      <header className="flex items-center justify-between border-b bg-gradient-to-r from-primary to-primary-glow px-4 py-3 text-primary-foreground rounded-t-xl">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-semibold">工作助手</span>
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px]">{role === "admin" ? "管理员" : "教师"}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2 grid grid-cols-2">
          <TabsTrigger value="chat" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />智能问答</TabsTrigger>
          <TabsTrigger value="quick" className="gap-1.5"><Zap className="h-3.5 w-3.5" />快捷指令</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex flex-1 flex-col overflow-hidden m-0">
          <ScrollArea className="flex-1">
            <div ref={scrollRef} className="flex flex-col gap-3 p-4">
              {messages.map((m, i) => (
                <div key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>

                  {m.candidates && m.candidates.length > 0 && (
                    <div className="flex w-full max-w-[90%] flex-col gap-1.5">
                      {m.candidates.map((c) => (
                        <button
                          key={c.user_id}
                          onClick={() => goCandidate(c)}
                          className="group flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-left text-xs transition hover:border-primary hover:bg-muted/40"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.full_name || "—"} <span className="ml-1 text-muted-foreground">{c.student_no || ""}</span></div>
                            <div className="truncate text-[11px] text-muted-foreground">{[c.department, c.class_name].filter(Boolean).join(" · ") || "—"}</div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  )}

                  {m.stats && typeof m.stats.value !== "undefined" && (
                    <div className="rounded-md border bg-card p-3 text-xs">
                      <div className="text-muted-foreground">{m.stats.metric}</div>
                      <div className="mt-0.5 text-2xl font-bold">{m.stats.value}</div>
                    </div>
                  )}

                  {m.action?.type === "navigate" && m.action.payload?.path && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { navigate(m.action!.payload.path); setOpen(false); }}>
                      跳转 {m.action.payload.path} <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
              {loading && (
                <div className="self-start flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> 思考中…
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="例如：调出张三的档案 / 查看不合格学生"
                rows={2}
                className="min-h-[44px] resize-none text-sm"
                disabled={loading}
              />
              <Button size="icon" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">由国产大模型驱动 · 自动调用工具完成跳转和查询</p>
          </div>
        </TabsContent>

        <TabsContent value="quick" className="flex-1 overflow-auto m-0 mt-2 p-3 pt-0">
          <p className="mb-2 text-xs text-muted-foreground">点击下方卡片即可一键执行</p>
          <div className="grid grid-cols-1 gap-2">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q.label}
                onClick={() => sendMessage(q.prompt)}
                disabled={loading}
                className="group flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-muted/40 hover:shadow-sm disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{q.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{q.prompt}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StaffAiAssistant;