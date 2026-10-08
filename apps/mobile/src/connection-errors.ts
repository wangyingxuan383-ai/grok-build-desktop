export function readableConnectionError(error:unknown,host:string):Error {
 const value=error as {code?:string;message?:string};const detail=value?.message||String(error);
 const code=value?.code||"";
 let message:string;
 if(code==="ERR_REMOTE_IDENTITY"||detail.includes("电脑身份已变化"))message="电脑证书身份已变化。请在电脑刷新二维码后重新配对。";
 else if(code==="ERR_REMOTE_CERT_TIME"||/Certificate(NotYetValid|Expired)/.test(detail))message="证书时间无效，请检查手机和电脑系统时间。";
 else if(code==="ERR_REMOTE_CONNECT"||/SocketTimeoutException|failed to connect|ECONNREFUSED/.test(detail))message=`无法连接电脑 ${host}。同一 Wi-Fi 下请选电脑的 WLAN 地址，确认已开启手机连接，并允许 Windows 专用网络访问。`;
 else if(code==="ERR_REMOTE_TLS"||detail.includes("SSLHandshakeException"))message=`连接 ${host} 时加密握手中断。请刷新电脑二维码重扫，并查看电脑“连接诊断”。`;
 else message=detail.replace(/^Call to function [\s\S]*?→ Caused by:\s*/,"");
 return Object.assign(new Error(message),{code,detail});
}
/**
 * Failures that usually clear on their own (Wi-Fi hiccup, the computer briefly busy or
 * restarting). These are retried quietly before anything is shown; identity, auth,
 * certificate and validation failures are never transient.
 */
export function isTransientError(error:unknown):boolean{
 const value=error as {code?:string;status?:number;message?:string;detail?:string};
 if(["ERR_REMOTE_IDENTITY","ERR_REMOTE_CERT_TIME","ERR_REMOTE_PROTOCOL"].includes(value?.code||""))return false;
 if(typeof value?.status==="number")return value.status===408||value.status===429||value.status>=500;
 if(["ERR_REMOTE_CONNECT","ERR_REMOTE_TLS","ERR_REMOTE_TIMEOUT"].includes(value?.code||""))return true;
 return /SocketTimeout|timed? ?out|ECONNRESET|ECONNREFUSED|failed to connect|connection (abort|reset)|Network request failed|unexpected end of stream|无法连接电脑|连接中断/i.test(`${value?.message||""} ${value?.detail||""} ${typeof error==="string"?error:""}`);
}
/** Map raw desktop-side filesystem errors to wording a phone user can act on. */
export function readableActionError(error:unknown):string{
 const detail=error instanceof Error?error.message:String(error);
 if(/ENOENT|系统找不到指定的路径|找不到指定的路径|no such file or directory|路径不存在|cannot find the path/i.test(detail))return "这个会话所在的项目文件夹已移动或删除。可在会话菜单中隐藏它，或在电脑上恢复文件夹。";
 return detail;
}
