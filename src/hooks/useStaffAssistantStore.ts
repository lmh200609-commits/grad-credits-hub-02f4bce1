import { useSyncExternalStore } from "react";

export type Candidate = {
  user_id: string;
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  class_name: string | null;
};

export type Msg = {
  role: "user" | "assistant";
  content: string;
  candidates?: Candidate[] | null;
  stats?: any;
  action?: { type: string; payload: any } | null;
};

export const WELCOME: Msg = {
  role: "assistant",
  content:
    "你好，我是工作助手。可以用自然语言告诉我要做什么，例如：\n• 「查看不合格学生」\n• 「调出张三的档案」\n• 「打开复核中心」\n• 「本周通过了多少申请」",
};

type State = {
  open: boolean;
  tab: string;
  messages: Msg[];
  input: string;
};

const STORAGE_KEY = "staff-assistant-v1";
const MAX_MESSAGES = 50;

const loadPersisted = (): Pick<State, "messages" | "tab"> => {
  if (typeof window === "undefined") return { messages: [WELCOME], tab: "quick" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [WELCOME], tab: "quick" };
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed?.messages) && parsed.messages.length > 0 ? parsed.messages : [WELCOME];
    const tab = typeof parsed?.tab === "string" ? parsed.tab : "quick";
    return { messages, tab };
  } catch {
    return { messages: [WELCOME], tab: "quick" };
  }
};

const initial = loadPersisted();
let state: State = {
  open: false,
  tab: initial.tab,
  messages: initial.messages,
  input: "",
};

const listeners = new Set<() => void>();

const persist = () => {
  if (typeof window === "undefined") return;
  try {
    const trimmed = state.messages.slice(-MAX_MESSAGES);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: trimmed, tab: state.tab }),
    );
  } catch {
    // ignore
  }
};

const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const getSnapshot = () => state;

export const useStaffAssistantStore = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const staffAssistantActions = {
  setOpen: (open: boolean) => setState({ open }),
  setTab: (tab: string) => setState({ tab }),
  setInput: (input: string) => setState({ input }),
  setMessages: (updater: Msg[] | ((prev: Msg[]) => Msg[])) => {
    const next = typeof updater === "function" ? (updater as (p: Msg[]) => Msg[])(state.messages) : updater;
    setState({ messages: next });
  },
  clearMessages: () => setState({ messages: [WELCOME] }),
};