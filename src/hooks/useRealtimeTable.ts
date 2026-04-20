import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type Filter = { event?: "INSERT" | "UPDATE" | "DELETE" | "*"; filter?: string };

/**
 * Subscribe to postgres changes on a table and call `onChange` on each event.
 * If the realtime channel fails to subscribe, fall back to polling `onChange`
 * with a synthetic event every `pollMs` (default 30s).
 */
export function useRealtimeTable<T extends Record<string, unknown>>(
  table: string,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void,
  { event = "*", filter }: Filter = {},
  pollMs = 30000,
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        cbRef.current({ eventType: "POLL" } as unknown as RealtimePostgresChangesPayload<T>);
      }, pollMs);
    };
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    const channelName = `rt:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // @ts-expect-error supabase types are loose for postgres_changes
        "postgres_changes",
        { event, schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<T>) => cbRef.current(payload),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          stopPolling();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startPolling();
        }
      });

    return () => {
      stopPolling();
      supabase.removeChannel(channel);
    };
  }, [table, event, filter, pollMs]);
}
