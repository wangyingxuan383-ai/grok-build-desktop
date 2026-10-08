const {withAppBuildGradle}=require("@expo/config-plugins");
/** React Native otherwise embeds the build machine's first adapter address in every APK. */
module.exports=config=>withAppBuildGradle(config,mod=>{
 const marker="// Grok Remote generic development host";
 if(!mod.modResults.contents.includes(marker))mod.modResults.contents+=`\n${marker}\nandroidComponents {\n  finalizeDsl { extension ->\n    extension.defaultConfig.resValue("string", "react_native_dev_server_ip", "localhost")\n  }\n}\n`;
 return mod;
});
