import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UI_METADATA = [
  "settings.json",
  "session-metadata.json",
  "workspace-metadata.json",
  "ui-state.json",
  "codex-metadata.json",
  "computer-use-settings.json",
  "onboarding.json",
];

export async function backupUiMetadataForVersion(userDataPath: string, version: string): Promise<string | undefined> {
  const marker = join(userDataPath, "migration-state.json");
  const previous: { version?: string } = await readFile(marker, "utf8").then((value) => JSON.parse(value) as { version?: string }).catch(() => ({}));
  if (previous.version === version) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(userDataPath, "backups", `ui-metadata-${stamp}`);
  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const name of UI_METADATA) {
    await cp(join(userDataPath, name), join(target, name), { force: false }).then(() => { copied++; }).catch(() => undefined);
  }
  await writeFile(marker, `${JSON.stringify({ version, migratedAt: new Date().toISOString(), backup: copied ? target : undefined }, null, 2)}\n`, "utf8");
  return copied ? target : undefined;
}
