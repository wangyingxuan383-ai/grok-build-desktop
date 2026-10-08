export interface DraftOwner {
  id: string;
  fingerprint: string;
}
export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
export const draftKey = (owner: DraftOwner, sessionId: string) =>
  `grok.remote.computer.${owner.fingerprint}.draft.${sessionId}`;
export const legacyDraftKey = (owner: DraftOwner, sessionId: string) =>
  `grok.remote.${owner.id}.draft.${sessionId}`;
/** Reading never writes: a delayed legacy read must not overwrite a newer edit. */
export async function readDraft(
  storage: Pick<DraftStorage, "getItem">,
  owner: DraftOwner,
  sessionId: string,
): Promise<string | null> {
  const value = await storage.getItem(draftKey(owner, sessionId));
  return value !== null
    ? value
    : storage.getItem(legacyDraftKey(owner, sessionId));
}
/** Keep drafts readable after re-pairing while receipts remain scoped to the original device. */
export async function preservePairingDrafts(
  storage: DraftStorage,
  owner: DraftOwner,
): Promise<void> {
  const prefix = `grok.remote.${owner.id}.draft.`;
  for (const key of (await storage.getAllKeys()).filter((key) =>
    key.startsWith(prefix),
  )) {
    const next = draftKey(owner, key.slice(prefix.length));
    if ((await storage.getItem(next)) !== null) continue;
    const value = await storage.getItem(key);
    if (value !== null) await storage.setItem(next, value);
  }
}
