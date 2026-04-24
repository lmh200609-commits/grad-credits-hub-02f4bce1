import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { CheckCircle2, BookOpen, Lightbulb, ArrowRightCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeMarkdown } from "@/lib/sanitizeMarkdown";

export type Section = {
  key: "conclusion" | "evidence" | "supplement" | "action" | "summary" | string;
  title: string;
  body: string;
};

type Props = {
  content: string;
  sections?: Section[] | null;
  polished?: boolean;
  variant?: "user" | "assistant";
  className?: string;
};

const SECTION_META: Record<string, { icon: any; tone: string }> = {
  conclusion: { icon: CheckCircle2, tone: "text-primary" },
  evidence: { icon: BookOpen, tone: "text-blue-600 dark:text-blue-400" },
  supplement: { icon: Lightbulb, tone: "text-amber-600 dark:text-amber-400" },
  action: { icon: ArrowRightCircle, tone: "text-emerald-600 dark:text-emerald-400" },
  summary: { icon: Sparkles, tone: "text-primary" },
};

const Markdown = ({ children }: { children: string }) => (
  <div
    className={cn(
      "prose prose-sm max-w-none dark:prose-invert",
      "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5",
      "prose-headings:text-[13px] prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-2 prose-headings:mb-1",
      "prose-table:my-2 prose-table:text-xs prose-th:bg-muted prose-th:font-medium prose-td:px-2 prose-th:px-2 prose-td:py-1 prose-th:py-1",
      "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none",
      "prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-3 prose-blockquote:text-muted-foreground prose-blockquote:not-italic",
      "prose-hr:my-2 prose-strong:text-foreground",
    )}
  >
    <div className="overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  </div>
);

export const AssistantMessage = ({ content, sections, polished, variant = "assistant", className }: Props) => {
  const cleaned = sanitizeMarkdown(content || "");

  if (variant === "user") {
    return (
      <div className={cn("whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground", className)}>
        {content}
      </div>
    );
  }

  const hasSections = Array.isArray(sections) && sections.length > 0;

  return (
    <div className={cn("flex w-full max-w-[92%] flex-col gap-2", className)}>
      {hasSections ? (
        sections!.map((sec, i) => {
          const meta = SECTION_META[sec.key] || SECTION_META.summary;
          const Icon = meta.icon;
          return (
            <div key={i} className="rounded-lg border bg-card px-3 py-2 shadow-sm">
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </span>
              </div>
              <Markdown>{sanitizeMarkdown(sec.body) || "—"}</Markdown>
            </div>
          );
        })
      ) : (
        <div className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
          <Markdown>{cleaned || "（无内容）"}</Markdown>
        </div>
      )}
      {polished && (
        <div className="flex items-center gap-1 self-start text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>已自动整理排版</span>
        </div>
      )}
    </div>
  );
};

export default AssistantMessage;
