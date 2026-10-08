import React,{useEffect,useRef,useState} from "react";
import {ActivityIndicator,FlatList,Modal,Pressable,Text,TextInput,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Button,ui,type Theme} from "./ui";
import type {RemoteOutline} from "../../../src/shared/remote";
import type {useRemote} from "./use-remote";
import {plainPreview} from "./app-model";

export function ConversationNavigator({visible,client,theme,currentIndex,onSelect,onClose,onLatest}:{
  visible:boolean;client:ReturnType<typeof useRemote>;theme:Theme;currentIndex?:number;
  onSelect:(index:number)=>Promise<void>;onClose:()=>void;onLatest:()=>void;
}){
  const [query,setQuery]=useState(""),[data,setData]=useState<RemoteOutline>(),[loading,setLoading]=useState(false),[error,setError]=useState(""),[selecting,setSelecting]=useState<number>();
  const revision=useRef(0),paging=useRef(false);
  const load=async(before?:number)=>{
    const request=revision.current;setLoading(true);setError("");
    try{
      const result=await client.query<RemoteOutline>("outline",{sessionId:client.sessionId,...(query.trim()?{q:query.trim()}:{}),...(before!==undefined?{before:String(before)}:{})});
      if(request!==revision.current)return;
      setData(previous=>before!==undefined&&previous?{...result,entries:[...result.entries,...previous.entries]}:result);
    }catch(e){if(request===revision.current)setError(e instanceof Error?e.message:String(e))}
    finally{if(request===revision.current)setLoading(false);paging.current=false}
  };
  useEffect(()=>{revision.current++;if(!visible){setSelecting(undefined);return}const timer=setTimeout(()=>void load(),query?250:0);return()=>{revision.current++;clearTimeout(timer)}},[visible,client.host?.fingerprint,client.sessionId,query]);
  useEffect(()=>{setData(undefined);setQuery("");setError("")},[client.sessionId,client.host?.fingerprint]);
  const active=data?.entries.filter(entry=>entry.index<=(currentIndex??Infinity)).at(-1)?.index;
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={ui.modal}><Pressable accessibilityLabel="关闭跳转面板" onPress={onClose} style={{flex:1}}/>
      <SafeAreaView edges={["bottom"]} style={{height:"78%",backgroundColor:theme.surface,borderTopLeftRadius:24,borderTopRightRadius:24,padding:16,gap:12}}>
        <View style={ui.row}><Text style={[ui.title,{color:theme.text,flex:1}]}>跳转到提问</Text><Button compact title="关闭" theme={theme} onPress={onClose}/></View>
        <TextInput accessibilityLabel="查找提问" placeholder="查找提问…" placeholderTextColor={theme.muted} value={query} onChangeText={setQuery} maxLength={200} style={[ui.field,{color:theme.text,borderColor:theme.border}]}/>
        <View style={ui.row}><Text style={[ui.hint,{color:theme.muted,flex:1}]}>{data?`${data.totalTurns} 次提问`:"读取提问…"}</Text><Button compact title="最新回复 ↓" theme={theme} onPress={()=>{onClose();onLatest()}}/></View>
        {error?<View style={{gap:8}}><Text accessibilityRole="alert" style={[ui.hint,{color:theme.danger}]}>{error}</Text><Button compact title="重试" theme={theme} onPress={()=>void load()}/></View>:null}
        <FlatList style={{flex:1}} data={[...(data?.entries??[])].reverse()} keyExtractor={entry=>String(entry.index)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator
          ListFooterComponent={data?.before!==undefined?<Button compact title={loading?"读取中…":"加载更早提问"} theme={theme} disabled={loading} onPress={()=>{if(!paging.current){paging.current=true;void load(data.before)}}}/>:null}
          ListEmptyComponent={loading?<ActivityIndicator color={theme.accent}/>:!error?<Text style={[ui.hint,{color:theme.muted,paddingVertical:20}]}>{query?"没有匹配的提问":"此会话尚无提问"}</Text>:null}
          renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`跳转第 ${item.ordinal} 次提问：${item.prompt}`} disabled={selecting!==undefined} onPress={()=>{setSelecting(item.index);setError("");void onSelect(item.index).then(onClose).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setSelecting(undefined))}} style={{paddingVertical:14,paddingHorizontal:12,borderBottomWidth:1,borderColor:theme.border,backgroundColor:item.index===active?theme.raised:theme.surface,borderRadius:10,gap:5}}>
            <Text style={{color:item.index===active?theme.accent:theme.muted,fontSize:12}}>{selecting===item.index?"正在定位…":`第 ${item.ordinal} 次提问${item.index===active?" · 当前阅读位置":""}`}</Text>
            <Text numberOfLines={2} style={{color:theme.text,fontSize:15,lineHeight:22}}>{item.prompt}</Text>
            {item.preview?<Text numberOfLines={2} style={{color:theme.muted,fontSize:12,lineHeight:18}}>{plainPreview(item.preview)}</Text>:null}
          </Pressable>}/>
      </SafeAreaView>
    </View>
  </Modal>;
}
