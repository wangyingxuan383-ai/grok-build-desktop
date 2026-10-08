const endpoint = process.argv[2];
const targets = await fetch(`${endpoint}/json/list`).then(response => response.json());
const socket = new WebSocket(targets.find(row => row.type === "page").webSocketDebuggerUrl);
await new Promise((resolve, reject) => {socket.onopen=resolve;socket.onerror=reject;});
const pending=new Map();let sequence=0;
socket.onmessage=({data})=>{const event=JSON.parse(data),entry=pending.get(event.id);if(entry){pending.delete(event.id);event.error?entry.reject(Error(event.error.message)):entry.resolve(event.result);}};
try {
  const result=await new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const api=window.grokDesktop,settings=await api.getSettings();
    const normalize=value=>value?new URL(value).origin:'';
    // The old public version needs a canonical proxy in this isolated profile.
    await api.updateSettings({httpProxy:normalize(settings.httpProxy),httpsProxy:normalize(settings.httpsProxy)});
    const release=await api.checkAppUpdate(true);
    if(!release.updateAvailable||release.error||!release.installer?.sha256)throw Error(release.error||'Verified new installer unavailable');
    const state=await api.downloadAppUpdate();
    if(state.phase!=='ready'||!state.verified||state.sha256!==release.installer.sha256||state.received!==release.installer.size)throw Error(state.error||'Installer download verification failed');
    return {version:release.latestVersion,received:state.received,sha256:state.sha256,verified:state.verified};
  })()`}}));});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||"Update download IPC failed");
  console.log("REAL_IN_APP_UPDATE_DOWNLOAD_PASSED_NO_INSTALL",JSON.stringify(result.result?.value));
} finally {socket.close();}
