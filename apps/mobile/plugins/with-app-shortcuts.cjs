const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Long-press launcher shortcuts. Each opens a grokremote:// link the app already routes;
 * none of them sends anything to the computer by itself.
 */
const SHORTCUTS = [
  { id: "new", label: "新建会话", long: "新建会话", url: "grokremote://new", icon: "ic_menu_add" },
  { id: "inbox", label: "待回应", long: "待回应事项", url: "grokremote://inbox", icon: "ic_menu_agenda" },
  { id: "recent", label: "最近会话", long: "继续最近会话", url: "grokremote://recent", icon: "ic_menu_recent_history" },
];

function shortcutsXml(packageName) {
  const items = SHORTCUTS.map(s => `  <shortcut android:shortcutId="${s.id}" android:enabled="true" android:icon="@android:drawable/${s.icon}" android:shortcutShortLabel="@string/grok_shortcut_${s.id}" android:shortcutLongLabel="@string/grok_shortcut_${s.id}_long">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="${packageName}" android:targetClass="${packageName}.MainActivity" android:data="${s.url}" />
  </shortcut>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">\n${items}\n</shortcuts>\n`;
}

module.exports = config => {
  config = withDangerousMod(config, ["android", async mod => {
    const res = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
    const packageName = mod.android?.package || config.android?.package;
    fs.mkdirSync(path.join(res, "xml"), { recursive: true });
    fs.writeFileSync(path.join(res, "xml", "grok_shortcuts.xml"), shortcutsXml(packageName));
    fs.mkdirSync(path.join(res, "values"), { recursive: true });
    const strings = SHORTCUTS.flatMap(s => [`  <string name="grok_shortcut_${s.id}">${s.label}</string>`, `  <string name="grok_shortcut_${s.id}_long">${s.long}</string>`]).join("\n");
    fs.writeFileSync(path.join(res, "values", "grok_shortcuts_strings.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${strings}\n</resources>\n`);
    return mod;
  }]);
  return withAndroidManifest(config, mod => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity["meta-data"] ??= [];
    if (!activity["meta-data"].some(meta => meta.$["android:name"] === "android.app.shortcuts"))
      activity["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/grok_shortcuts" } });
    return mod;
  });
};
