const {withAndroidManifest,withMainActivity,AndroidConfig}=require("@expo/config-plugins");
module.exports=config=>{
 config=withAndroidManifest(config,mod=>{
  const activity=AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
  activity["intent-filter"]??=[];
  if(!activity["intent-filter"].some(filter=>filter.action?.some(action=>action.$["android:name"]==="android.intent.action.SEND")))activity["intent-filter"].push({action:[{$:{"android:name":"android.intent.action.SEND"}},{$:{"android:name":"android.intent.action.SEND_MULTIPLE"}}],category:[{$:{"android:name":"android.intent.category.DEFAULT"}}],data:[{$:{"android:mimeType":"*/*"}}]});
  return mod;
 });
 return withMainActivity(config,mod=>{
  if(!mod.modResults.contents.includes("// Grok Remote incoming share"))mod.modResults.contents=mod.modResults.contents.replace(/\n}\s*$/,`\n  // Grok Remote incoming share: retain the new intent for the native inbox.\n  override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n  }\n}\n`);
  return mod;
 });
};
