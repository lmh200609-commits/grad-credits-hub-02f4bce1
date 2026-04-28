import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type Filter = { event?: "INSERT" | "UPDATE" | "DELETE" | "*"; filter?: string };

/**
 * Subscribe to postgres changes on a table and call `onChange` on each event.
 *
 * Resilience:
 * - On CHANNEL_ERROR / TIMED_OUT / CLOSED, falls back to polling every
 *   `pollMs` (default 10s) AND tries to reconnect with exponential backoff
 *   (2s → 4s → 8s, capped at 30s).
 * - Calls to `onChange` are debounced by 300ms to coalesce bursts of events.
 */
export function useRealtimeTable<T extends Record<string, unknown>>(
  table: string,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void,
  { event = "*", filter }: Filter = {},
  pollMs = 10000,
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;

    const fire = (payload: RealtimePostgresChangesPayload<T>) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        cbRef.current(payload);
      }, 300);
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        fire({ eventType: "POLL" } as unknown as RealtimePostgresChangesPayload<T>);
      }, pollMs);
    };
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const delay = Math.min(2000 * 2 ** attempt, 30000);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      // Tear down previous channel (if any) before creating a new one.
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
        currentChannel = null;
      }
      const channelName = `rt:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`;
      currentChannel = supabase
        .channel(channelName)
        .on(
          "postgres_changes" as never,
          { event, schema: "public", table, ...(filter ? { filter } : {}) },
          (payload: RealtimePostgresChangesPayload<T>) => fire(payload),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            attempt = 0;
            stopPolling();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            startPolling();
            scheduleReconnect();
          }
        });
    };

    connect();

    return () => {
      cancelled = true;
      stopPolling();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
        currentChannel = null;
      }
    };
  }, [table, event, filter, pollMs]);
}
