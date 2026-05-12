import { useSyncExternalStore } from "react";

import type { Section } from "@/components/AssistantMessage";

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
  sections?: Section[] | null;
  polished?: boolean;
};

export const WELCOME: Msg = {
  role: "assistant",
  content:
    "你好，我是工作助手。可以用自然语言告诉我要做什么，例如：\n• 「查看不合格学生」\n• 「调出张三的档案」\n• 「打开复核中心」\n• 「本周通过了多少申请」",
};

type State = {
  open: boolean;
  messages: Msg[];
  input: string;
};

const STORAGE_PREFIX = "staff-assistant-v1";
const LEGACY_KEY = "staff-assistant-v1";
const MAX_MESSAGES = 50;

let currentUserId: string | null = null;
const keyFor = (uid: string | null) => `${STORAGE_PREFIX}:${uid ?? "anon"}`;

// One-time cleanup of legacy unscoped key so it can't leak across accounts.
if (typeof window !== "undefined") {
  try {
    if (window.localStorage.getItem(LEGACY_KEY) !== null
        && !LEGACY_KEY.includes(":")) {
      window.localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // ignore
  }
}

const loadPersisted = (uid: string | null): Pick<State, "messages"> => {
  if (typeof window === "undefined") return { messages: [WELCOME] };
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return { messages: [WELCOME] };
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed?.messages) && parsed.messages.length > 0 ? parsed.messages : [WELCOME];
    return { messages };
  } catch {
    return { messages: [WELCOME] };
  }
};

const initial = loadPersisted(currentUserId);
let state: State = {
  open: false,
  messages: initial.messages,
  input: "",
};

const listeners = new Set<() => void>();

const persist = () => {
  if (typeof window === "undefined") return;
  try {
    const trimmed = state.messages.slice(-MAX_MESSAGES);
    window.localStorage.setItem(
      keyFor(currentUserId),
      JSON.stringify({ messages: trimmed }),
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
  setInput: (input: string) => setState({ input }),
  setMessages: (updater: Msg[] | ((prev: Msg[]) => Msg[])) => {
    const next = typeof updater === "function" ? (updater as (p: Msg[]) => Msg[])(state.messages) : updater;
    setState({ messages: next });
  },
  clearMessages: () => setState({ messages: [WELCOME] }),
};

/**
 * Switch the storage scope to the given user. Called by the auth layer on
 * sign-in / sign-out so chat history is never shared across accounts on the
 * same browser.
 */
export const setStaffAssistantUser = (userId: string | null) => {
  if (currentUserId === userId) return;
  currentUserId = userId;
  const { messages } = loadPersisted(userId);
  state = { open: false, input: "", messages };
  listeners.forEach((l) => l());
};