import { resolve } from "node:path";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

const executable = resolve(process.argv[2] || "release/win-unpacked/Grok Build Desktop.exe");
const wire = await getCurrentFuseWire(executable);
const required = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE],
]);
const failed = [];
for (const [option, expected] of required) if (wire[option] !== expected) failed.push(`${FuseV1Options[option]}=${FuseState[wire[option]]}, expected ${FuseState[expected]}`);
if (failed.length) throw new Error(`Electron Fuse verification failed: ${failed.join("; ")}`);
console.log(`Electron Fuse verification passed for ${executable}`);
