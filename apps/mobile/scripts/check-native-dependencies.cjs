const { readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");
const semver = require("semver");

function mismatches(packages, matrix) {
  return packages.flatMap(({ name, version }) => matrix[name] && !semver.satisfies(version, matrix[name])
    ? [`${name}@${version}: expected ${matrix[name]}`] : []);
}

function check() {
  const root = join(__dirname, "..");
  const matrix = JSON.parse(readFileSync(join(dirname(require.resolve("expo/package.json")), "bundledNativeModules.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const packages = Object.entries(lock.packages).flatMap(([path, value]) => {
    const name = path.split("node_modules/").pop();
    return name?.startsWith("expo-") && value.version ? [{ name, version: value.version }] : [];
  });
  const cli = join(dirname(require.resolve("expo-modules-autolinking/package.json")), "bin/expo-modules-autolinking.js");
  const resolved = spawnSync(process.execPath, [cli, "resolve", "--platform", "android", "--json"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  if (resolved.status !== 0) throw Error("Cannot verify Android native module selection; run Expo autolinking diagnostics.");
  const modules = JSON.parse(resolved.stdout).modules;
  const violations = [...new Set([...mismatches(packages, matrix), ...mismatches(modules.map(module => ({ name: module.packageName, version: module.packageVersion })), matrix)])];
  if (violations.length) throw Error(`Expo SDK/native dependencies do not match:\n${violations.join("\n")}`);
  for (const name of ["expo-asset", "expo-modules-core", "grok-remote-native"]) {
    if (modules.filter(module => module.packageName === name).length !== 1) throw Error(`Expected one Android native module: ${name}`);
  }
  console.log(`Expo native dependency check passed (${modules.length} linked modules).`);
}

module.exports = { mismatches };
if (require.main === module) check();
