import { useEffect, useMemo, useState } from "react";
import type { TokenActivityReport, TokenActivityWindow, TokenDayBucket } from "../../../shared/types";

type View = "daily" | "weekly" | "total";

/**
 * Token usage over time, built only from what the CLI or provider reported.
 * Failed and cancelled turns carry no usage at all, so coverage is stated
 * rather than hidden — a period can contain real work that no total accounts
 * for, and a chart that quietly omits it would be a lie of omission.
 */
export function TokenActivityPanel({ onError }: { onError(message: string): void }): React.JSX.Element {
  const [report, setReport] = useState<TokenActivityReport>();
  const [model, setModel] = useState("");
  const [view, setView] = useState<View>("daily");
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState<TokenDayBucket>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.grokDesktop.getTokenActivity(model ? { modelId: model } : undefined)
      .then((value) => { if (!cancelled) setReport(value); })
      .catch((error: unknown) => { if (!cancelled) onError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [model]);

  const cells = useMemo(() => buildCells(report?.days ?? [], view), [report, view]);
  const peak = useMemo(() => Math.max(1, ...cells.map((cell) => cell.totalTokens)), [cells]);
  const windows: Array<[string, TokenActivityWindow | undefined]> = [
    ["最近 24 小时", report?.windows.rolling24h],
    ["今天", report?.windows.today],
    ["最近 7 天", report?.windows.rolling7d],
    ["最近 30 天", report?.windows.rolling30d],
    ["本月", report?.windows.month],
  ];

  return <div className="token-activity">
    <div className="token-activity-controls">
      <label>模型
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">全部模型</option>
          {report?.models.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <div className="token-activity-views">
        {(["daily", "weekly", "total"] as View[]).map((value) => (
          <button key={value} className={view === value ? "active" : ""} onClick={() => setView(value)}>
            {value === "daily" ? "每日" : value === "weekly" ? "每周" : "累计"}
          </button>
        ))}
      </div>
    </div>

    <div className="token-window-grid">{windows.map(([label, value]) => <article key={label}>
      <strong>{label}</strong>
      <b>{value ? formatTokens(value.totalTokens) : "—"}</b>
      <span>{value ? coverageLabel(value) : loading ? "读取中…" : "暂无数据"}</span>
      {value && value.turnsWithUsage > 0 && <small>输入 {formatTokens(value.inputTokens)} · 输出 {formatTokens(value.outputTokens)}</small>}
    </article>)}</div>

    <section className="token-heatmap">
      <header><strong>Token 活动</strong><span>{hovered ? `${hovered.day} 使用了 ${formatTokens(hovered.totalTokens)} 个 Token` : "过去 53 周"}</span></header>
      <div className="token-heatmap-grid" onMouseLeave={() => setHovered(undefined)}>
        {cells.map((cell) => <i
          key={cell.key}
          className={`token-cell level-${level(cell.totalTokens, peak)}`}
          title={`${cell.label} · ${formatTokens(cell.totalTokens)} Token · ${cell.turns} 回合`}
          onMouseEnter={() => setHovered({ day: cell.label, turns: cell.turns, turnsWithUsage: cell.turnsWithUsage, totalTokens: cell.totalTokens })}
        />)}
      </div>
      <footer>
        <span>数据仅保存在本机，不包含任何提示词内容。</span>
        <span className="token-legend">少 <i className="token-cell level-0"/><i className="token-cell level-1"/><i className="token-cell level-2"/><i className="token-cell level-3"/><i className="token-cell level-4"/> 多</span>
      </footer>
    </section>
  </div>;
}

interface Cell { key: string; label: string; turns: number; turnsWithUsage: number; totalTokens: number }

function buildCells(days: TokenDayBucket[], view: View): Cell[] {
  if (view === "daily") return days.map((day) => ({ key: day.day, label: day.day, turns: day.turns, turnsWithUsage: day.turnsWithUsage, totalTokens: day.totalTokens }));
  if (view === "weekly") {
    const weeks: Cell[] = [];
    for (let index = 0; index < days.length; index += 7) {
      const slice = days.slice(index, index + 7);
      const first = slice[0]; if (!first) continue;
      weeks.push({
        key: first.day, label: `${first.day} 起一周`,
        turns: slice.reduce((total, day) => total + day.turns, 0),
        turnsWithUsage: slice.reduce((total, day) => total + day.turnsWithUsage, 0),
        totalTokens: slice.reduce((total, day) => total + day.totalTokens, 0),
      });
    }
    return weeks;
  }
  let running = 0;
  return days.map((day) => {
    running += day.totalTokens;
    return { key: day.day, label: `截至 ${day.day}`, turns: day.turns, turnsWithUsage: day.turnsWithUsage, totalTokens: running };
  });
}

function level(value: number, peak: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  const ratio = value / peak;
  return ratio > 0.6 ? 4 : ratio > 0.3 ? 3 : ratio > 0.1 ? 2 : 1;
}

/** States coverage instead of implying the total accounts for every turn. */
function coverageLabel(value: TokenActivityWindow): string {
  if (!value.turns) return "该时段没有回合";
  if (value.turnsWithUsage === value.turns) return `${value.turns} 个回合，全部有用量数据`;
  return `${value.turns} 个回合，其中 ${value.turns - value.turnsWithUsage} 个未返回用量`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
