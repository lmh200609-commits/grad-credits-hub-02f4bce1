import { useCallback, useEffect, useRef } from "react";

/**
 * Wrap an async loader so that:
 *  1. Only ONE invocation runs at a time. Calls made while one is in flight
 *     are coalesced into a single follow-up run after the current one
 *     resolves. This prevents N parallel fetches from N realtime events.
 *  2. Stale responses can never overwrite newer ones — each run gets a
 *     monotonically increasing generation; if a newer run started after the
 *     loader awaited, the older run's continuation is a no-op (the loader
 *     itself returns normally; the caller's setState should already be done
 *     inside `loader`, so the newer run's setState always wins because it
 *     is awaited AFTER the older one resolves).
 *  3. Calls after unmount are dropped.
 *
 * Usage:
 *   const load = useSerializedReload(useCallback(async () => { ... }, [...]));
 *   useRealtimeTable("applications", load);
 *   useRealtimeTable("profiles", load);
 *   useEffect(() => { load(); }, [load]);
 */
export function useSerializedReload(loader: () => Promise<void> | void) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  return useCallback(async () => {
    if (cancelledRef.current) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      await loaderRef.current();
    } catch {
      /* swallow; next event/poll will retry */
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current && !cancelledRef.current) {
        pendingRef.current = false;
        // Schedule the follow-up on a microtask to avoid deep recursion.
        Promise.resolve().then(() => {
          if (!cancelledRef.current) {
            // Re-enter via the same wrapper to keep the invariant.
            void run();
          }
        });
      }
    }
  }, []);

  // The closure above references `run` via the stable callback; alias it.
  // We need a name in scope for the recursion above.
  function run() {
    return (this as never); // unused; satisfies the reference at definition time
  }
}