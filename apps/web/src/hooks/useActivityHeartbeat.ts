import { useEffect } from "react";
import { recordActivityHeartbeat } from "../api";
import type { ActivityType } from "../types";

// Activity time tracking (11 September 2026) - see routes/metrics.ts and
// apps/api/drizzle/0026_add_activity_tracking.sql for the full picture.
// Pings the server every ~30s while the screen using this hook is
// mounted and the tab is in the foreground - "idle" is interpreted as
// tab visibility only (the Page Visibility API), not true mouse/keyboard
// inactivity, per the confirmed scoping decision. No shared layout exists
// to hook this in centrally (Layout.tsx is dead code - every screen
// fetches its own data independently), so this is called once per
// relevant screen (Quiz/Arcade/StudyBuddy/SubjectPicker), not once
// globally.
const HEARTBEAT_INTERVAL_MS = 30_000;

export function useActivityHeartbeat(params: {
  activityType: ActivityType;
  subjectId?: string;
  classId?: string;
  topic?: string;
  gameKey?: string;
  quizAttemptId?: string;
  tutorConversationId?: string;
  // Lets a caller pause pinging without unmounting the hook - e.g.
  // StudyBuddy.tsx before a conversation exists yet, or SubjectPicker.tsx
  // once quest/practice/games mode is entered (so the same minute is
  // never double-counted under two activity types). Defaults to true.
  enabled?: boolean;
}) {
  const { activityType, subjectId, classId, topic, gameKey, quizAttemptId, tutorConversationId, enabled = true } = params;

  useEffect(() => {
    if (!enabled) return;

    function ping() {
      // Tab hidden/backgrounded - skip this tick entirely rather than
      // recording a heartbeat for time the child wasn't actually looking
      // at the screen.
      if (document.hidden) return;
      recordActivityHeartbeat({ activityType, subjectId, classId, topic, gameKey, quizAttemptId, tutorConversationId });
    }

    ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activityType, subjectId, classId, topic, gameKey, quizAttemptId, tutorConversationId]);
}
