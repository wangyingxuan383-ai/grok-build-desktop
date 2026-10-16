import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "../store";
import { SessionContextCache } from "../session-context-cache";
const cache = new SessionContextCache();
const load = (id: string) => window.grokDesktop.getCliSessionInfo(id);

export function useSessionContext(sessionId?: string) {
  const revision = useAppStore(state => {
    const view = sessionId ? state.views[sessionId] : undefined;
    return `${view?.hydrationGeneration ?? 0}:${view?.contextRevision ?? 0}`;
  });
  const info = useSyncExternalStore(cache.subscribe, () => sessionId ? cache.get(sessionId, revision) : undefined);
  useEffect(() => { if (sessionId) void cache.read(sessionId, revision, load); }, [sessionId, revision]);
  const refresh = useCallback((force = true) => sessionId ? cache.read(sessionId, revision, load, force) : Promise.resolve(), [sessionId, revision]);
  return { info, refresh };
}
