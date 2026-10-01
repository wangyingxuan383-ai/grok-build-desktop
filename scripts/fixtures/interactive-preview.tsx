import React from "react";
import {createRoot} from "react-dom/client";
import {ArtifactContent} from "../../src/renderer/src/components/ArtifactWorkbench";
window.addEventListener("message",event=>{if(event.source===document.querySelector("iframe")?.contentWindow)(window as any).previewResult=event.data;});
const previewUrl=new URLSearchParams(location.search).get("html")||"";
createRoot(document.getElementById("root")!).render(<ArtifactContent artifact={{path:"fixture.html",name:"fixture.html",kind:"html",mimeType:"text/html",data:"",previewUrl}}/>);
