import { readFile } from "node:fs/promises";
import { safeStorage } from "electron";
import { join } from "node:path";
import type { AccountProfile } from "../../shared/types";
import { JsonStore } from "./json-store";

interface VaultPayload {
  kind: "oauth" | "api-key";
  authJson?: string;
  apiKey?: string;
}

interface VaultEntry {
  profile: AccountProfile;
  encrypted: string;
}

interface VaultData {
  activeId: string;
  entries: VaultEntry[];
  mcpSecrets?: Record<string, string>;
}

export class AccountVault {
  private readonly store: JsonStore<VaultData>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "account-vault.json"), { activeId: "", entries: [] });
  }

  async list(): Promise<AccountProfile[]> {
    const data = await this.store.get();
    return data.entries.map(({ profile }) => ({ ...profile, active: profile.id === data.activeId }));
  }

  async active(): Promise<{ profile: AccountProfile; payload: VaultPayload } | undefined> {
    const data = await this.store.get();
    const entry = data.entries.find((value) => value.profile.id === data.activeId);
    return entry ? { profile: { ...entry.profile, active: true }, payload: this.decrypt(entry.encrypted) } : undefined;
  }

  async get(id: string): Promise<{ profile: AccountProfile; payload: VaultPayload } | undefined> {
    const entry = (await this.store.get()).entries.find((value) => value.profile.id === id);
    return entry ? { profile: { ...entry.profile }, payload: this.decrypt(entry.encrypted) } : undefined;
  }

  async importAuthJson(authJson: string, makeActive = true): Promise<AccountProfile> {
    const identity = parseAuthIdentity(authJson);
    const now = new Date().toISOString();
    const profile: AccountProfile = {
      id: identity.id,
      label: identity.email || identity.name || "Grok OAuth 账号",
      email: identity.email,
      kind: "oauth",
      active: makeActive,
      createdAt: now,
      updatedAt: now,
    };
    const data = await this.store.get();
    const index = data.entries.findIndex((value) => value.profile.id === profile.id);
    if (index >= 0) {
      const existing = data.entries[index]!;
      profile.createdAt = existing.profile.createdAt;
      data.entries[index] = { profile, encrypted: this.encrypt({ kind: "oauth", authJson }) };
    } else data.entries.push({ profile, encrypted: this.encrypt({ kind: "oauth", authJson }) });
    if (makeActive) data.activeId = profile.id;
    await this.store.set(data);
    return profile;
  }

  async addApiKey(label: string, apiKey: string): Promise<AccountProfile> {
    const now = new Date().toISOString();
    const profile: AccountProfile = {
      id: `api-${crypto.randomUUID()}`,
      label: label.trim() || "xAI API Key",
      kind: "api-key",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const data = await this.store.get();
    data.entries.push({ profile, encrypted: this.encrypt({ kind: "api-key", apiKey }) });
    data.activeId = profile.id;
    await this.store.set(data);
    return profile;
  }

  async updateOAuth(id: string, authJson: string): Promise<void> {
    const data = await this.store.get();
    const entry = data.entries.find((value) => value.profile.id === id && value.profile.kind === "oauth");
    if (!entry) return;
    entry.encrypted = this.encrypt({ kind: "oauth", authJson });
    entry.profile.updatedAt = new Date().toISOString();
    await this.store.set(data);
  }

  async setActive(id: string): Promise<void> {
    const data = await this.store.get();
    if (!data.entries.some((value) => value.profile.id === id)) throw new Error("账号不存在");
    data.activeId = id;
    await this.store.set(data);
  }

  async clearActive(): Promise<void> {
    const data = await this.store.get();
    data.activeId = "";
    await this.store.set(data);
  }

  async remove(id: string): Promise<void> {
    const data = await this.store.get();
    data.entries = data.entries.filter((value) => value.profile.id !== id);
    if (data.activeId === id) data.activeId = "";
    await this.store.set(data);
  }

  async importFile(path: string): Promise<AccountProfile> {
    return this.importAuthJson(await readFile(path, "utf8"));
  }

  async setMcpSecrets(serverName: string, values: Record<string, string>): Promise<Record<string, string>> {
    const data = await this.store.get(); data.mcpSecrets ??= {};
    const names: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      const envName = `GROK_DESKTOP_MCP_${serverName}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      data.mcpSecrets[envName] = this.encrypt({ kind: "api-key", apiKey: value }); names[key] = envName;
    }
    await this.store.set(data); return names;
  }

  async mcpSecretEnvironment(): Promise<Record<string, string>> {
    const data = await this.store.get(); const output: Record<string, string> = {};
    for (const [name, encrypted] of Object.entries(data.mcpSecrets ?? {})) { const payload = this.decrypt(encrypted); if (payload.apiKey) output[name] = payload.apiKey; }
    return output;
  }

  async removeMcpSecrets(serverName: string): Promise<void> {
    const data = await this.store.get(); const prefix = `GROK_DESKTOP_MCP_${serverName}_`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    for (const name of Object.keys(data.mcpSecrets ?? {})) if (name.startsWith(prefix)) delete data.mcpSecrets![name];
    await this.store.set(data);
  }

  private encrypt(payload: VaultPayload): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 凭据加密当前不可用");
    return safeStorage.encryptString(JSON.stringify(payload)).toString("base64");
  }

  private decrypt(value: string): VaultPayload {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 凭据解密当前不可用");
    return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64"))) as VaultPayload;
  }
}

export function authJsonAccountId(raw: string): string | undefined {
  try { return parseAuthIdentity(raw).id; }
  catch { return undefined; }
}

function parseAuthIdentity(raw: string): { id: string; email?: string; name?: string } {
  const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  if (typeof (parsed as Record<string, unknown>).__id === "string") return { id: `oauth-${String((parsed as Record<string, unknown>).__id)}` };
  const container = Object.entries(parsed)[0];
  const key = container?.[0] || crypto.randomUUID();
  const identity = container?.[1] || {};
  const id = String(identity.user_id || identity.principal_id || key.split("::").at(-1) || crypto.randomUUID());
  const email = typeof identity.email === "string" ? identity.email : undefined;
  const name = [identity.first_name, identity.last_name].filter((value) => typeof value === "string").join(" ") || undefined;
  return { id: `oauth-${id}`, email, name };
}
