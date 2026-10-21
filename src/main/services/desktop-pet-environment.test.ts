import { describe,it,expect,vi,afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough,Writable } from "node:stream";
import { DesktopPetEnvironment,validateDesktopPetEnvironment } from "./desktop-pet-environment";
const value={locked:false,presentation:false,fullScreen:false,foregroundRect:null,doubleClickTime:500,leftButtonDown:false};
afterEach(()=>vi.useRealTimers());
describe("restricted native context",()=>{
 it("rejects unknown fields, impossible locking and extra desktop data",()=>{expect(validateDesktopPetEnvironment(value)).toEqual(value);for(const patch of [{title:"secret"},{fullScreen:true},{doubleClickTime:0},{locked:true,leftButtonDown:true}])expect(validateDesktopPetEnvironment({...value,...patch})).toBeUndefined();});
 it("does not start while disabled, polls at most 1Hz and invalidates late replies",()=>{
  vi.useFakeTimers();let clock=0;const workers:any[]=[],changes:any[]=[];
  const spawn=vi.fn(()=>{const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.writes=[];child.stdin=new Writable({write(chunk,_enc,done){child.writes.push(JSON.parse(chunk.toString()));done();}});child.kill=vi.fn();workers.push(child);return child;});
  const env=new DesktopPetEnvironment("helper.exe",v=>changes.push(v),{spawn,now:()=>clock});expect(spawn).not.toHaveBeenCalled();env.start();const child=workers[0];expect(child.writes).toHaveLength(1);
  child.stdout.write(JSON.stringify({id:child.writes[0].id,ok:true,result:value})+"\n");expect(changes).toHaveLength(1);clock=999;vi.advanceTimersByTime(999);expect(child.writes).toHaveLength(1);clock=1000;vi.advanceTimersByTime(1);expect(child.writes).toHaveLength(2);
  env.stop();child.stdout.write(JSON.stringify({id:child.writes[1].id,ok:true,result:{...value,fullScreen:true}})+"\n");expect(changes).toHaveLength(1);expect(child.kill).toHaveBeenCalledOnce();env.dispose();
 });
});
