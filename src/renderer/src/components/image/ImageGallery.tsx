import { useEffect, useMemo, useState } from "react";
import type { ImageConversation, ImageRecord } from "../../../../shared/image-workspace";
import type { MediaArtifact } from "../../../../shared/types";
import { UiIcon } from "../../ui-icons";
import { Button } from "../ui/Button";
import { EmptyState, Segmented } from "../ui/Display";
import { artworkSrc, collectMisses, collectWorks, recordKey, whenLabel, type Miss, type Work } from "./image-model";

type Filter = "all" | "done" | "failed";
type Tile = { kind: "work"; at: string; work: Work } | { kind: "miss"; at: string; miss: Miss };

/**
 * What the removal dialog acts on. `artifact` is set when the user picked one picture out of a
 * batch, so choosing one image can never delete its siblings along with it.
 */
export interface GalleryRemoval { records: Array<{ conversation: ImageConversation; record: ImageRecord; artifactId?: string }> }

/** Every picture and every failed attempt across sessions, with multi-select removal. */
export function ImageGallery({ conversations, onPreview, onOpenSession, onRemove }: {
  conversations: ImageConversation[];
  onPreview(conversation: ImageConversation, artifact: MediaArtifact): void;
  onOpenSession(id: string): void;
  onRemove(removal: GalleryRemoval): void;
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const works = useMemo(() => collectWorks(conversations), [conversations]);
  const misses = useMemo(() => collectMisses(conversations), [conversations]);
  const tiles: Tile[] = useMemo(() => {
    const all: Tile[] = [
      ...(filter === "failed" ? [] : works.map((work): Tile => ({ kind: "work", at: work.at, work }))),
      ...(filter === "done" ? [] : misses.map((miss): Tile => ({ kind: "miss", at: miss.at, miss }))),
    ];
    return all.sort((left, right) => right.at.localeCompare(left.at));
  }, [filter, works, misses]);

  // A work tile is one picture, so its identity includes the artifact; a failed record is one entry.
  const keyOf = (tile: Tile): string => tile.kind === "work" ? tile.work.key : tile.miss.key;
  const toggle = (key: string): void => setPicked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const leave = (): void => { setSelecting(false); setPicked(new Set()); };
  const removeSelected = (): void => {
    const records: GalleryRemoval["records"] = [];
    const seen = new Set<string>();
    for (const tile of tiles) {
      const key = keyOf(tile);
      if (!picked.has(key) || seen.has(key)) continue;
      seen.add(key);
      records.push(tile.kind === "work"
        ? { conversation: tile.work.conversation, record: tile.work.record, artifactId: tile.work.artifact.id }
        : { conversation: tile.miss.conversation, record: tile.miss.record });
    }
    if (records.length) onRemove({ records });
  };
  const selectAll = (): void => setPicked(new Set(tiles.map(keyOf)));
  useEffect(() => { const live = new Set(tiles.map(tile => tile.kind === "work" ? tile.work.key : tile.miss.key)); setPicked(current => new Set([...current].filter(key => live.has(key)))); }, [tiles]);

  return (
    <div className="im-gallery">
      <div className="im-gallery-bar">
        <Segmented<Filter> label="筛选" size="sm" value={filter} onChange={setFilter} items={[{ value: "all", label: `全部 ${works.length + misses.length}` }, { value: "done", label: `图片 ${works.length}` }, { value: "failed", label: `失败 ${misses.length}` }]} />
        <span className="im-spacer" />
        {selecting ? (
          <>
            <Button size="sm" variant="ghost" onClick={selectAll}>全选</Button>
            <Button size="sm" variant="ghost" onClick={leave}>完成</Button>
          </>
        ) : <Button size="sm" variant="secondary" disabled={!tiles.length} onClick={() => setSelecting(true)}>选择</Button>}
      </div>
      {!tiles.length ? (
        <EmptyState icon="images" title={filter === "failed" ? "没有失败记录" : "图库还是空的"} hint="在图像会话里生成的图片会汇集到这里；失败的尝试也会留在“失败”里，方便清理。" />
      ) : (
        <div className="im-masonry">
          {tiles.map((tile) => {
            const key = keyOf(tile);
            const isPicked = picked.has(key);
            if (tile.kind === "miss") {
              const { conversation, record } = tile.miss;
              return (
                <div className={`im-tile miss${isPicked ? " picked" : ""}`} key={tile.miss.key}>
                  <button type="button" className="im-tile-body" onClick={() => selecting ? toggle(key) : onOpenSession(conversation.id)}>
                    <UiIcon name={record.job.status === "cancelled" ? "stop" : "alert"} size={16} />
                    <strong>{record.job.status === "cancelled" ? "已取消" : "生成失败"}</strong>
                    <p className="prompt">{record.prompt}</p>
                    {record.job.error && <p className="reason">{record.job.error}</p>}
                    <small>{conversation.title} · {whenLabel(tile.at)}</small>
                  </button>
                  {selecting && <span className={`im-check${isPicked ? " on" : ""}`} aria-hidden="true">{isPicked && <UiIcon name="check" size={13} />}</span>}
                  {!selecting && <button type="button" className="im-tile-x" aria-label="删除这条失败记录" title="删除这条记录" onClick={() => onRemove({ records: [{ conversation, record }] })}><UiIcon name="trash" size={14} /></button>}
                </div>
              );
            }
            const { conversation, record, artifact } = tile.work;
            const src = artworkSrc(artifact, conversation.id, true);
            return (
              <div className={`im-tile work${isPicked ? " picked" : ""}`} key={tile.work.key}>
                <button type="button" className="im-tile-body" aria-label={record.prompt} onClick={() => selecting ? toggle(key) : onPreview(conversation, artifact)}>
                  {src ? <img loading="lazy" src={src} alt={record.prompt} /> : <span className="im-art-missing">图片不可用</span>}
                  <span className="im-tile-cap"><span>{record.prompt}</span><small>{conversation.title}</small></span>
                </button>
                {selecting && <span className={`im-check${isPicked ? " on" : ""}`} aria-hidden="true">{isPicked && <UiIcon name="check" size={13} />}</span>}
                {!selecting && <button type="button" className="im-tile-x" aria-label="在会话中查看" title="在会话中查看" onClick={() => onOpenSession(conversation.id)}><UiIcon name="chat" size={14} /></button>}
                {!selecting && <button type="button" className="im-tile-del" aria-label="删除这张图片" title="删除这张图片" onClick={() => onRemove({ records: [{ conversation, record, artifactId: artifact.id }] })}><UiIcon name="trash" size={14} /></button>}
              </div>
            );
          })}
        </div>
      )}
      {selecting && (
        <div className="im-selection-bar" role="toolbar" aria-label="批量操作">
          <span>已选 {picked.size} 条</span>
          <Button size="sm" variant="danger" icon="trash" disabled={!picked.size} onClick={removeSelected}>删除…</Button>
        </div>
      )}
    </div>
  );
}
