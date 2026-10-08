import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const directory = resolve(process.argv[2] || "release");
const mobile = JSON.parse(await readFile(new URL("../apps/mobile/app.json", import.meta.url), "utf8")).expo;
const name = `Grok-Remote-v${mobile.version}.apk`;
const evidence = JSON.parse(await readFile(join(directory, `Grok-Remote-v${mobile.version}-build.json`), "utf8"));
if (evidence.apk !== name || evidence.packageName !== mobile.android.package || evidence.version !== mobile.version || evidence.versionCode !== mobile.android.versionCode) throw Error("Companion release identity does not match source");
if (!/^[0-9a-f]{40}$/i.test(evidence.sourceCommit || "")) throw Error("Companion source commit is invalid");
if (process.env.GITHUB_BUILD_COMMIT && evidence.sourceCommit !== process.env.GITHUB_BUILD_COMMIT) {
  const expected = process.env.GITHUB_BUILD_COMMIT;
  if (!/^[0-9a-f]{40}$/i.test(expected)) throw Error("Release source commit is invalid");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const tree = (commit, path) => {
    const result = spawnSync("git", ["-C", root, "rev-parse", "--verify", `${commit}:${path}`], { encoding: "utf8" });
    if (result.status !== 0) throw Error("Companion source history is unavailable; fetch full history before verification");
    return result.stdout.trim();
  };
  for (const path of ["apps/mobile", "src/shared"]) if (tree(evidence.sourceCommit, path) !== tree(expected, path)) throw Error(`Companion sources changed (${path}); stage a new signed APK before publishing`);
  console.log("Reusing signed companion with identical mobile and shared source trees");
}
const bytes = await readFile(join(directory, name));
if (bytes.length !== evidence.size || createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) throw Error("Companion release checksum does not match signed artifact");
if (evidence.signingCertificateSha256 !== "87e00a382a5e0e76772583964ea9c2b695eaf80e75ac4241cf07aa6767f2b114") throw Error("Companion signing identity changed");
const result = spawnSync(process.execPath, [fileURLToPath(new URL("check-mobile-artifact.mjs", import.meta.url)), join(directory, name)], { stdio: "inherit" });
if (result.status !== 0) throw Error("Companion artifact scan failed");
console.log(`Companion release verified: ${mobile.version}, code ${mobile.android.versionCode}, SHA-256 ${evidence.sha256}`);
