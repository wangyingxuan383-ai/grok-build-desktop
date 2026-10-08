import React from"react";
import{Text,View}from"react-native";
import{useVideoPlayer,VideoView}from"expo-video";
import{useAudioPlayer,useAudioPlayerStatus}from"expo-audio";
import{Button,ui,type Theme}from"./ui";
export function MediaPlayer({uri,mimeType,theme}:{uri:string;mimeType:string;theme:Theme}){return mimeType.startsWith("video/")?<VideoPlayer uri={uri}/>:<AudioPlayer uri={uri} theme={theme}/>}
function VideoPlayer({uri}:{uri:string}){const player=useVideoPlayer(uri);return <VideoView player={player} nativeControls style={{flex:1}} allowsFullscreen allowsPictureInPicture={false}/>}
function AudioPlayer({uri,theme}:{uri:string;theme:Theme}){const player=useAudioPlayer(uri),status=useAudioPlayerStatus(player);return <View style={{flex:1,justifyContent:"center",gap:20}}><Text style={[ui.title,{color:theme.text}]}>音频预览 · {Math.floor(status.currentTime)} / {Math.floor(status.duration)} 秒</Text><View style={ui.row}><Button title={status.playing?"暂停":"播放"} theme={theme} onPress={()=>status.playing?player.pause():player.play()}/><Button title="从头播放" theme={theme} onPress={()=>void player.seekTo(0).then(()=>player.play())}/></View></View>}
