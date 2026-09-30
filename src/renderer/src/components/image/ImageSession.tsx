import { useEffect, useRef } from "react";
import type { ImageConversation, ImageRecord } from "../../../../shared/image-workspace";
import type { MediaArtifact } from "../../../../shared/types";
import { UiIcon } from "../../ui-icons";
import { Badge } from "../ui/Display";
import { Button, IconButton } from "../ui/Button";
import { artworkSrc, isRunning } from "./image-model";

export interface SessionActions {
  onPreview(conversation: ImageConversation, artifact: MediaArtifact): void;
  onContinue(conversation: ImageConversation, artifact: MediaArtifact): void;
  onReuse(record: ImageRecord): void;
  onCancel(jobId: string): void;
  onDelete(conversation: ImageConversation, record: ImageRecord): void;
  onDeleteArtifact(conversation: ImageConversation, record: ImageRecord, artifact: MediaArtifact): void;
}

/** The conversation itself: each request as a message, each result beneath it. */
export function ImageThread({ conversation, actions, busy }: { conversation?: ImageConversation; actions: SessionActions; busy: boolean }): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  const count = conversation?.jobs.length ?? 0;
  const last = conversation?.jobs.at(-1)?.job;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [conversation?.id, count, last?.status, last?.artifacts.length]);
  if (!conversation || !conversation.jobs.length) {
    return (
      <div className="im-empty">
        <UiIcon name="sparkles" size={26} />
        <h2>想生成什么图像？</h2>
        <p>描述画面，或添加一张参考图来修改。续接上一轮时，只要这个会话的原历史仍可用，就能接着说“再暖一点”“换成竖版”。</p>
      </div>
    );
  }
  return (
    <div className="im-thread">
      {conversation.jobs.map((record) => <Turn key={record.job.jobId} conversation={conversation} record={record} actions={actions} busy={busy} />)}
      <div ref={end} />
    </div>
  );
}

function Turn({ conversation, record, actions, busy }: { conversation: ImageConversation; record: ImageRecord; actions: SessionActions; busy: boolean }): React.JSX.Element {
  const { job } = record;
  const running = isRunning(job);
  const images = job.artifacts.filter((artifact) => artifact.media === "image");
  const references = [...(record.references?.names ?? []), ...(record.references?.sources ?? []).map(() => "历史作品")];
  return (
    <article className="im-turn">
      <div className="im-user">
        <p>{record.prompt}</p>
        {(record.aspectRatio || references.length > 0) && (
          <div className="im-user-meta">
            {record.aspectRatio && record.aspectRatio !== "auto" && <Badge>{record.aspectRatio}</Badge>}
            {references.map((name, index) => <Badge key={index}><UiIcon name="image" size={11} />{name}</Badge>)}
          </div>
        )}
      </div>
      <div className="im-result">
        {running && (
          <div className="im-status running">
            <UiIcon name="loader" size={15} className="ui-spin" />
            <span>{job.message || "正在生成"}</span>
            <Button size="sm" variant="secondary" disabled={job.status === "cancelling"} onClick={() => actions.onCancel(job.jobId)}>{job.status === "cancelling" ? "正在取消" : "取消"}</Button>
          </div>
        )}
        {job.status === "failed" && (
          <div className="im-status failed" role="alert">
            <UiIcon name="alert" size={15} />
            <div><strong>生成失败</strong><p>{job.error || job.message}</p></div>
          </div>
        )}
        {job.status === "cancelled" && <div className="im-status"><UiIcon name="stop" size={14} /><span>已取消</span></div>}
        {job.status === "completed" && !images.length && <div className="im-status failed"><UiIcon name="alert" size={15} /><div><strong>没有得到图片</strong><p>{job.message}</p></div></div>}
        {images.length > 0 && (
          <div className={`im-grid n${Math.min(images.length, 4)}`}>
            {images.map((artifact) => {
              const src = artworkSrc(artifact, conversation.id, true);
              return (
                <figure className="im-art" key={artifact.id}>
                  <button type="button" className="im-art-open" aria-label="查看大图" onClick={() => actions.onPreview(conversation, artifact)}>
                    {src ? <img loading="lazy" src={src} alt={record.prompt} /> : <span className="im-art-missing">图片不可用</span>}
                  </button>
                  <div className="im-art-actions">
                    <IconButton icon="wand" label="以此图继续修改" size="sm" disabled={busy} onClick={() => actions.onContinue(conversation, artifact)} />
                    <IconButton icon="trash" label="删除这张图片" size="sm" onClick={() => actions.onDeleteArtifact(conversation, record, artifact)} />
                  </div>
                </figure>
              );
            })}
          </div>
        )}
        {job.contextReset && <p className="im-note warn">此会话的早前上下文已不可用（原 CLI 会话已不存在），本轮是新的上下文。</p>}
        {job.outputWarning && <p className="im-note warn">{job.outputWarning}</p>}
        {!running && (
          <div className="im-turn-actions">
            <Button size="sm" variant="ghost" icon="retry" disabled={busy} onClick={() => actions.onReuse(record)}>用此描述再来一次</Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => actions.onDelete(conversation, record)}>删除记录</Button>
          </div>
        )}
      </div>
    </article>
  );
}
