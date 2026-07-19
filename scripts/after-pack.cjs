const { join } = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
};
