const {withAppBuildGradle}=require("@expo/config-plugins");
module.exports=config=>withAppBuildGradle(config,mod=>{
 const marker="// Grok Remote private signing configuration";
 if(!mod.modResults.contents.includes(marker))mod.modResults.contents+=`\n${marker}\nif (System.getenv("GROK_ANDROID_KEYSTORE")) {\n  android.signingConfigs.create("grokRemote") {\n    storeFile file(System.getenv("GROK_ANDROID_KEYSTORE"))\n    storePassword System.getenv("GROK_ANDROID_STORE_PASSWORD")\n    keyAlias "grokremote"\n    keyPassword System.getenv("GROK_ANDROID_KEY_PASSWORD")\n  }\n  android.buildTypes.release.signingConfig = android.signingConfigs.grokRemote\n}\n`;
 return mod;
});
