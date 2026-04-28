import { useCallback, useEffect, useRef } from "react";

/**
 * Wrap an async loader so that:
 *  1. Only ONE invocation runs at a time. Calls made while one is in flight
 *     are coalesced into a SINGLE follow-up run after the current one
 *     resolves. This prevents N parallel fetches when several realtime
 *     subscriptions (e.g. one for `applications`, one for `profiles`) all
 *     point at the same loader.
 *  2. Stale responses cannot overwrite newer ones, because the follow-up
 *     run is only started AFTER the previous one's setState has already
 *     been applied — so the latest run is always the latest write.
 *  3. Calls after unmount are dropped.
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

  const run = useCallback(async function run(): Promise<void> {
    if (cancelledRef.current) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      await loaderRef.current();
    } catch {
      /* swallow; next realtime event or poll tick will retry */
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current && !cancelledRef.current) {
        pendingRef.current = false;
        // Defer to a microtask to avoid deep recursion on busy bursts.
        void Promise.resolve().then(run);
      }
    }
  }, []);

  return run;
}