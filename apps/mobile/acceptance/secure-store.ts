const host={id:"fixture-device",host:"https://desktop.example.invalid",fingerprint:"a".repeat(64),token:"fixture-token",name:"Demo computer"};
export async function getItemAsync(key:string){return localStorage.getItem(key)??(key==="grok.remote.host.v1"?JSON.stringify(host):null)}
export async function setItemAsync(key:string,value:string){localStorage.setItem(key,value)}
export async function deleteItemAsync(key:string){localStorage.removeItem(key)}
