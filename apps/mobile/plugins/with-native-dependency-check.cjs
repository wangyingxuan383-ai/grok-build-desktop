const { withAppBuildGradle } = require("@expo/config-plugins");

module.exports = config => withAppBuildGradle(config, mod => {
  const marker = "// Grok Remote native dependency verification";
  if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += `\n${marker}
tasks.register("verifyGrokNativeDependencies", Exec) {
  workingDir rootProject.projectDir.parentFile
  commandLine "node", "scripts/check-native-dependencies.cjs"
}
tasks.named("preBuild").configure { dependsOn("verifyGrokNativeDependencies") }
`;
  return mod;
});
