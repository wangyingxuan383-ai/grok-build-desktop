import iconv from "iconv-lite";
import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { resolveTrustedRendererPath } from "./renderer-path-policy";
import type { WorkspaceArtifact } from "../../shared/workspace-tools";
const media:Record<string,[WorkspaceArtifact["kind"],string]>={".png":["image","image/png"],".jpg":["image","image/jpeg"],".jpeg":["image","image/jpeg"],".webp":["image","image/webp"],".gif":["image","image/gif"],".pdf":["pdf","application/pdf"],".mp3":["audio","audio/mpeg"],".wav":["audio","audio/wav"],".ogg":["audio","audio/ogg"],".mp4":["video","video/mp4"],".webm":["video","video/webm"]};
/**
 * Text safety comes from the artifact being rendered into a `<pre>`/`<textarea>`
 * surface, never from this list: the extension set is only a "does a preview
 * make sense here" heuristic and is deliberately generous. Keep the copy in
 * ArtifactWorkbench in sync rather than duplicating the list there.
 */
const textExtensions=new Set(".txt .md .markdown .mdx .json .jsonc .json5 .jsonl .ndjson .yaml .yml .toml .csv .tsv .log .ts .tsx .mts .cts .js .jsx .mjs .cjs .css .scss .sass .less .vue .svelte .astro .xml .svg .py .rs .go .java .kt .kts .swift .cs .c .h .cc .cpp .cxx .hpp .sql .sh .ps1 .psm1 .psd1 .bat .cmd .zsh .fish .bash .awk .sed .diff .patch .rb .php .lua .r .pl .ex .exs .erl .scala .clj .proto .graphql .gql .prisma .tf .hcl .gradle .cmake .ini .conf .cfg .properties .env .envrc .lock .tex .rst .adoc .org .dockerfile .makefile .gitignore .editorconfig .npmrc .nvmrc .dircolors".split(" "));
/** Files whose whole name is the format; `extname` reports nothing useful for these. */
const textBasenames=new Set(["dockerfile","makefile","rakefile","gemfile","procfile","brewfile","justfile","vagrantfile","license","licence","notice","readme","changelog","authors","contributing","todo","copying",".gitignore",".gitattributes",".gitmodules",".editorconfig",".npmrc",".nvmrc",".yarnrc",".babelrc",".eslintrc",".prettierrc",".env",".env.local",".env.development",".env.production",".dockerignore",".prettierignore",".eslintignore"]);
/** HTML legitimately inlines images, fonts and styles, so it gets the binary budget rather than the text one. */
const HTML_LIMIT=20*1024*1024;
const TEXT_LIMIT=2*1024*1024;
const MEDIA_LIMIT=20*1024*1024;
/** Exported for the preview UI copy so the two never drift apart. */
export const previewableTextExtensions=textExtensions;
export const previewableTextBasenames=textBasenames;
/**
 * `issuedPaths` carries only paths the native picker already handed the main
 * process; anything typed in as free text still falls back to the workspace root.
 */
export async function readWorkspaceArtifact(workspace:string,requested:string,options:{issuedPaths?:ReadonlySet<string>}={}):Promise<WorkspaceArtifact>{
 const path=await resolveTrustedRendererPath(requested,{roots:[workspace],issuedPaths:options.issuedPaths,kind:"file"});const extension=extname(path).toLowerCase();
 const office=[".docx",".xlsx",".pptx"].includes(extension);const html=[".html",".htm",".xhtml"].includes(extension);const binary=media[extension];
 if(!office&&!html&&!binary&&!isPreviewableText(path))throw Error("此格式暂不支持内置预览");
 const limit=html?HTML_LIMIT:binary?MEDIA_LIMIT:TEXT_LIMIT;const file=await open(path,"r");let buffer:Buffer;
 try {if((await file.stat()).size>limit)throw Error(`文件超过预览上限 ${limit/1024/1024} MB`);buffer=Buffer.alloc(limit+1);let bytesRead=0;while(bytesRead<buffer.length){const chunk=await file.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(!chunk.bytesRead)break;bytesRead+=chunk.bytesRead}if(bytesRead>limit)throw Error("文件超过预览上限");buffer=buffer.subarray(0,bytesRead)}finally{await file.close()}
 if(!binary&&!office&&looksBinary(buffer))throw Error("此文件不是文本，暂不支持内置预览");
 let data=binary?buffer.toString("base64"):decodeText(buffer);
 if(office){let total=0,count=0;const files=unzipSync(buffer,{filter:entry=>{if(++count>10000)throw Error("Office 文档条目过多");if(!/^(word\/document|xl\/sharedStrings|xl\/worksheets\/sheet\d+|ppt\/slides\/slide\d+)\.xml$/.test(entry.name))return false;total+=entry.originalSize;if(total>8*1024*1024)throw Error("Office 文档展开内容过大");return true}});
 data=Object.entries(files).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([name,bytes])=>`[${name}]\n${strFromU8(bytes).replace(/<\/(?:w:p|a:p|row)>/g,"\n").replace(/<[^>]*>/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}`).join("\n\n");}
 return {path,name:basename(path),kind:binary?.[0]||(office?"office":html?"html":"text"),mimeType:binary?.[1]||"text/plain",data};
}
function isPreviewableText(path:string):boolean{const name=basename(path).toLowerCase();const extension=extname(name);if(extension)return textExtensions.has(extension);return textBasenames.has(name)||!name.includes(".")}
function looksBinary(buffer:Buffer):boolean{if((buffer[0]===0xff&&buffer[1]===0xfe)||(buffer[0]===0xfe&&buffer[1]===0xff))return false;return buffer.subarray(0,8192).includes(0)}
function decodeText(value:Buffer):string{if(value[0]===0xff&&value[1]===0xfe)return new TextDecoder("utf-16le").decode(value.subarray(2));if(value[0]===0xfe&&value[1]===0xff)return new TextDecoder("utf-16be").decode(value.subarray(2));if(value[0]===0xef&&value[1]===0xbb&&value[2]===0xbf)return new TextDecoder("utf-8").decode(value.subarray(3));try{return new TextDecoder("utf-8",{fatal:true}).decode(value)}catch{return iconv.decode(value,"gb18030")}}
