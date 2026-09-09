import { useCallback, useRef, useState } from "react";
import { updateSessionSubmissions } from "../session-submission-state";

/**
 * Owns the Renderer-only submission locks by conversation. Transport and
 * persistence stay in the main process; background sessions cannot turn the
 * currently visible Composer into a global busy state.
 */
export function useSubmissionController(): {
  sendingSessionIds: ReadonlySet<string>;
  sendingSessionIdsRef: React.RefObject<ReadonlySet<string>>;
  updateSendingSessions(keys: Iterable<string>, active: boolean): void;
} {
  const [sendingSessionIds, setSendingSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const sendingSessionIdsRef = useRef<ReadonlySet<string>>(new Set());
  const updateSendingSessions = useCallback((keys: Iterable<string>, active: boolean): void => {
    const next = updateSessionSubmissions(sendingSessionIdsRef.current, keys, active);
    sendingSessionIdsRef.current = next;
    setSendingSessionIds(next);
  }, []);
  return { sendingSessionIds, sendingSessionIdsRef, updateSendingSessions };
}
