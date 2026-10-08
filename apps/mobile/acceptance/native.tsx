import React from "react";
import {View} from "react-native";
export function SafeAreaProvider({children}:{children:React.ReactNode}){return <>{children}</>}
export function SafeAreaView({edges,...props}:any){return <View {...props}/>}
export function StatusBar(){return null}
export function CameraView(){return <View/>}
export function useCameraPermissions(){return [{granted:true},async()=>({granted:true})] as const}
export async function setStringAsync(value:string){Object.assign(globalThis,{grokCopied:value});}
export function randomUUID(){return crypto.randomUUID()}
export default {async getItem(key:string){return localStorage.getItem(key)},async setItem(key:string,value:string){localStorage.setItem(key,value)},async removeItem(key:string){localStorage.removeItem(key)},async getAllKeys(){return Object.keys(localStorage)}};
