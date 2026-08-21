import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CustomProviderProfile } from "../../shared/types";
import { JsonStore } from "./json-store";

interface ProviderBackupState {
  version: 1;
  updatedAt: string;
  payloadHash: string;
  providers: CustomProviderProfile[];
}

interface ProviderIdentityAnchor {
  id: string;
  endpoint: string;
  protocol: string;
  upstreamProtocol: string;
  schemaProfile: string;
  identityHash: string;
}

interface ProviderAnchorState {
  version: 1;
  updatedAt: string;
  payloadHash: string;
  identities: ProviderIdentityAnchor[];
}

const EMPTY_BACKUP: ProviderBackupState = { version: 1, updatedAt: "", payloadHash: "", providers: [] };
const EMPTY_ANCHORS: ProviderAnchorState = { version: 1, updatedAt: "", payloadHash: "", identities: [] };

/** Last-known-good Provider index guarded by a separately persisted identity anchor. */
export class ProviderProfileRecoveryStore {
  private readonly backup: JsonStore<ProviderBackupState>;
  private readonly anchors: JsonStore<ProviderAnchorState>;

  constructor(private readonly userDataPath: string) {
    this.backup = new JsonStore(join(userDataPath, "providers.last-known-good.json"), EMPTY_BACKUP);
    this.anchors = new JsonStore(join(userDataPath, "provider-identity-anchors.json"), EMPTY_ANCHORS);
  }

  async save(providers: CustomProviderProfile[]): Promise<void> {
    const cloned = structuredClone(providers);
    const updatedAt = new Date().toISOString();
    const payloadHash = hashPayload(cloned);
    const identities = cloned.map(identityAnchor).sort((left, right) => left.id.localeCompare(right.id));
    // Write the candidate first and the independent matching anchor last. A
    // crash between the two leaves a mismatch and therefore cannot restore.
    await this.backup.set({ version: 1, updatedAt, payloadHash, providers: cloned });
    await this.anchors.set({ version: 1, updatedAt, payloadHash, identities });
  }

  async recoverIfEligible(current: CustomProviderProfile[]): Promise<CustomProviderProfile[] | undefined> {
    // Recovery is never allowed to overwrite a readable primary index.
    if (current.length) return undefined;
    if (!(await this.hasCorruptPrimaryEvidence())) return undefined;
    const [backup, anchors] = await Promise.all([this.backup.get(), this.anchors.get()]);
    if (!backup.providers.length || !backup.payloadHash || backup.payloadHash !== anchors.payloadHash) return undefined;
    if (hashPayload(backup.providers) !== backup.payloadHash) return undefined;
    const expected = anchors.identities.slice().sort((left, right) => left.id.localeCompare(right.id));
    const actual = backup.providers.map(identityAnchor).sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return undefined;
    return structuredClone(backup.providers);
  }

  private async hasCorruptPrimaryEvidence(): Promise<boolean> {
    const entries = await readdir(this.userDataPath).catch(() => []);
    const candidates = entries.filter((name) => /^providers\.json\.corrupt-\d+-[0-9a-f-]+\.bak$/i.test(name));
    const recent = await Promise.all(candidates.map(async (name) => ({ name, info: await stat(join(this.userDataPath, name)).catch(() => undefined) })));
    return recent.some((entry) => entry.info?.isFile());
  }
}

function identityAnchor(provider: CustomProviderProfile): ProviderIdentityAnchor {
  const endpoint = canonicalEndpoint(provider.baseUrl);
  const identity = [provider.id, endpoint, provider.protocol, provider.upstreamProtocol ?? "", provider.schemaProfile ?? "standard"].join("\0");
  return {
    id: provider.id,
    endpoint,
    protocol: provider.protocol,
    upstreamProtocol: provider.upstreamProtocol ?? "",
    schemaProfile: provider.schemaProfile ?? "standard",
    identityHash: createHash("sha256").update(identity).digest("hex"),
  };
}

function canonicalEndpoint(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("含内嵌凭据的旧 Provider 地址不能进入自动恢复备份");
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function hashPayload(providers: CustomProviderProfile[]): string {
  return createHash("sha256").update(JSON.stringify(providers)).digest("hex");
}
