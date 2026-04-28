import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type Filter = {
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /**
   * Server-side row filter, e.g. `student_id=eq.<uuid>`.
   *
   * Three states:
   *  - omitted (key not present): subscribe to the whole table
   *  - a non-empty string: subscribe with that filter
   *  - explicitly `null` / `undefined` / `""`: SKIP subscription entirely
   *    (use this to avoid a brief full-table window while you wait for
   *    auth / route params to load).
   */
  filter?: string | null;
};

/**
 * Subscribe to postgres changes on a table and call `onChange` on each event.
 *
 * Resilience:
 * - On CHANNEL_ERROR / TIMED_OUT / CLOSED, falls back to polling every
 *   `pollMs` (default 10s) AND tries to reconnect with exponential backoff
 *   (2s → 4s → 8s, capped at 30s).
 * - Re-entrancy guard: if `onChange` returns a Promise and another event
 *   arrives while it is still running, the hook coalesces all intermediate
 *   events into a SINGLE follow-up call after the in-flight one resolves.
 *   This guarantees:
 *     • the same DB change never triggers two parallel reloads
 *     • events that arrive during a slow reload are not lost
 *   A small 50ms leading-edge debounce still groups true bursts (e.g.
 *   trigger cascades that fire several rows in the same tick).
 * - On successful (re)connect we ALWAYS issue one reload to catch up on
 *   anything that happened while the channel was down (Realtime does not
 *   replay missed events).
 */
export function useRealtimeTable<T extends Record<string, unknown>>(
  table: string,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void | Promise<void>,
  options: Filter = {},
  pollMs = 10000,
) {
  const { event = "*", filter } = options;
  // When the caller explicitly passed the `filter` key but its value is
  // empty (auth not ready yet, etc.), do NOT subscribe — otherwise we'd
  // briefly listen to the whole table.
  const filterKeyProvided = Object.prototype.hasOwnProperty.call(options, "filter");
  const skip = filterKeyProvided && (filter === null || filter === undefined || filter === "");

  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (skip) return;

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;

    // Re-entrancy guard:
    //   inFlight   – a reload is currently running
    //   pending    – at least one event arrived while inFlight; run once more
    //   lastPayload – payload to hand to the coalesced follow-up call
    let inFlight = false;
    let pending = false;
    let lastPayload: RealtimePostgresChangesPayload<T> | null = null;

    const runOnce = async (payload: RealtimePostgresChangesPayload<T>) => {
      if (cancelled) return;
      inFlight = true;
      try {
        await cbRef.current(payload);
      } catch {
        /* swallow – next event or the polling tick will retry */
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          const next = lastPayload ?? ({ eventType: "POLL" } as unknown as RealtimePostgresChangesPayload<T>);
          lastPayload = null;
          // Fire-and-forget; chained reloads keep the in-flight invariant.
          void runOnce(next);
        }
      }
    };

    const fire = (payload: RealtimePostgresChangesPayload<T>) => {
      if (cancelled) return;
      // Always remember the latest payload so coalesced follow-ups carry it.
      lastPayload = payload;
      if (inFlight) {
        // A reload is running; mark that we need to run again afterwards.
        pending = true;
        return;
      }
      // Leading-edge micro-debounce so a burst of events in the same tick
      // (e.g. several rows from one trigger) collapses into one reload.
      if (burstTimer) return;
      burstTimer = setTimeout(() => {
        burstTimer = null;
        const p = lastPayload ?? payload;
        lastPayload = null;
        void runOnce(p);
      }, 50);
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
            // Catch up on anything missed while the channel was down.
            // (Supabase Realtime does not replay events.)
            fire({ eventType: "RECONNECT" } as unknown as RealtimePostgresChangesPayload<T>);
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
      if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
        currentChannel = null;
      }
    };
  }, [table, event, filter, pollMs, skip]);
}
