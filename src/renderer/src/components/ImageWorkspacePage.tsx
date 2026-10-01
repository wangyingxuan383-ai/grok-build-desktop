import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageConversation, ImageRecord, ImageWorkspace } from "../../../shared/image-workspace";
import type { CustomProviderProfile, MediaAccessHandle, MediaArtifact } from "../../../shared/types";
import type { ArtifactPreviewTarget } from "../artifact-preview";
import { UiIcon } from "../ui-icons";
import { AppShell } from "./AppShell";
import { ArtifactPreviewPane } from "./ArtifactPreviewPane";
import { ActionMenu, type UiAction } from "./ui/ActionMenu";
import { Button, IconButton } from "./ui/Button";
import { UiDialog } from "./ui/primitives";
import { ImageComposer, providerImageModels, type ComposerState } from "./image/ImageComposer";
import { ImageGallery, type GalleryRemoval } from "./image/ImageGallery";
import { ImageSidebar, type ImageView } from "./image/ImageSidebar";
import { ImageThread, type SessionActions } from "./image/ImageSession";
import { collectWorks, isRunning, sessionStats } from "./image/image-model";
import "../styles/image-studio.css";

const NEW_DRAFT_KEY = "grok.image-new-draft.v1";
const DRAFT_RECOVERY_KEY = "grok.image-drafts.v1";

type Pending =
  | { kind: "records"; items: GalleryRemoval["records"] }
  | { kind: "conversation"; conversation: ImageConversation };

/**
 * Image mode. It lives in the same frame as coding mode (sidebar + framed pane + optional right pane), so
 * switching modes changes the content, not the layout. A session is a real conversation that keeps its
 * context between generations; the gallery is a separate page across all sessions.
 */
