import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const WELCOME: Msg = {
  role: "assistant",
  content:
    "您好，我是学分规则助手。可以问我「XX 证书/比赛能认定多少学分」等问题。\n我只依据规则库与案例库做解释，不做最终审批。",
};

const AiAssistant = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      // strip welcome message before sending; cap to last 20
      const history = next.filter((m) => m !== WELCOME).slice(-20);
      const { data, error } = await supabase.functions.invoke("ask-credit-assistant", {
        body: { messages: history },
      });
      if (error) throw error;
      const answer = (data as any)?.answer || "（暂无回答）";
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
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
      send();
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="打开学分规则助手"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[calc(100vw-2rem)] max-w-[380px] flex-col rounded-xl border bg-background shadow-2xl sm:w-[380px]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">学分规则助手</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-muted text-foreground",
              )}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="self-start flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 检索规则中…
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
            placeholder="例如：全国大学生英语竞赛三等奖能认定几个学分？"
            rows={2}
            className="min-h-[44px] resize-none text-sm"
            disabled={loading}
          />
          <Button size="icon" onClick={send} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">仅供参考，不代表最终认定结果</p>
      </div>
    </div>
  );
};

export default AiAssistant;