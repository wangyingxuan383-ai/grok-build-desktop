const {getDefaultConfig}=require("expo/metro-config");
const path=require("node:path");
const config=getDefaultConfig(__dirname);
// Share pure protocol/command helpers without copying Desktop runtime code.
config.watchFolders=[...(config.watchFolders||[]),path.resolve(__dirname,"../../src/shared")];
module.exports=config;
