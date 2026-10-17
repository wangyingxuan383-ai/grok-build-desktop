import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeRunSnapshot } from "../../../shared/native-runs";

/**
 * Goals/workflows for one session, or all sessions when `sessionId` is omitted.
 * Refreshes on the session events that can change state or available actions;
 * no timer, and reading never starts a CLI.
 */
export function useNativeRuns(sessionId?: string, enabled = true): { rows: NativeRunSnapshot[]; refresh(): Promise<void> } {
  const [rows, setRows] = useState<NativeRunSnapshot[]>([]);
  const epoch = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++epoch.current;
    const next = await window.grokDesktop.listNativeRuns?.(sessionId).catch(() => undefined);
    if (next && current === epoch.current) setRows(next);
  }, [sessionId]);
  useEffect(() => {
    setRows([]);
    if (!enabled) return;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.grokDesktop.onEvent((event) => {
      if (event.type !== "runtime-update" && event.type !== "session-reset" && event.type !== "status") return;
      if (sessionId && event.sessionId !== sessionId) return;
      timer ??= setTimeout(() => { timer = undefined; void refresh(); }, 200);
    });
    return () => { off(); if (timer) clearTimeout(timer); epoch.current++; };
  }, [enabled, refresh, sessionId]);
  return { rows, refresh };
}
