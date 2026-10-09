const {withDangerousMod}=require("@expo/config-plugins");
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require("node:fs");
const {join}=require("node:path");
module.exports=config=>withDangerousMod(config,["android",async mod=>{
 const root=mod.modRequest.projectRoot,assets=join(mod.modRequest.platformProjectRoot,"app","src","main","assets");
 const files=["THIRD_PARTY_NOTICES.md","LICENSE-APACHE-2.0.txt",...['react','react-native','expo','expo-asset','expo-constants','expo-modules-core','markdown-it','react-native-web','react-native-safe-area-context','@react-native-async-storage/async-storage','expo-document-picker','expo-image-picker','expo-file-system','expo-sharing','expo-sqlite','expo-notifications','expo-video','expo-audio','expo-crypto','expo-secure-store','expo-clipboard','react-native-gesture-handler','react-native-reanimated','react-native-worklets','@shopify/flash-list','expo-image','expo-haptics','expo-local-authentication','expo-font','@expo/vector-icons'].map(name=>join("node_modules",name,"LICENSE"))];
 const notices=files.filter(file=>existsSync(join(root,file))).map(file=>`=== ${file} ===\n${readFileSync(join(root,file),"utf8")}`).join("\n\n");
 mkdirSync(assets,{recursive:true});writeFileSync(join(assets,"GROK_REMOTE_NOTICES.txt"),notices,"utf8");return mod;
}]);
