import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { cacheRead, cacheWrite } from "./cache";
import type { useRemote } from "./use-remote";
import type { AutomationTask, AutomationRunRecord, BackgroundTaskSummary, NotificationInboxItem, AccountProfile } from "../../../src/shared/types";
import type { ImageWorkspace } from "../../../src/shared/image-workspace";

export interface Overview {
    tasks?: BackgroundTaskSummary[];
    automations?: AutomationTask[];
    runs?: AutomationRunRecord[];
    inbox?: NotificationInboxItem[];
    images?: ImageWorkspace;
    accounts?: AccountProfile[];
    errors?: string[];
    serverTime?: number;
}

/** Keep polling, manual refresh and late cache reads bound to one connection. */
export function useOverview(client: ReturnType<typeof useRemote>) {
    const [value, setValue] = useState<Overview>(), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const host = client.host;
    const identity = host ? JSON.stringify([host.fingerprint, host.id, host.host, host.token]) : "";
    const owner = useRef(identity), mounted = useRef(false);
    owner.current = identity;
    const flight = useRef<{ identity: string; promise: Promise<void> } | undefined>(undefined);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const refresh = useCallback((): Promise<void> => {
        if (!host || !mounted.current || owner.current !== identity) return Promise.resolve();
        if (flight.current?.identity === identity) return flight.current.promise;
        const current = () => mounted.current && owner.current === identity;
        const promise = (async () => {
            try {
                const result = await client.query<Overview>("overview");
                if (!current()) return;
                setValue(result);
                setError("");
                void cacheWrite(host.fingerprint + ":overview", result).catch(() => undefined);
            } catch (e) {
                if (current()) setError(e instanceof Error ? e.message : String(e));
            } finally {
                if (current()) setLoading(false);
            }
        })();
        flight.current = { identity, promise };
        void promise.finally(() => { if (flight.current?.promise === promise) flight.current = undefined; });
        return promise;
    }, [identity, client.query]);
    useEffect(() => {
        let active = true;
        setValue(undefined); setError(""); setLoading(Boolean(host));
        if (!host) return;
        void cacheRead<Overview>(host.fingerprint + ":overview").then(cached => {
            if (active && owner.current === identity && cached) setValue(previous => previous ?? cached.value);
        }).catch(() => undefined);
        const read = () => { if (AppState.currentState === "active" || AppState.currentState == null) void refresh(); };
        read();
        const timer = setInterval(read, 5000);
        const sub = AppState.addEventListener("change", state => { if (state === "active") read(); });
        return () => { active = false; clearInterval(timer); sub.remove(); };
    }, [identity, refresh]);
    return { value, loading, error, refresh };
}
