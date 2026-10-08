const endpoint = process.argv[2];
if (!endpoint) throw Error("CDP endpoint is required");
const targets = await fetch(`${endpoint}/json/list`).then(response => response.json());
const target = targets.find(row => row.type === "page");
if (!target) throw Error("Packaged renderer unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pending = new Map(); let sequence = 0;
socket.onmessage = ({data}) => { const event = JSON.parse(data); const request = pending.get(event.id); if (!request) return; pending.delete(event.id); event.error ? request.reject(Error(event.error.message)) : request.resolve(event.result); };
const request = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
try {
  const result = await request("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async()=>{
    const api=window.grokDesktop;
    const release=await api.checkAppUpdate(true);
    if(release.error)throw Error(release.error);
    const phone=await api.getMobileDownload();
    return {latest:release.latestVersion,apk:release.companion?.version,apkHash:release.companion?.sha256,installer:release.installer?.name,installerHash:release.installer?.sha256,phoneUrl:phone.url,qr:phone.qrDataUrl?.startsWith('data:image/png')};
  })()` });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || "Release IPC failed");
  const value = result.result?.value;
  if (!value?.latest || !value.apk || !value.qr || !/^[a-f0-9]{64}$/.test(value.apkHash || "") || !/^[a-f0-9]{64}$/.test(value.installerHash || "") || !value.phoneUrl?.endsWith(`Grok-Remote-v${value.apk}.apk`)) throw Error("Public updates are missing verified assets or APK QR");
  console.log("PACKAGED_PUBLIC_UPDATE_AND_PHONE_QR_PASSED",JSON.stringify(value));
} finally { socket.close(); }
