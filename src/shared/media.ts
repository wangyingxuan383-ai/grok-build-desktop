import type {
  CommandInfo,
  MediaCapabilities,
  MediaCreationRequest,
} from "./types";

const IMAGE_COMMAND = "imagine";
const VIDEO_COMMAND = "imagine-video";
const ASPECT_RATIOS = new Set(["auto", "1:1", "16:9", "9:16", "4:3", "3:4"]);
const VIDEO_DURATIONS = new Set(Array.from({ length: 15 }, (_, index) => index + 1));
const VIDEO_RESOLUTIONS = new Set(["480p", "720p"]);

export function detectMediaCapabilities(commands: CommandInfo[], registeredTools: string[] = []): MediaCapabilities {
  const normalized = commands.map((command) => command.name.replace(/^\//, "").trim().toLowerCase()).filter(Boolean);
  const tools = [...new Set(registeredTools.map((tool) => tool.trim().toLowerCase()).filter(Boolean))];
  // Grok Build 1.0.3 namespaces bundled skills as `bundled:imagine` and does
  // not guarantee that the pager-only `/imagine` alias is published over ACP.
  const imageCommand = normalized.find((command) => command.split(":").at(-1) === IMAGE_COMMAND);
  const videoCommand = normalized.find((command) => command.split(":").at(-1) === VIDEO_COMMAND);
  const hasImageTool = tools.includes("image_gen");
  const hasVideoTool = tools.some((tool) => ["video_gen", "image_to_video", "reference_to_video"].includes(tool));
  const image = hasImageTool || Boolean(imageCommand);
  const video = hasVideoTool || Boolean(videoCommand) || Boolean(imageCommand);
  return {
    image,
    video,
    commands: normalized,
    tools,
    // Only expose slash commands that ACP actually advertised. The Desktop
    // media runner can use registered tools directly; it must not fabricate a
    // pager alias merely because the corresponding tool exists.
    imageCommand,
    videoCommand: videoCommand ?? imageCommand,
    diagnostic: hasVideoTool || videoCommand
      ? undefined
      : imageCommand
        ? `当前 CLI 公布了 /${imageCommand} 工作流；视频能力会在执行时按 image_to_video/ZDR 配置确认。`
      : hasImageTool
        ? "当前会话只明确注册了 image_gen；未注册视频工具，可能受 ZDR 或 CLI 配置限制。"
      : "当前 Grok CLI 会话未公布 Imagine 工作流或媒体工具，已阻止发送不受支持的媒体任务。",
  };
}

export function buildMediaSlashCommand(request: MediaCreationRequest, capabilities?: MediaCapabilities): string {
  const prompt = request.prompt.replace(/\s+/g, " ").trim();
  if (!prompt) throw new Error("请输入创作描述");
  if (!ASPECT_RATIOS.has(request.aspectRatio)) throw new Error("不支持的画面比例");

  const aspect = request.aspectRatio === "auto" ? "" : ` 画面比例 ${request.aspectRatio}。`;
  if (request.kind === "image") {
    if (capabilities && !capabilities.imageCommand) throw new Error(capabilities.diagnostic || "当前 CLI 不支持图片生成");
    return `/${capabilities?.imageCommand || IMAGE_COMMAND} ${prompt}${aspect}`.trim();
  }

  const duration = request.duration ?? 6;
  const resolution = request.resolution ?? "480p";
  if (!VIDEO_DURATIONS.has(duration)) throw new Error("视频时长必须在 1–15 秒之间");
  if (!VIDEO_RESOLUTIONS.has(resolution)) throw new Error("视频分辨率只能是 480p 或 720p");
  if (capabilities && !capabilities.videoCommand) throw new Error(capabilities.diagnostic || "当前 CLI 不支持视频生成");
  const command = capabilities?.videoCommand || VIDEO_COMMAND;
  const workflow = command.split(":").at(-1) === IMAGE_COMMAND ? "请使用 image_to_video 工作流生成视频：" : "";
  const voice = request.voice?.trim() ? ` 参考视频声音：${request.voice.trim()}。` : "";
  return `/${command} ${workflow}${prompt}${aspect} 生成 ${duration} 秒视频，分辨率 ${resolution}。${voice}`.trim();
}
