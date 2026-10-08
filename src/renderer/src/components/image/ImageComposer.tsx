import { useEffect, useRef } from "react";
import type { Attachment, CustomProviderProfile, MediaAccessHandle, MediaAspectRatio } from "../../../../shared/types";
import { UiIcon } from "../../ui-icons";
import { ActionMenu, type UiAction } from "../ui/ActionMenu";
import { Button, IconButton } from "../ui/Button";
import { artworkSrc, ASPECT_OPTIONS } from "./image-model";

export interface ProviderModelOption { value: string; label: string }
export type ImageRoute = "cli" | "provider";

export interface ComposerState {
  draft: string;
  ratio: MediaAspectRatio;
  route: ImageRoute;
  model: string;
  cliModel: string;
  references: Attachment[];
  sources: Array<{ source: string; label: string }>;
}

/** Prompt box for image work: reference chips above, options and the send button below. */
export function ImageComposer(props: {
  state: ComposerState;
  models: ProviderModelOption[];
  cliModels?:ProviderModelOption[];
  modelsLoading?:boolean;
  onRefreshModels?():void;
  busy: boolean;
  hero?: boolean;
  codeImages?: MediaAccessHandle[];
  onChange(patch: Partial<ComposerState>): void;
  onSubmit(): void;
  onPickReferences(): void;
  onPickFromCode(): void;
  onPickCodeImage(image: MediaAccessHandle): void;
  onCloseCodeImages(): void;
}): React.JSX.Element {
  const { state, busy } = props;
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [state.draft]);
  const hasReference = state.references.length > 0 || state.sources.length > 0;
  const providerBlocked = state.route === "provider" && (!state.model || hasReference);
  const cliModelInvalid=state.route==="cli"&&!props.cliModels?.some(model=>model.value===state.cliModel);
  const canSend = !busy && !props.modelsLoading && state.draft.trim().length > 0 && !providerBlocked && !cliModelInvalid;
  const addMenu: UiAction[] = [
    { id: "file", label: "从电脑选择参考图", icon: <UiIcon name="folder" />, run: props.onPickReferences },
    { id: "code", label: "从代码会话的图片中选择", icon: <UiIcon name="code" />, run: props.onPickFromCode },
  ];
  return (
    <section className={`im-composer${props.hero ? " hero" : ""}`} aria-label="图像创作">
      {props.codeImages && (
        <div className="im-code-images" role="group" aria-label="代码会话图片">
          <header><strong>代码会话里的图片</strong><button type="button" onClick={props.onCloseCodeImages}>关闭</button></header>
          {props.codeImages.length ? (
            <div className="im-code-grid">
              {props.codeImages.map((image) => (
                <button type="button" key={image.id} title={image.name} disabled={busy} onClick={() => props.onPickCodeImage(image)}>
                  <img loading="lazy" alt={image.name} src={artworkSrc({ id: image.id, media: "image", source: image.url }, image.sessionId, true)} />
                </button>
              ))}
            </div>
          ) : <p>本机缓存里没有代码会话生成的图片。</p>}
        </div>
      )}
      {hasReference && (
        <div className="im-refs">
          {state.references.map((file) => (
            <span className="im-chip" key={file.id}><UiIcon name="image" size={13} />{file.name}<button type="button" aria-label={`移除 ${file.name}`} disabled={busy} onClick={() => props.onChange({ references: state.references.filter((value) => value.id !== file.id) })}><UiIcon name="close" size={12} /></button></span>
          ))}
          {state.sources.map((item) => (
            <span className="im-chip" key={item.source}><UiIcon name="images" size={13} />{item.label}<button type="button" aria-label="移除参考作品" disabled={busy} onClick={() => props.onChange({ sources: state.sources.filter((value) => value.source !== item.source) })}><UiIcon name="close" size={12} /></button></span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        value={state.draft}
        rows={props.hero ? 3 : 2}
        disabled={busy}
        aria-label="图像描述"
        placeholder={hasReference ? "说明想怎样修改这张图…" : "描述想要的图像；继续对话可以直接说“再亮一点”“换成竖版”"}
        onChange={(event) => props.onChange({ draft: event.target.value })}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) props.onSubmit(); } }}
      />
      <div className="im-options">
        <ActionMenu align="start" actions={addMenu} trigger={<button type="button" className="ui-icon-btn ui-icon-btn-md" aria-label="添加参考图" title="添加参考图" disabled={busy}><UiIcon name="plus" /></button>} />
        <label className="im-select"><span className="visually-hidden">图片比例</span>
          <select aria-label="图片比例" value={state.ratio} disabled={busy} onChange={(event) => props.onChange({ ratio: event.target.value as MediaAspectRatio })}>
            {ASPECT_OPTIONS.map((value) => <option key={value} value={value}>{value === "auto" ? "比例：自动" : value}</option>)}
          </select>
        </label>
        <label className="im-select"><span className="visually-hidden">生成路由</span>
          <select aria-label="生成路由" title={state.route === "cli" ? "调度模型负责调用 CLI 的生图工具；图片后端由 CLI 配置决定。使用当前账号，不会自动切换到 Provider 生图。" : "Provider 路由每次都是独立请求，不会续接这个会话的上一轮内容。"} value={state.route} disabled={busy} onChange={(event) => props.onChange({ route: event.target.value as ImageRoute })}>
            <option value="cli">Grok CLI</option>
            <option value="provider">自定义 Provider</option>
          </select>
        </label>
        {state.route === "provider" && (
          <label className="im-select"><span className="visually-hidden">图片模型</span>
            <select aria-label="图片模型" value={state.model} disabled={busy} onChange={(event) => props.onChange({ model: event.target.value })}>
              <option value="">选择图片模型</option>
              {props.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        )}
        {state.route==="cli"&&<><label className="im-select"><span className="visually-hidden">CLI 调度模型</span><select aria-label="CLI 调度模型" value={state.cliModel} disabled={busy||props.modelsLoading} onChange={event=>props.onChange({cliModel:event.target.value})}><option value="">选择调度模型</option>{state.cliModel&&cliModelInvalid&&<option disabled value={state.cliModel}>{state.cliModel}（当前不可用）</option>}{props.cliModels?.map(model=><option key={model.value} value={model.value}>{model.label}</option>)}</select></label><IconButton icon="refresh" label={props.modelsLoading?"正在读取模型…":"刷新模型"} className={props.modelsLoading?"is-spinning":undefined} disabled={busy||props.modelsLoading} onClick={props.onRefreshModels}/></>}
        <span className="im-spacer" />
        <Button variant="primary" loading={busy} disabled={!canSend} onClick={props.onSubmit}>{busy ? "生成中" : "生成"}</Button>
      </div>
      {state.route === "provider" && hasReference && <p className="im-note warn" role="status">此 Provider 的图片编辑接口尚未接入；请改用 Grok CLI，或移除参考图。</p>}
      {cliModelInvalid&&!props.modelsLoading&&<p className="im-note warn" role="status">{state.cliModel?`原选择 ${state.cliModel} 已不在当前目录中，请重新选择。`:"请选择当前可用的调度模型。"}</p>}
    </section>
  );
}

export function providerImageModels(providers: readonly CustomProviderProfile[]): ProviderModelOption[] {
  return providers.flatMap((provider) => provider.enabled === false ? [] : provider.models
    .filter((model) => model.enabled !== false && (model.media?.image || Object.values(model.capabilities?.protocols ?? {}).some((value) => value?.imageGeneration)))
    .map((model) => ({ value: `${provider.id}:${model.id}`, label: `${provider.name} · ${model.name}` })));
}
