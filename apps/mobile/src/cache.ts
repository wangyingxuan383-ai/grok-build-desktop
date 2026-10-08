import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import {CACHE_BYTE_LIMIT,CACHE_EVICTION_SQL} from "./cache-policy";
let opening:Promise<SQLite.SQLiteDatabase>|undefined;
async function database(){return opening??=SQLite.openDatabaseAsync("grok-remote-cache.db").then(async db=>{await db.execAsync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS saved(key TEXT PRIMARY KEY,body TEXT NOT NULL);");return db})}
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
