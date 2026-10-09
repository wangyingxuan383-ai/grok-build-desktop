import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as FS from "expo-file-system/legacy";
import { api, downloadAsset, wifiAvailable } from "./transport";
import { createRequestQueue, CancelledError, PRIORITY, type Priority } from "./request-queue";
import { trackTransfer, transfersSnapshot } from "./transfers";
import type { RemoteAsset } from "./workbench";
import type { useRemote } from "./use-remote";
type Client = ReturnType<typeof useRemote>;

export { PRIORITY, type Priority };
export interface CachedFile { uri: string; asset?: RemoteAsset }

/**
 * One cache for every remote picture (gallery tiles, viewer, result cards).
 *
 * A file counts as cached only when its ".json" sidecar exists: the sidecar is written after
 * the native download has verified the byte count and atomically renamed its ".part" file,
 * so an interrupted download can never be mistaken for a picture. Reads go through one
 * prioritised queue: what the user opened beats visible thumbnails, which beat prefetch.
 */
const queue = createRequestQueue(3);
let prefetchWifiOnly = true;
export function setPrefetchWifiOnly(value: boolean) { prefetchWifiOnly = value; }

async function cachePath(fingerprint: string, source: string, variant: "thumbnail" | "original") {
    const target = new URL(source);
    if (variant === "thumbnail") target.searchParams.set("variant", "thumbnail");
    const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fingerprint + ":" + target.href);
    return { href: target.href, path: FS.cacheDirectory + (variant === "thumbnail" ? "grok-thumb-" : "grok-full-") + identity + (variant === "thumbnail" ? ".jpg" : "") };
}

async function complete(path: string): Promise<RemoteAsset | null | undefined> {
    const [file, meta] = await Promise.all([FS.getInfoAsync(path), FS.getInfoAsync(path + ".json")]);
    if (!file.exists || !("size" in file) || !file.size || !meta.exists) return undefined;
    return FS.readAsStringAsync(path + ".json").then(text => {
        const asset = JSON.parse(text) as RemoteAsset | null;
        return asset && typeof asset.name === "string" && typeof asset.ticket === "string" ? asset : undefined;
    }).catch(() => undefined);
}

/** Removes a cached picture, e.g. after it failed to decode, so the next read downloads it again. */
export async function invalidateCached(uri: string) {
    const path = uri.replace(/\.json$/, "");
    await Promise.all([FS.deleteAsync(path, { idempotent: true }), FS.deleteAsync(path + ".json", { idempotent: true })]).catch(() => undefined);
}

export function requestCached(client: Client, source: string, variant: "thumbnail" | "original", priority: Priority = PRIORITY.visible, retry = false) {
    const host = client.host;
    if (!host || !FS.cacheDirectory) return { promise: Promise.reject(Error("本机缓存或电脑连接不可用")) as Promise<CachedFile>, cancel: () => undefined };
    const key = host.fingerprint + "|" + variant + "|" + source;
    const label = (variant === "original" ? "原图" : "缩略图") + (sourceName(source) ? " · " + sourceName(source) : "");
    const run = async (): Promise<CachedFile> => {
        const { href, path } = await cachePath(host.fingerprint, source, variant);
        if (retry) await invalidateCached(path);
        const cached = await complete(path);
        if (cached !== undefined) return { uri: path, asset: cached ?? undefined };
        if (variant === "original" && priority === PRIORITY.prefetch && prefetchWifiOnly && Platform.OS === "android" && !(await wifiAvailable())) throw new CancelledError();
        if (variant === "original") trackTransfer(path, variant, label, "running");
        try {
            // Bind both metadata and bytes to the same captured computer, even if the UI switches.
            const asset = await api<RemoteAsset>(host, `/v1/workbench?kind=media&source=${encodeURIComponent(href)}`);
            const uri = await downloadAsset(host, `/v1/preview/${asset.ticket}/file`, path);
            await FS.writeAsStringAsync(path + ".json", JSON.stringify(asset));
            if (variant === "original") trackTransfer(path, variant, label, "done");
            return { uri, asset };
        } catch (error) {
            const cancelled = transfersSnapshot().some(item => item.id === path && item.state === "cancelled");
            trackTransfer(path, variant, `${host.name} · ${label}`, cancelled ? "cancelled" : "failed", cancelled ? undefined : error instanceof Error ? error.message : String(error), () => { void requestCached(client, source, variant, PRIORITY.user, true).promise.catch(() => undefined); });
            throw error;
        }
    };
    return queue.request(key, priority, run);
}

/** Convenience for one-off actions (save, share); never cancelled. */
export function cachedFile(client: Client, source: string, variant: "thumbnail" | "original", retry = false) {
    return requestCached(client, source, variant, PRIORITY.user, retry).promise;
}

/**
 * Picture for a list cell or viewer page. `enabled` lets lists skip cells outside the
 * viewport; leaving the screen or scrolling away cancels reads that have not started.
 */
export function useCachedImage(client: Client, source: string, variant: "thumbnail" | "original", options: { priority?: Priority; enabled?: boolean; retry?: number } = {}) {
    const { priority = PRIORITY.visible, enabled = true, retry = 0 } = options;
    const owner = [client.host?.fingerprint, client.host?.host, source, variant].join("|");
    const [state, setState] = useState<{ owner: string; uri: string; asset?: RemoteAsset; error: string }>({ owner, uri: "", error: "" });
    useEffect(() => {
        setState({ owner, uri: "", error: "" });
        if (!client.host || !enabled || !source) return;
        const ticket = requestCached(client, source, variant, priority, retry > 0);
        let disposed = false;
        ticket.promise.then(
            value => { if (!disposed) setState({ owner, uri: value.uri, asset: value.asset, error: "" }); },
            error => { if (!disposed && !(error instanceof CancelledError)) setState({ owner, uri: "", error: error instanceof Error ? error.message : String(error) }); },
        );
        return () => { disposed = true; ticket.cancel(); };
    }, [client.host?.fingerprint, client.host?.host, source, variant, enabled, retry, priority]);
    return state.owner === owner && enabled ? state : { uri: "", error: "" };
}

export function useThumbnail(client: Client, source: string, retry = 0, enabled = true) {
    return useCachedImage(client, source, "thumbnail", { retry, enabled });
}

/** Short file name for transfer rows; the source is a computer path or media URL. */
function sourceName(source: string) {
    let tail = (source.split(/[?#]/)[0] || "").split(/[\\/]/).pop() || "";
    try { tail = decodeURIComponent(tail); } catch { /* keep raw */ }
    return tail.length > 40 ? tail.slice(0, 18) + "…" + tail.slice(-18) : tail;
}
