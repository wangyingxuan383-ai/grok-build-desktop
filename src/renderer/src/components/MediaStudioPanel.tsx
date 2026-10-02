import {explainMediaFailure} from "../../../shared/media-failure";
import { PanelSurface } from "./ui/PanelSurface";
import { useEffect, useRef, useState } from "react";
import type { Attachment, CustomProviderProfile, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaGenerationJob, MediaVideoDuration, MediaVideoResolution } from "../../../shared/types";

export function MediaStudioPanel({ sessionId, initialPrompt = "", hasGrokConversation, onCreate, onClose }: {
  sessionId?: string;
  initialPrompt?: string;
  hasGrokConversation: boolean;
  commands: Array<{ name: string; description?: string }>;
  onCreate(request: MediaCreationRequest): Promise<MediaGenerationJob>;
  onClose(): void;
}): React.JSX.Element {
  const [kind, setKind] = useState<MediaCreationKind>("image");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>("16:9");
  const [duration, setDuration] = useState<MediaVideoDuration>(6);
  const [resolution, setResolution] = useState<MediaVideoResolution>("480p");
  const [voice, setVoice] = useState("");
  const [projectOutput, setProjectOutput] = useState(true);
  const [outputDirectory, setOutputDirectory] = useState("generated/images");
  const [route, setRoute] = useState<"cli" | "provider">("cli");
  const [providers, setProviders] = useState<CustomProviderProfile[]>([]);
  const [providerModel, setProviderModel] = useState("");
  const [references, setReferences] = useState<Attachment[]>([]);
  const [job, setJob] = useState<MediaGenerationJob>();
  const [error, setError] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const openingSession = useRef(sessionId || "");
  const contextChanged = Boolean(openingSession.current && sessionId !== openingSession.current);
  const pendingProgress = useRef(new Map<string, MediaGenerationJob>());
  const busy = submitting || Boolean(job && ["queued", "running", "cancelling"].includes(job.status));
  const mediaModels = providers.flatMap((provider) => provider.enabled === false ? [] : provider.models.flatMap((model) => {
    if (model.enabled === false) return [];
    const verified = Object.values(model.capabilities?.protocols ?? {}).some((capability) => kind === "image" ? capability?.imageGeneration : capability?.videoGeneration);
    const configured = kind === "image" ? Boolean(model.media?.image) : Boolean(model.media?.video?.endpoint);
    return verified || configured ? [{ provider, model, verified, configured }] : [];
  }));
  const selectedMediaModel = mediaModels.find(({ provider, model }) => `${provider.id}:${model.id}` === providerModel);

  useEffect(() => {
    promptRef.current?.focus();
    let cancelled = false;
    void window.grokDesktop.listProviders().then(values=>{if(!cancelled)setProviders(values)}).catch(() => undefined);
    const removeProgress = window.grokDesktop.onMediaGenerationProgress((value) => { if(submittingRef.current){pendingProgress.current.set(value.jobId,value);if(pendingProgress.current.size>32)pendingProgress.current.delete(pendingProgress.current.keys().next().value!);} setJob((current) => current?.jobId === value.jobId ? value : current); });
    return () => { cancelled = true; removeProgress(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    if (!prompt.trim() || busy || submittingRef.current || contextChanged || (projectOutput && !outputDirectory.trim()) || (route === "provider" && !selectedMediaModel)) return;
    submittingRef.current = true; setSubmitting(true); pendingProgress.current.clear();
    setError("");
    try {
      const created = await onCreate({
        kind,
        prompt,
        aspectRatio,
        duration,
        resolution,
        voice: voice.trim() || undefined,
        projectOutputDirectory: projectOutput ? outputDirectory.trim() : undefined,
        referencePaths: references.flatMap((attachment) => attachment.path ? [attachment.path] : []),
        route,
        providerId: route==="provider"?selectedMediaModel?.provider.id:undefined,
        modelId: route==="provider"?selectedMediaModel?.model.id:undefined,
      });
      if (!openingSession.current) openingSession.current = created.sessionId;
      setJob(pendingProgress.current.get(created.jobId) ?? created);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      submittingRef.current = false; setSubmitting(false); pendingProgress.current.clear();
    }
  };

  return <PanelSurface className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section className="control-panel media-studio" role="dialog" aria-modal="true" aria-labelledby="media-studio-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="media-studio-title">Grok 媒体创作</h2><small>媒体生成 · 结果附回当前会话</small></div><button disabled={busy} onClick={onClose}>×</button></header>
      <div className="panel-body media-studio-body">
        {contextChanged && <p role="alert" className="error-text">当前会话已切换。为避免将图片发送到错误会话，请关闭后从目标会话重新打开。</p>}
        {submitting && <p role="status">正在提交媒体任务，请勿重复提交…</p>}
        <div className="media-kind-tabs">
          <button disabled={busy} className={kind === "image" ? "active" : ""} onClick={() => { setKind("image"); setOutputDirectory(value=>value==="generated/videos"?"generated/images":value); setProviderModel(""); setError(""); }}>图片</button>
          <button disabled={busy} className={kind === "video" ? "active" : ""} onClick={() => { setKind("video"); setOutputDirectory(value=>value==="generated/images"?"generated/videos":value); setProviderModel(""); setError(""); }}>视频</button>
        </div>
        <label>执行路由<select value={route} disabled={busy} onChange={(event) => setRoute(event.target.value as typeof route)}><option value="cli">Grok CLI 固定媒体工具</option><option value="provider">指定自定义 Provider / 模型</option></select></label>
        {route === "provider" && <label>Provider 模型<select value={providerModel} disabled={busy} onChange={(event) => setProviderModel(event.target.value)}><option value="">{`请选择已配置或已验证${kind === "image" ? "图片" : "视频"}能力的模型`}</option>{mediaModels.map(({ provider, model, verified }) => <option key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>{provider.name} · {model.name} · {verified ? "已验证" : "手工配置（未验证）"}</option>)}</select>{!mediaModels.length && <small>{`没有启用且已配置${kind === "image" ? "图片传输" : "视频端点"}的 Provider 模型。可在 Provider 编辑器中手工配置，无需先完成深度扫描。`}</small>}</label>}
        <div className="media-capability">{route === "provider" ? "使用你选择的 Provider 和模型；“手工配置”尚未验证，费用由该服务计算。此路由每次都是独立请求，不携带本会话的生成历史。" : "使用当前 Grok CLI，结果附回此会话。图像模式下同一会话会续接上一轮上下文；失败不会自动切换 Provider，能否生成以执行结果为准。"}</div>
        {!hasGrokConversation && <div className="media-capability new-session">当前没有打开 Grok 会话。开始创作时会新建一个会话，并把结果附到该会话。</div>}
        <label>创作描述<textarea disabled={busy} ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === "image" ? "例如：雨夜东京街头，一只撑着透明伞的橘猫，电影感光影" : "例如：一艘飞船缓慢穿过云海，镜头从侧后方平稳跟随"} /></label>
        <label>画面比例<select disabled={busy} value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as MediaAspectRatio)}><option value="auto">自动</option><option value="1:1">1:1 方形</option><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></label>
        {kind === "video" && <div className="media-video-options"><label>时长<select disabled={busy} value={duration} onChange={(event) => setDuration(Number(event.target.value) as MediaVideoDuration)}>{Array.from({ length: 15 }, (_, index) => index + 1).map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></label><label>分辨率<select disabled={busy} value={resolution} onChange={(event) => setResolution(event.target.value as MediaVideoResolution)}><option value="480p">480p</option><option value="720p">720p</option></select></label><label>参考视频声音<input disabled={busy} value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="留空继承/无声音" /></label></div>}
        {kind === "video" && <div className="media-reference-row"><button disabled={busy} onClick={() => void window.grokDesktop.pickAttachments().then((items) => setReferences(items.filter((item) => item.kind === "image" && Boolean(item.path))))}>添加参考图</button>{references.map((item) => <span key={item.id}>{item.name}<button disabled={busy} onClick={() => setReferences((values) => values.filter((value) => value.id !== item.id))}>×</button></span>)}</div>}
        <label><span><input type="checkbox" checked={projectOutput} disabled={busy} onChange={event=>setProjectOutput(event.target.checked)}/>保存项目副本</span>{projectOutput && <input aria-label="项目内输出目录" disabled={busy} value={outputDirectory} onChange={event=>setOutputDirectory(event.target.value)} placeholder="generated/images"/>}<small>相对当前会话项目的目录；提交后固定位置，不覆盖已有文件。取消勾选仅保留会话媒体副本。</small></label>
        <p className="media-workflow">{kind === "image" ? "预览使用会话媒体副本；项目原图独立保存，删除会话不会删除项目文件。" : "视频会先规划并生成源图，再由 image_to_video 动画化；720p 和 10 秒通常耗时更长。"}</p>
        {job && <div className={`media-job-state ${job.status}`}><strong>{job.message}</strong><progress value={job.progress ?? 0} max={100}/>{job.artifacts.map((artifact) => <button key={artifact.id} onClick={() => void window.grokDesktop.openMedia(artifact.source)}>{artifact.name || "打开结果"}</button>)}</div>}
        {job?.savedProjectFiles?.length ? <div role="status"><strong>已保存到项目</strong>{job.savedProjectFiles.map(path=><p key={path} className="media-output-path">{path}</p>)}</div> : null}
        {job?.outputWarning && <p role="alert" className="warning-text">{job.outputWarning}</p>}
        {(error || job?.error) && <p className="error-text">{explainMediaFailure(error||job?.error||"").summary}</p>}
        <div className="button-row media-actions"><button disabled={busy} onClick={onClose}>{job?.status === "completed" ? "完成" : "关闭"}</button>{job?.stage==="waiting"&&<button onClick={()=>void window.grokDesktop.extendMediaWait(job.jobId).catch(error=>setError(String(error)))}>延长本次等待</button>}{busy ? <button disabled={!job || submitting} className="danger" onClick={() => job && void window.grokDesktop.cancelMediaGeneration(job.jobId).catch(value=>setError(errorMessage(value)))}>取消生成</button> : <button className="primary" disabled={contextChanged || !prompt.trim() || (projectOutput && !outputDirectory.trim()) || (route === "provider" && !selectedMediaModel)} onClick={() => void submit()}>{job?.status === "completed" ? "再次生成（新请求）" : `开始生成${kind === "image" ? "图片" : "视频"}`}</button>}</div>
      </div>
    </section>
  </PanelSurface>;
}


import { errorMessage } from "../error-message";
