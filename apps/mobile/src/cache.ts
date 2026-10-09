import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import {CACHE_BYTE_LIMIT,CACHE_EVICTION_SQL} from "./cache-policy";
let opening:Promise<SQLite.SQLiteDatabase>|undefined;
let health:{ok:boolean;error?:string;attempts:number}={ok:true,attempts:0};
const SCHEMA="PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS saved(key TEXT PRIMARY KEY,body TEXT NOT NULL);";
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Opens the cache with bounded retries; a failed open is forgotten so a later call can recover without restarting the app. */
async function openWithRetry(){
 let last:unknown;
 for(let attempt=1;attempt<=3;attempt++){
  try{const db=await SQLite.openDatabaseAsync("grok-remote-cache.db");await db.execAsync(SCHEMA);health={ok:true,attempts:attempt};return db}
  catch(error){last=error;health={ok:false,attempts:attempt,error:error instanceof Error?error.message:String(error)};if(attempt<3)await pause(attempt*400)}
 }
 throw last instanceof Error?last:Error(String(last));
}
async function database(){
 const current=opening??=openWithRetry();
 try{return await current}catch(error){if(opening===current)opening=undefined;throw error}
}
/** Local storage health for the diagnostics page. */
export function storageStatus(){return {...health}}
/** Drops and recreates the cache database. Saved drafts live in the same file, so callers must confirm first. */
export async function rebuildStorage(){
 if(Platform.OS==="web")return;
 const previous=opening;opening=undefined;
 try{const db=await previous;await db?.closeAsync()}catch{}
 try{await SQLite.deleteDatabaseAsync("grok-remote-cache.db")}catch{}
 await database();
}
export async function cacheRead<T>(key:string):Promise<{value:T;updated:number}|undefined>{
 if(Platform.OS==="web"){const raw=await AsyncStorage.getItem("cache:"+key);return raw?JSON.parse(raw):undefined}
 const row=await(await database()).getFirstAsync<{body:string;updated:number}>("SELECT body,updated FROM cache WHERE key=?",key);return row?{value:JSON.parse(row.body),updated:row.updated}:undefined;
}
export async function cacheWrite(key:string,value:unknown){const updated=Date.now(),body=JSON.stringify(value);if(body.length>4*1024*1024)return;
 if(Platform.OS==="web"){await AsyncStorage.setItem("cache:"+key,JSON.stringify({value,updated}));return}
 const db=await database();await db.runAsync("INSERT OR REPLACE INTO cache(key,body,updated) VALUES(?,?,?)",key,body,updated);await db.runAsync("DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY updated DESC LIMIT -1 OFFSET 120)");
 await db.runAsync(CACHE_EVICTION_SQL,CACHE_BYTE_LIMIT);
}
export async function savedRead<T>(key:string):Promise<T|undefined>{if(Platform.OS==="web"){const raw=await AsyncStorage.getItem("saved:"+key);return raw?JSON.parse(raw):undefined}const row=await(await database()).getFirstAsync<{body:string}>("SELECT body FROM saved WHERE key=?",key);return row?JSON.parse(row.body):undefined}
export async function savedWrite(key:string,value:unknown){const body=JSON.stringify(value);if(Platform.OS==="web"){await AsyncStorage.setItem("saved:"+key,body);return}await(await database()).runAsync("INSERT OR REPLACE INTO saved(key,body) VALUES(?,?)",key,body)}
export async function savedDelete(key:string){if(Platform.OS==="web"){await AsyncStorage.removeItem("saved:"+key);return}await(await database()).runAsync("DELETE FROM saved WHERE key=?",key)}
export async function clearCache(){if(Platform.OS==="web"){const keys=(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith("cache:"));await AsyncStorage.multiRemove(keys);return}await(await database()).runAsync("DELETE FROM cache");}
