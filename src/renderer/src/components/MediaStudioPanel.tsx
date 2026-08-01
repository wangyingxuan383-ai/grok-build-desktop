import { useEffect, useRef, useState } from "react";
import type { Attachment, CustomProviderProfile, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaGenerationJob, MediaVideoDuration, MediaVideoResolution } from "../../../shared/types";

export function MediaStudioPanel({ hasGrokConversation, commands, onCreate, onClose }: {
  hasGrokConversation: boolean;
  commands: Array<{ name: string; description?: string }>;
  onCreate(request: MediaCreationRequest): Promise<MediaGenerationJob>;
  onClose(): void;
}): React.JSX.Element {
  const [kind, setKind] = useState<MediaCreationKind>("image");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>("16:9");
  const [duration, setDuration] = useState<MediaVideoDuration>(6);
  const [resolution, setResolution] = useState<MediaVideoResolution>("480p");
  const [route, setRoute] = useState<"auto" | "cli" | "provider">("auto");
  const [providers, setProviders] = useState<CustomProviderProfile[]>([]);
  const [providerModel, setProviderModel] = useState("");
  const [references, setReferences] = useState<Attachment[]>([]);
  const [job, setJob] = useState<MediaGenerationJob>();
  const [error, setError] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const busy = Boolean(job && ["queued", "running", "cancelling"].includes(job.status));
  const mediaModels = providers.flatMap((provider) => provider.enabled === false ? [] : provider.models.flatMap((model) => {
    if (model.enabled === false) return [];
    const verified = Object.values(model.capabilities?.protocols ?? {}).some((capability) => kind === "image" ? capability?.imageGeneration : capability?.videoGeneration);
    const configured = kind === "image" ? Boolean(model.media?.image) : Boolean(model.media?.video?.endpoint);
    return verified || configured ? [{ provider, model, verified, configured }] : [];
  }));
  const selectedMediaModel = mediaModels.find(({ provider, model }) => `${provider.id}:${model.id}` === providerModel);

  useEffect(() => {
    promptRef.current?.focus();
    void window.grokDesktop.listProviders().then(setProviders).catch(() => undefined);
    const removeProgress = window.grokDesktop.onMediaGenerationProgress((value) => setJob((current) => current?.jobId === value.jobId ? value : current));
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); removeProgress(); };
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    if (!prompt.trim() || busy || (route === "provider" && !selectedMediaModel)) return;
    setError("");
    try {
      setJob(await onCreate({
        kind,
        prompt,
        aspectRatio,
        duration,
        resolution,
        referencePaths: references.flatMap((attachment) => attachment.path ? [attachment.path] : []),
        route,
        providerId: selectedMediaModel?.provider.id,
        modelId: selectedMediaModel?.model.id,
      }));
    } catch (value) {
      setError(errorMessage(value));
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section className="control-panel media-studio" role="dialog" aria-modal="true" aria-labelledby="media-studio-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="media-studio-title">Grok 媒体创作</h2><small>独立媒体任务 · 固定工具白名单 · 结果附回当前会话</small></div><button disabled={busy} onClick={onClose}>×</button></header>
      <div className="panel-body media-studio-body">
        <div className="media-kind-tabs">
          <button className={kind === "image" ? "active" : ""} onClick={() => { setKind("image"); setProviderModel(""); setError(""); }}>图片</button>
          <button className={kind === "video" ? "active" : ""} onClick={() => { setKind("video"); setProviderModel(""); setError(""); }}>视频</button>
        </div>
        <label>执行路由<select value={route} disabled={busy} onChange={(event) => setRoute(event.target.value as typeof route)}><option value="auto">自动（优先 Grok CLI）</option><option value="cli">Grok CLI 固定媒体工具</option><option value="provider">指定自定义 Provider / 模型</option></select></label>
        {route === "provider" && <label>Provider 模型<select value={providerModel} disabled={busy} onChange={(event) => setProviderModel(event.target.value)}><option value="">{`请选择已配置或已验证${kind === "image" ? "图片" : "视频"}能力的模型`}</option>{mediaModels.map(({ provider, model, verified }) => <option key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>{provider.name} · {model.name} · {verified ? "已验证" : "手工配置（未验证）"}</option>)}</select>{!mediaModels.length && <small>{`没有启用且已配置${kind === "image" ? "图片传输" : "视频端点"}的 Provider 模型。可在 Provider 编辑器中手工配置，无需先完成深度扫描。`}</small>}</label>}
        <div className="media-capability supported">{route === "provider" ? "Provider 路由接受显式媒体配置；“已验证”表示扫描曾取得真实资产，“手工配置”会直接按所选端点执行并返回明确错误。" : commands.length ? "媒体能力不再依赖斜杠命令清单；主进程直接调用 image_gen / video_gen 白名单。" : "即使 ACP 没有公布 /imagine，仍会通过主进程的固定媒体工具白名单执行。"}</div>
        {!hasGrokConversation && <div className="media-capability new-session">当前没有打开 Grok 会话。开始创作时会新建一个会话，并把结果附到该会话。</div>}
        <label>创作描述<textarea ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === "image" ? "例如：雨夜东京街头，一只撑着透明伞的橘猫，电影感光影" : "例如：一艘飞船缓慢穿过云海，镜头从侧后方平稳跟随"} /></label>
        <label>画面比例<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as MediaAspectRatio)}><option value="auto">自动</option><option value="1:1">1:1 方形</option><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></label>
        {kind === "video" && <div className="media-video-options"><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value) as MediaVideoDuration)}><option value={6}>6 秒</option><option value={10}>10 秒</option></select></label><label>分辨率<select value={resolution} onChange={(event) => setResolution(event.target.value as MediaVideoResolution)}><option value="480p">480p</option><option value="720p">720p</option></select></label></div>}
        {kind === "video" && <div className="media-reference-row"><button disabled={busy} onClick={() => void window.grokDesktop.pickAttachments().then((items) => setReferences(items.filter((item) => item.kind === "image" && Boolean(item.path))))}>添加参考图</button>{references.map((item) => <span key={item.id}>{item.name}<button onClick={() => setReferences((values) => values.filter((value) => value.id !== item.id))}>×</button></span>)}</div>}
        <p className="media-workflow">{kind === "image" ? "图片由 image_gen 生成并保存到当前 Grok 会话。" : "视频会先规划并生成源图，再由 image_to_video 动画化；720p 和 10 秒通常耗时更长。"}</p>
        {job && <div className={`media-job-state ${job.status}`}><strong>{job.message}</strong><progress value={job.progress ?? 0} max={100}/>{job.artifacts.map((artifact) => <button key={artifact.id} onClick={() => void window.grokDesktop.openPath(artifact.source)}>{artifact.name || "打开结果"}</button>)}</div>}
        {(error || job?.error) && <p className="error-text">{error || job?.error}</p>}
        <div className="button-row media-actions"><button disabled={busy} onClick={onClose}>{job?.status === "completed" ? "完成" : "关闭"}</button>{busy ? <button className="danger" onClick={() => job && void window.grokDesktop.cancelMediaGeneration(job.jobId)}>取消生成</button> : <button className="primary" disabled={!prompt.trim() || (route === "provider" && !selectedMediaModel)} onClick={() => void submit()}>{`开始生成${kind === "image" ? "图片" : "视频"}`}</button>}</div>
      </div>
    </section>
  </div>;
}


function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
