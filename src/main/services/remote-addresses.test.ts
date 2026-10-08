import {describe,it,expect}from"vitest";
import{remoteAddressOptions}from"./remote-addresses";
const ip=(address:string,internal=false)=>({address,family:"IPv4",internal,netmask:"255.255.255.0",mac:"00:00:00:00:00:00",cidr:`${address}/24`})as const;
describe("remote LAN address choice",()=>{
 it("prefers WLAN over a first-enumerated Radmin VPN",()=>{const rows=remoteAddressOptions({"Radmin VPN":[ip("26.0.0.42")],WLAN:[ip("192.168.1.42")],Ethernet:[ip("169.254.1.1")],Loopback:[ip("127.0.0.1",true)]},48975);expect(rows[0]).toMatchObject({url:"https://192.168.1.42:48975",recommended:true,kind:"lan"});expect(rows[1]).toMatchObject({kind:"vpn",recommended:false});expect(rows).toHaveLength(2)});
 it("keeps VPN addresses selectable and preserves a useful fallback",()=>{expect(remoteAddressOptions({Tailscale:[ip("100.64.1.2")]},12345)[0]).toMatchObject({url:"https://100.64.1.2:12345",kind:"vpn",recommended:true});expect(remoteAddressOptions({},12345)).toEqual([])});
});
