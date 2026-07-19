import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export interface RendererTrustPolicy {
  localEntryPath: string;
  developmentOrigin?: string;
}

export interface RendererFrameIdentity {
  expectedWebContentsId: number;
  senderWebContentsId: number;
  frameProcessId: number;
  frameRoutingId: number;
  mainFrameProcessId: number;
  mainFrameRoutingId: number;
  frameUrl: string;
}

/** Returns a normalized loopback development URL, or undefined for an unsafe target. */
export function trustedDevelopmentUrl(raw: string | undefined, packaged: boolean): string | undefined {
  if (packaged || !raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
    if (parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function createRendererTrustPolicy(localEntryPath: string, developmentUrl?: string): RendererTrustPolicy {
  let developmentOrigin: string | undefined;
  if (developmentUrl) {
    try {
      const parsed = new URL(developmentUrl);
      if (EXTERNAL_PROTOCOLS.has(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && !parsed.username && !parsed.password) {
        developmentOrigin = parsed.origin;
      }
    } catch {
      // The caller will fall back to the local renderer entry.
    }
  }
  return { localEntryPath: resolve(localEntryPath), developmentOrigin };
}

/** Allows only the packaged renderer file or the configured loopback dev-server origin. */
export function isTrustedRendererUrl(raw: string, policy: RendererTrustPolicy): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "file:") return samePath(fileURLToPath(parsed), policy.localEntryPath);
    return Boolean(policy.developmentOrigin && EXTERNAL_PROTOCOLS.has(parsed.protocol) && parsed.origin === policy.developmentOrigin);
  } catch {
    return false;
  }
}

/** Checks both BrowserWindow ownership and that the IPC originated in its top-level trusted frame. */
export function isTrustedRendererFrame(identity: RendererFrameIdentity, policy: RendererTrustPolicy): boolean {
  return identity.senderWebContentsId === identity.expectedWebContentsId
    && identity.frameProcessId === identity.mainFrameProcessId
    && identity.frameRoutingId === identity.mainFrameRoutingId
    && isTrustedRendererUrl(identity.frameUrl, policy);
}

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
