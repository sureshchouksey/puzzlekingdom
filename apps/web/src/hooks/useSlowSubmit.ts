import { useCallback, useEffect, useRef, useState } from "react";

// Render's free-tier API instance sleeps after ~15 minutes idle and takes
// 30-60+ seconds to wake back up on the next request (see
// plan/MVP1-Content-to-Quiz-Plan.md, "Render free-tier cold starts").
// Gate.tsx already stopped this from blocking the app's first paint, but
// individual actions that actually need the API - like Welcome.tsx's
// "Continue" button on the very first request of a visit - still just sit
// on a bare "..." for up to a minute with no explanation, which reads as
// the app being frozen rather than loading (reported production
// complaint, 11 September 2026).
//
// This hook flips `slow` to true only if a request is STILL in flight
// after `delayMs` - a fast/warm request never shows anything extra, and
// only a genuinely slow (likely cold-starting) one gets an explanatory
// "waking up" message instead of looking stuck. Call start() right before
// the request and stop() in a `finally` once it settles.
export function useSlowSubmit(delayMs = 3500) {
  const [slow, setSlow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setSlow(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSlow(true), delayMs);
  }, [delayMs]);

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setSlow(false);
  }, []);

  // Belt-and-braces cleanup if the component unmounts mid-request (e.g.
  // the user navigates away while the kingdom is still waking up).
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { slow, start, stop };
}
