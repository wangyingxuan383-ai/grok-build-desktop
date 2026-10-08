import type { NetworkInterfaceInfo } from "node:os";
export interface RemoteAddressOption {url:string;interfaceName:string;kind:"lan"|"vpn"|"other";recommended:boolean}
export function remoteAddressOptions(interfaces:NodeJS.Dict<NetworkInterfaceInfo[]>,port:number):RemoteAddressOption[]{
  const rows=Object.entries(interfaces).flatMap(([interfaceName,addresses])=>(addresses??[]).filter(address=>address.family==="IPv4"&&!address.internal&&!address.address.startsWith("169.254.")&&address.address!=="0.0.0.0").map(address=>{
    const vpn=/radmin|vpn|tailscale|zerotier|hamachi|vEthernet|vmware|virtualbox|docker|wsl|tun\b|tap\b/i.test(interfaceName);
    const privateIp=/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address);
    const kind:RemoteAddressOption["kind"]=vpn?"vpn":privateIp?"lan":"other";
    const score=vpn?100:privateIp?/wlan|wi-fi|wifi|无线/i.test(interfaceName)?0:10:50;
    return {url:`https://${address.address}:${port}`,interfaceName,kind,recommended:false,score};
  })).sort((a,b)=>a.score-b.score||a.url.localeCompare(b.url));
  if(rows[0])rows[0].recommended=true;
  return rows.map(({score,...row})=>row);
}
