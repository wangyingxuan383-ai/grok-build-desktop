const { withProjectBuildGradle } = require("@expo/config-plugins");

// Let CMake quote compiler options itself, including Windows paths with spaces.
// This maps diagnostic paths, without changing source or include resolution.
module.exports = config => withProjectBuildGradle(config, mod => {
  const marker = "// Grok Remote native path privacy (CMake)";
  if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += `
${marker}
def grokSourceRoot = rootProject.projectDir.parentFile.parentFile.parentFile
def grokNativeRoots = [gradle.gradleUserHomeDir, grokSourceRoot, new File(grokSourceRoot, "node_modules").toPath().toRealPath().parent.toFile()]
def grokNativeMap = new File(rootProject.layout.buildDirectory.get().asFile, "grok-native-paths.cmake")
grokNativeMap.parentFile.mkdirs()
grokNativeMap.text = "include_guard(GLOBAL)\\n" + grokNativeRoots.collectMany { root -> [root.absolutePath, root.toPath().toRealPath().toString()] }.unique().withIndex().collect { path, index ->
  def escaped = path.replace('\\\\', '/').replace('$', '\\\\$').replace(';', '\\\\;')
  'add_compile_options("-ffile-prefix-map=' + escaped + '=/build/source-' + index + '")'
}.join("\\n") + "\\n"
subprojects { child ->
  ["com.android.application", "com.android.library"].each { pluginId ->
    child.plugins.withId(pluginId) {
      child.extensions.getByName("androidComponents").finalizeDsl { android ->
        android.defaultConfig.externalNativeBuild.cmake.arguments.add("-DCMAKE_PROJECT_INCLUDE=" + grokNativeMap.absolutePath)
      }
    }
  }
}
`;
  return mod;
});
