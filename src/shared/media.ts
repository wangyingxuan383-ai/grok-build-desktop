import type {
  CommandInfo,
  MediaCapabilities,
  MediaCreationRequest,
} from "./types";

const IMAGE_COMMAND = "imagine";
const VIDEO_COMMAND = "imagine-video";
const ASPECT_RATIOS = new Set(["auto", "1:1", "16:9", "9:16", "4:3", "3:4"]);
const VIDEO_DURATIONS = new Set([6, 10]);
const VIDEO_RESOLUTIONS = new Set(["480p", "720p"]);

export function detectMediaCapabilities(commands: CommandInfo[]): MediaCapabilities {
  const normalized = commands.map((command) => command.name.replace(/^\//, "").trim().toLowerCase()).filter(Boolean);
  const image = normalized.includes(IMAGE_COMMAND);
  const directVideo = normalized.includes(VIDEO_COMMAND);
  // CLI 0.2.101 documents /imagine-video but ACP currently publishes only the
  // Imagine skill. That skill includes the image_to_video workflow, so use its
  // advertised command rather than sending an unadvertised slash alias.
  const video = directVideo || image;
  return {
    image,
    video,
    commands: normalized,
    imageCommand: image ? IMAGE_COMMAND : undefined,
    videoCommand: directVideo ? VIDEO_COMMAND : image ? IMAGE_COMMAND : undefined,
    diagnostic: directVideo
      ? undefined
      : image
        ? "当前 CLI 的 ACP 只公布 /imagine；视频会通过该技能内置的 image_to_video 工作流生成。"
      : "当前 Grok CLI 会话未公布 /imagine 或 /imagine-video，已阻止发送不受支持的媒体命令。",
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
  if (!VIDEO_DURATIONS.has(duration)) throw new Error("视频时长只能是 6 秒或 10 秒");
  if (!VIDEO_RESOLUTIONS.has(resolution)) throw new Error("视频分辨率只能是 480p 或 720p");
  if (capabilities && !capabilities.videoCommand) throw new Error(capabilities.diagnostic || "当前 CLI 不支持视频生成");
  const command = capabilities?.videoCommand || VIDEO_COMMAND;
  const workflow = command === IMAGE_COMMAND ? "请使用 image_to_video 工作流生成视频：" : "";
  return `/${command} ${workflow}${prompt}${aspect} 生成 ${duration} 秒视频，分辨率 ${resolution}。`.trim();
}
