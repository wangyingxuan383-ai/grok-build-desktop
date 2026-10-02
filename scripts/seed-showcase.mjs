// Public screenshot data. No accounts, credentials, CLI sessions or scheduled registrations.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
const root = resolve(process.argv[2] || "");
if (!root.includes("Grok-Build-Desktop-smoke-")) throw Error("Showcase requires an isolated smoke profile");
const workspace = join(root, "Aurora Demo"), output = join(root, "Studio");
await mkdir(workspace, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(join(root, "onboarding.json"), JSON.stringify({ version: 1, completed: false, skipped: true, currentStep: 0 }));
await writeFile(join(root, "settings.json"), JSON.stringify({ activeWorkspace: workspace, recentWorkspaces: [workspace], defaultModel: "grok-4.5", automaticUpdateChecks: true, theme: { mode: "dark" } }));
const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)); } return (n ^ 0xffffffff) >>> 0; };
const chunk = (kind, bytes) => { const tag = Buffer.from(kind), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(bytes.length); sum.writeUInt32BE(crc(Buffer.concat([tag, bytes]))); return Buffer.concat([size, tag, bytes, sum]); };
// Original procedural illustrations, explicitly presented as demonstration artwork.
function illustration(variant) {
  const width = 720, height = 480, pixels = Buffer.alloc((width * 3 + 1) * height);
  const palettes = [[28,42,78,144,191,221], [69,35,60,230,164,139], [29,67,65,155,213,183], [44,35,78,175,156,222]];
  const p = palettes[variant];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = y / height; let color = [0,1,2].map(i => Math.round(p[i] * (1-t) + p[i+3] * t));
    if ((x-520)**2 + (y-105)**2 < 54**2) color = [246,219,169];
    if (y > 170 + Math.abs(x-230)*0.42) color = [67 + variant*9,91 + variant*7,121 + variant*12];
    if (y > 230 + Math.abs(x-555)*0.6) color = [34 + variant*7,64 + variant*4,91 + variant*7];
    if (y > 348) { color = [39+variant*12,83+variant*7,113+variant*10]; if (y % 18 < 2 && Math.abs(x-490) < (y-300)*1.3) color = [167,164,143]; }
    if (x < 110 && y > 285 + Math.abs(x-50)*1.7) color = [19,42,52];
    const offset = y * (width*3+1) + 1 + x*3; color.forEach((v,i) => pixels[offset+i] = v);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
}
const titles = ["山间的蓝色时刻", "暖色日落方案", "绿色山谷海报", "紫色暮光探索"];
const now = new Date().toISOString();
const rows = [];
for (let i=0;i<4;i++) {
  const id = `showcase-image-${i}`, cwd=join(output,id); await mkdir(cwd,{recursive:true});
  const png=illustration(i), savedPath=join(cwd,"landscape.png"); await writeFile(savedPath,png);
  rows.push({ id,title:titles[i],cwd,createdAt:now,updatedAt:now,draft:"",jobs:[{requestId:`showcase-request-${i}`,prompt:titles[i]+"，简洁的山景插画，层次清楚。",aspectRatio:"3:2",job:{jobId:`showcase-job-${i}`,sessionId:id,kind:"image",route:"cli",status:"completed",message:"演示图片",startedAt:now,updatedAt:now,completedAt:now,artifacts:[{id:`showcase-art-${i}`,media:"image",source:png.toString("base64"),isData:true,mimeType:"image/png",savedPath}]}}] });
}
rows[0].jobs.push({ requestId:"showcase-failed",prompt:"失败筛选演示",job:{jobId:"showcase-failed",sessionId:rows[0].id,kind:"image",route:"cli",status:"failed",message:"演示网络错误",error:"演示：网络暂时不可用",artifacts:[],startedAt:now,updatedAt:now} });
await writeFile(join(root,"image-workspace.json"),JSON.stringify({version:1,outputRoot:output,conversations:rows}));
await writeFile(join(workspace,"preview.html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#eef2f7;color:#24334d;font-family:system-ui;padding:36px}small{color:#617899}h1{font-size:34px;margin:14px 0}p{line-height:1.8}.card{background:white;padding:24px;border-radius:20px;margin-top:24px;box-shadow:0 14px 35px #2e416b12}button{background:#385fbb;color:white;border:0;border-radius:10px;padding:12px 22px}strong{font-size:28px}</style><small>AURORA / DEMO</small><h1>让想法成为作品</h1><p>项目中的 HTML 可直接在右侧预览，<br>边看页面，边继续讨论修改。</p><div class="card"><small>交互预览</small><p><strong id="n">0</strong> 次点击</p><button onclick="document.querySelector('#n').textContent=Number(document.querySelector('#n').textContent)+1">试试按钮</button></div></html>`);
console.log("SHOWCASE_SEEDED isolated illustrations and HTML");