export function ImageWorkspacePage({ onCode, onPanel, onNotice }: { onCode(): void; onPanel?(panel: "settings" | "accounts" | "diagnostics"): void; onNotice?(message: string): void }): React.JSX.Element {
  const [data, setData] = useState<ImageWorkspace>();
  const [active, setActive] = useState("");
  const [view, setView] = useState<ImageView>("session");
  const [collapsed, setCollapsed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>((): Record<string, string> => {
    try { return { ...JSON.parse(localStorage.getItem(DRAFT_RECOVERY_KEY) || "{}"), "": localStorage.getItem(NEW_DRAFT_KEY) || "" }; } catch { return {}; }
  });
  const [options, setOptions] = useState<Pick<ComposerState, "ratio" | "route" | "model">>({ ratio: "1:1", route: "cli", model: "" });
  const [references, setReferences] = useState<ComposerState["references"]>([]);
  const [sources, setSources] = useState<ComposerState["sources"]>([]);
  const [providers, setProviders] = useState<CustomProviderProfile[]>([]);
  const [codeImages, setCodeImages] = useState<MediaAccessHandle[]>();
  const [preview, setPreview] = useState<ArtifactPreviewTarget>();
  const [pinned,setPinned]=useState<Array<Extract<ArtifactPreviewTarget,{kind:"media"}>>>(()=>{
    try{return (JSON.parse(localStorage.getItem("grok-image-pins-v1")||"[]") as unknown[]).filter((row):row is Extract<ArtifactPreviewTarget,{kind:"media"}>=>Boolean(row&&typeof row==="object"&&(row as any).kind==="media"&&typeof(row as any).sessionId==="string"&&typeof(row as any).messageId==="string"&&typeof(row as any).source==="string"&&(row as any).source.startsWith("grok-media:")&&typeof(row as any).workspace==="string")).slice(0,12);}catch{return []}
  });
  useEffect(()=>{try{localStorage.setItem("grok-image-pins-v1",JSON.stringify(pinned));}catch{/* View references are optional. */}},[pinned]);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string }>();

  const alive = useRef(true);
  const navigation = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submittingRef = useRef(false);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const conversations = data?.conversations ?? [];
  const row = conversations.find((value) => value.id === active);
  const draft = drafts[active] ?? row?.draft ?? "";
  const busy = submitting || Boolean(row?.jobs.some((record) => isRunning(record.job)));
  const models = useMemo(() => providerImageModels(providers), [providers]);
  const workCount = useMemo(() => collectWorks(conversations).length, [conversations]);

  const fail = useCallback((value: unknown): void => { if (alive.current) setError(value instanceof Error ? value.message : String(value)); }, []);
  useEffect(()=>{
    if(!data)return;
    setPinned(values=>{const valid=values.filter(target=>data.conversations.some(row=>row.id===target.sessionId&&row.jobs.some(record=>record.job.artifacts.some(artifact=>artifact.id===target.messageId))));return valid.length===values.length?values:valid;});
  },[data]);
  const refreshSequence=useRef(0);
  const refresh = useCallback(async (): Promise<ImageWorkspace> => {
    const sequence=++refreshSequence.current;
    const value = await window.grokDesktop.listImageWorkspace();
    if (alive.current && sequence===refreshSequence.current) setData(value);
    return value;
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh().catch(fail);
    void window.grokDesktop.listProviders().then(setProviders).catch(fail);
    const off = window.grokDesktop.onMediaGenerationProgress((job) => setData((value) => value ? {
      ...value,
      conversations: value.conversations.map((conversation) => conversation.id === job.sessionId
        ? { ...conversation, jobs: conversation.jobs.map((record) => record.job.jobId === job.jobId ? { ...record, job } : record) }
        : conversation),
    } : value));
    return () => { alive.current = false; clearTimeout(saveTimer.current); off(); };
  }, [fail, refresh]);

  const changeDraft = (value: string): void => {
    if (!active) { try { localStorage.setItem(NEW_DRAFT_KEY, value); } catch { /* the draft just isn't remembered */ } }
    setDrafts((current) => ({ ...current, [active]: value }));
    try { localStorage.setItem(DRAFT_RECOVERY_KEY, JSON.stringify({ ...draftsRef.current, [active]: value })); } catch { /* main persistence remains available */ }
    if (active) {
      clearTimeout(saveTimer.current);
      const id = active;
      saveTimer.current = setTimeout(() => { void window.grokDesktop.saveImageDraft(id, value).catch(fail); }, 300);
    }
  };
  const flush = async (): Promise<void> => {
    clearTimeout(saveTimer.current);
    if (active && draftsRef.current[active] !== undefined) await window.grokDesktop.saveImageDraft(active, draftsRef.current[active]!);
  };
  /**
   * Leaves for coding mode. Switching modes is navigation, not a save, so a failed write must not
   * trap the user here: the draft stays on screen in this session and the failure is reported.
   */
  const leaveForCode = (): void => {
    void flush().catch(reason => onNotice?.(`图像草稿保存失败；本机恢复副本已保留：${reason instanceof Error ? reason.message : String(reason)}`));
    onCode();
  };
  const resetAttachments = (): void => { setReferences([]); setSources([]); setCodeImages(undefined); };

  const show = async (id: string, next: ImageView = "session"): Promise<boolean> => {
    const request = ++navigation.current;
    try {
      await flush();
      if (request !== navigation.current) return false;
      setActive(id); setView(next); resetAttachments(); setError("");
      return true;
    } catch (reason) { fail(reason); return false; }
  };

  const submit = async (): Promise<void> => {
    if (!draft.trim() || busy || submittingRef.current) return;
    const selected = models.find((value) => value.value === options.model);
    if (options.route === "provider" && !selected) return;
    const at = navigation.current;
    submittingRef.current = true; setSubmitting(true); setError(""); clearTimeout(saveTimer.current);
    try {
      let id = active;
      if (!id) {
        // A session is created by its first request, so abandoned "new" pages leave nothing behind.
        const created = await window.grokDesktop.createImageConversation();
        id = created.id;
        setData((value) => value ? { ...value, conversations: [...value.conversations, created] } : value);
        if (navigation.current === at) { setActive(id); setView("session"); }
      }
      const [providerId, modelId] = selected ? selected.value.split(/:(.*)/s) : [undefined, undefined];
      const job = await window.grokDesktop.submitImage({
        conversationId: id,
        // A stable request identity survives an uncertain response; nothing is resubmitted automatically.
        requestId: crypto.randomUUID(),
        referenceSources: sources.map((item) => item.source),
        request: { kind: "image", prompt: draft, aspectRatio: options.ratio, route: options.route, providerId, modelId, referencePaths: references.flatMap((value) => value.path ? [value.path] : []) },
      });
      if (!alive.current) return;
      if (!active) { try { localStorage.removeItem(NEW_DRAFT_KEY); } catch { /* ignore */ } }
      setDrafts((value) => ({ ...value, [id]: "", ...(!active ? { "": "" } : {}) }));
      try { localStorage.setItem(DRAFT_RECOVERY_KEY, JSON.stringify({ ...draftsRef.current, [id]: "", ...(!active ? { "": "" } : {}) })); } catch { /* best effort */ }
      if (navigation.current === at) resetAttachments();
      await refresh();
      if (job.error && navigation.current === at) setError(job.error);
    } catch (reason) { fail(reason); await refresh().catch(fail); }
    finally { submittingRef.current = false; if (alive.current) setSubmitting(false); }
  };

  const actions: SessionActions = {
    onPreview: (conversation, artifact) => setPreview(previewTarget(conversation, artifact)),
    onContinue: (conversation, artifact) => {
      void show(conversation.id).then((ok) => { if (ok) setSources([{ source: artifact.source, label: "所选作品" }]); });
    },
    onReuse: (record: ImageRecord) => {
      changeDraft(record.prompt);
    },
    onCancel: (jobId) => { void window.grokDesktop.cancelMediaGeneration(jobId).catch(fail); },
    onDelete: (conversation, record) => setPending({ kind: "records", items: [{ conversation, record }] }),
    onDeleteArtifact: (conversation, record, artifact) => setPending({ kind: "records", items: [{ conversation, record, artifactId: artifact.id }] }),
  };

  const confirmRemoval = async (deleteFiles: boolean): Promise<void> => {
    if (!pending) return;
    setRemoving(true);
    try {
      if (pending.kind === "conversation") {
        const id = pending.conversation.id;
        clearTimeout(saveTimer.current);
        const receipt = await window.grokDesktop.deleteImageConversation(id, deleteFiles);
        if (!receipt.recordRemoved) {
          setError(receipt.cleanupError || `有 ${receipt.keptFiles.length} 个文件未能删除。会话记录保留，可重试或仅移除记录。`);
        } else {
          if (active === id) { navigation.current++; setActive(""); setView("gallery"); resetAttachments(); }
          setDrafts(value => { const next = { ...value }; delete next[id]; try { localStorage.setItem(DRAFT_RECOVERY_KEY, JSON.stringify(next)); } catch {} return next; });
        }
      } else {
        let kept = 0;
        for (const { conversation, record, artifactId } of pending.items) {
          // One picture selected in the gallery removes that picture; the record goes only if it is
          // left with nothing, which matches what the user picked.
          const result = artifactId
            ? await window.grokDesktop.deleteImageArtifact(conversation.id, record.job.jobId, artifactId, deleteFiles)
            : await window.grokDesktop.deleteImageJob(conversation.id, record.job.jobId, deleteFiles);
          kept += result.keptFiles.length;
        }
        if (kept) setError(`有 ${kept} 个文件未能删除，对应记录已保留。文件已修改、仍被引用或缺少旧版来源证明时，可选择仅移除记录后手动管理文件；其他错误可重试。`);
      }
      setPending(undefined); setPreview(undefined);
    } catch (reason) { setPending(undefined); fail(reason); }
    finally { setRemoving(false); await refresh().catch(fail); }
  };

  const commitRename = async (): Promise<void> => {
    const target = renaming;
    setRenaming(undefined);
    if (!target || !target.value.trim() || target.value.trim() === conversations.find((value) => value.id === target.id)?.title) return;
    try { await window.grokDesktop.renameImageConversation(target.id, target.value.trim()); await refresh(); } catch (reason) { fail(reason); }
  };

  const pickReferences = (): void => {
    const at = navigation.current;
    void window.grokDesktop.pickAttachments().then((values) => {
      if (at === navigation.current) setReferences(values.filter((value) => value.kind === "image" && Boolean(value.path)).slice(0, 8));
    }).catch(fail);
  };
  const loadCodeImages = (): void => { void window.grokDesktop.listCodeImages().then(setCodeImages).catch(fail); };
  const pickRoot = (): void => { void window.grokDesktop.pickImageOutputRoot().then(() => refresh()).catch(fail); };
  const openFolder = (conversation: ImageConversation): void => {
    void window.grokDesktop.openTarget({ target: conversation.cwd, executionRoot: conversation.cwd, action: "open" }).then((result) => { if (!result.ok) setError(result.message); }).catch(fail);
  };

  const composer: ComposerState = { draft, ...options, references, sources };
  const title = view === "gallery" ? "图库" : row?.title || "新图像会话";
  const headerActions: UiAction[] = row && view === "session" ? [
    { id: "rename", label: "重命名", icon: <UiIcon name="edit" />, run: () => setRenaming({ id: row.id, value: row.title }) },
    { id: "open", label: "打开保存文件夹", icon: <UiIcon name="folder" />, run: () => openFolder(row) },
    { id: "delete", label: "删除会话…", icon: <UiIcon name="trash" />, danger: true, separatorBefore: true, disabled: busy, reason: busy ? "请先取消正在运行的任务" : undefined, run: () => setPending({ kind: "conversation", conversation: row }) },
  ] : [];
  const stats = row ? sessionStats(row) : undefined;

  return (
    <AppShell
      className={`app-shell image-shell${collapsed ? " sidebar-collapsed" : ""}${preview ? " right-tool-open" : ""}`}
      sidebar={
        <ImageSidebar
          conversations={conversations}
          activeId={active}
          view={view}
          outputRoot={data?.outputRoot}
          workCount={workCount}
          onMode={(mode) => { if (mode === "code") leaveForCode(); }}
          onNew={() => { void show("").then((ok) => { if (ok) setPreview(undefined); }); }}
          onGallery={() => { void show("", "gallery"); }}
          onSelect={(id) => { void show(id); }}
          onRename={(conversation) => { void show(conversation.id).then((ok) => { if (ok) setRenaming({ id: conversation.id, value: conversation.title }); }); }}
          onDelete={(conversation) => setPending({ kind: "conversation", conversation })}
          onPickRoot={pickRoot}
          onSettings={onPanel ? () => onPanel("settings") : undefined}
          onAccounts={onPanel ? () => onPanel("accounts") : undefined}
          onDiagnostics={onPanel ? () => onPanel("diagnostics") : undefined}
        />
      }
    >
      <main className="main-pane image-pane">
        <header className="topbar">
          <IconButton icon="panel-left" label="显示或隐藏左侧栏" onClick={() => setCollapsed((value) => !value)} />
          <div className="tb-title">
            {renaming && view === "session" && renaming.id === active ? (
              <input
                className="im-rename"
                autoFocus
                aria-label="会话名称"
                value={renaming.value}
                maxLength={80}
                onChange={(event) => setRenaming({ id: renaming.id, value: event.target.value })}
                onBlur={() => void commitRename()}
                onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); if (event.key === "Escape") setRenaming(undefined); }}
              />
            ) : <strong className="tb-title-text">{title}</strong>}
            {view === "session" && stats && stats.works > 0 && <span className="tb-context">{stats.works} 张图片</span>}
          </div>
          <span className="tb-spacer" />
          {view === "session" && <Button size="sm" variant="ghost" icon="images" onClick={() => { void show("", "gallery"); }}>图库</Button>}
          {headerActions.length > 0 && <ActionMenu actions={headerActions} onError={fail} trigger={<button type="button" className="ui-icon-btn ui-icon-btn-md" aria-label="会话操作"><UiIcon name="more" /></button>} />}
        </header>

        {error && (
          <div className="im-banner" role="alert">
            <UiIcon name="alert" size={15} /><span>{error}</span>
            <Button size="sm" variant="ghost" onClick={() => { setError(""); void refresh().catch(fail); }}>检查任务状态</Button>
            <IconButton icon="close" label="关闭提示" size="sm" onClick={() => setError("")} />
          </div>
        )}
        {pinned.length>0&&<nav className="image-pinned" aria-label="固定的图片视图">{pinned.map(target=><span key={`${target.sessionId}:${target.messageId}`}><button className={preview?.kind==="media"&&preview.messageId===target.messageId?"active":""} onClick={()=>setPreview(target)}>图片 {target.messageId.slice(0,6)}</button><IconButton size="sm" icon="close" label="关闭固定的图片视图" onClick={()=>setPinned(values=>values.filter(value=>value.messageId!==target.messageId||value.sessionId!==target.sessionId))}/></span>)}</nav>}
        {!data && !error && <p className="im-loading" role="status">正在读取图像会话…</p>}

        {view === "gallery" ? (
          <ImageGallery
            conversations={conversations}
            onPreview={(conversation, artifact) => setPreview(previewTarget(conversation, artifact))}
            onOpenSession={(id) => { void show(id); }}
            onRemove={(removal) => setPending({ kind: "records", items: removal.records })}
          />
        ) : (
          <div className="im-session">
            <div className="im-scroll"><ImageThread conversation={row} actions={actions} busy={busy} /></div>
            <ImageComposer
              state={composer}
              models={models}
              busy={busy}
              hero={!row?.jobs.length}
              codeImages={codeImages}
              onChange={(patch) => {
                const { draft: nextDraft, references: nextReferences, sources: nextSources, ...rest } = patch;
                if (nextDraft !== undefined) changeDraft(nextDraft);
                if (nextReferences) setReferences(nextReferences);
                if (nextSources) setSources(nextSources);
                if (Object.keys(rest).length) setOptions((value) => ({ ...value, ...rest as Partial<typeof value> }));
              }}
              onSubmit={() => void submit()}
              onPickReferences={pickReferences}
              onPickFromCode={loadCodeImages}
              onPickCodeImage={(image) => { setSources([{ source: image.url, label: image.name || "代码会话图片" }]); setCodeImages(undefined); }}
              onCloseCodeImages={() => setCodeImages(undefined)}
            />
          </div>
        )}
      </main>

      {preview && (
        <ArtifactPreviewPane
          target={preview}
          onClose={() => setPreview(undefined)}
          onPin={() => undefined}
          onPinMedia={target=>setPinned(values=>values.some(value=>value.sessionId===target.sessionId&&value.messageId===target.messageId)?values:[...values.slice(-11),target])}
          onRecoverMedia={async()=>{
            const target=preview;if(target.kind!=="media")return;
            const conversation=conversations.find(value=>value.id===target.sessionId);
            const record=conversation?.jobs.find(value=>value.job.artifacts.some(artifact=>artifact.id===target.messageId));
            if(!conversation||!record)throw Error("图片记录已删除，不能恢复原图");
            const original=await window.grokDesktop.previewImageOriginal(conversation.id,record.job.jobId,target.messageId);
            setPreview(current=>current===target?{...target,source:original.source,isData:original.isData}:current);
          }}
          onReturn={(id) => { setPreview(undefined); void show(id); }}
          onError={fail}
        />
      )}

      <UiDialog title={pending?.kind === "conversation" ? "删除图像会话" : "删除图片或记录"} open={Boolean(pending)} onOpenChange={(open) => { if (!open && !removing) setPending(undefined); }}>
        {pending && (
          <>
            <p className="im-dialog-copy">
              {pending.kind === "conversation"
                ? `删除会话“${pending.conversation.title}”及其 ${pending.conversation.jobs.length} 条生成记录？`
                : pending.items.length === 1 ? pending.items[0]?.artifactId ? "删除这张图片？同次生成的其他图片会保留。" : "删除这条生成记录？" : `删除选中的 ${pending.items.length} 张图片或记录？`}
              {" "}仅移除记录会保留已保存的图片；同时删除会清理可核验的原图、保存副本及预览缓存。旧版记录没有内容归属证明时保留现存文件；可仅移除记录后手动管理文件。
            </p>
            <div className="ui-dialog-actions">
              <Button variant="ghost" disabled={removing} onClick={() => setPending(undefined)}>取消</Button>
              <Button variant="secondary" disabled={removing} onClick={() => void confirmRemoval(false)}>仅移除记录</Button>
              <Button variant="danger" loading={removing} onClick={() => void confirmRemoval(true)}>同时删除图片文件</Button>
            </div>
          </>
        )}
      </UiDialog>
    </AppShell>
  );
}

function previewTarget(conversation: ImageConversation, artifact: MediaArtifact): ArtifactPreviewTarget {
  return { kind: "media", sessionId: conversation.id, messageId: artifact.id, media: "image", source: artifact.source, isData: artifact.isData, workspace: conversation.cwd, mimeType: artifact.mimeType };
}
