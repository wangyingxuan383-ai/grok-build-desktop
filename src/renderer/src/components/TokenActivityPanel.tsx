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
  const [provider, setProvider] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [view, setView] = useState<View>("daily");
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState<TokenDayBucket>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.grokDesktop.getTokenActivity({ ...(model ? { modelId: model } : {}), ...(provider ? { providerId: provider } : {}), ...(workspace ? { workspace } : {}) })
      .then((value) => { if (!cancelled) setReport(value); })
      .catch((error: unknown) => { if (!cancelled) onError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [model, provider, workspace]);

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
    <p className="settings-note">本页是本机逐回合历史（{report?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}）。卡片只汇总保留的回合明细，热图另含匿名删除会话汇总。总量只累加 CLI/Provider 明确返回的 total；当前进程会话累计和账号订阅额度分别显示在会话信息与账号额度中。</p>
    {report?.sources.length ? <small className="settings-note">当前明细来源：{report.sources.map(sourceName).join("、")}</small> : null}
    {report?.anonymousExcludedByFilter && <p className="settings-note">当前筛选不包含已删除会话的匿名汇总；清除筛选后，热图会显示匿名历史和保留旧 UTC 口径的汇总。</p>}
    <div className="token-activity-controls">
      <label>模型
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">全部模型</option>
          {report?.models.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>提供商<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">全部提供商</option>{report?.providers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>工作区<select value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="">全部工作区</option>{report?.workspaces.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
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
      <header><strong>Token 活动</strong><span>{hovered ? `${hovered.day} · ${formatTokens(hovered.totalTokens)} Token · ${sourceLabel(hovered.source)}` : "过去 53 周"}</span></header>
      <div className="token-heatmap-grid" onMouseLeave={() => setHovered(undefined)}>
        {cells.map((cell) => <i
          key={cell.key}
          className={`token-cell level-${level(cell.totalTokens, peak)}`}
          title={`${cell.label} · ${formatTokens(cell.totalTokens)} Token · ${cell.turns} 回合 · ${sourceLabel(cell.source)}`}
          onMouseEnter={() => setHovered({ day: cell.label, turns: cell.turns, turnsWithUsage: cell.turnsWithUsage, turnsWithTotal: cell.turnsWithTotal, totalTokens: cell.totalTokens, source: cell.source })}
        />)}
      </div>
      <footer>
        <span>仅保留本机汇总，不含提示词。删除会话后的匿名数据不能按模型/提供商/工作区筛选；旧版日桶仍按 UTC 标记。</span>
        <span className="token-legend">少 <i className="token-cell level-0"/><i className="token-cell level-1"/><i className="token-cell level-2"/><i className="token-cell level-3"/><i className="token-cell level-4"/> 多</span>
      </footer>
    </section>
  </div>;
}

interface Cell { key: string; label: string; turns: number; turnsWithUsage: number; turnsWithTotal: number; totalTokens: number; source: TokenDayBucket["source"] }

function buildCells(days: TokenDayBucket[], view: View): Cell[] {
  if (view === "daily") return days.map((day) => ({ key: day.day, label: day.day, turns: day.turns, turnsWithUsage: day.turnsWithUsage, turnsWithTotal: day.turnsWithTotal, totalTokens: day.totalTokens, source: day.source }));
  if (view === "weekly") {
    const weeks: Cell[] = [];
    for (let index = 0; index < days.length; index += 7) {
      const slice = days.slice(index, index + 7);
      const first = slice[0]; if (!first) continue;
      weeks.push({
        key: first.day, label: `${first.day} 起一周`,
        turns: slice.reduce((total, day) => total + day.turns, 0),
        turnsWithUsage: slice.reduce((total, day) => total + day.turnsWithUsage, 0),
        turnsWithTotal: slice.reduce((total, day) => total + day.turnsWithTotal, 0),
        totalTokens: slice.reduce((total, day) => total + day.totalTokens, 0),
        source: combineSource(slice.map((day) => day.source)),
      });
    }
    return weeks;
  }
  let running = 0;
  return days.map((day) => {
    running += day.totalTokens;
    return { key: day.day, label: `截至 ${day.day}`, turns: day.turns, turnsWithUsage: day.turnsWithUsage, turnsWithTotal: day.turnsWithTotal, totalTokens: running, source: combineSource(days.slice(0, days.indexOf(day) + 1).map((item) => item.source)) };
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
  const missing = value.turns - value.turnsWithTotal;
  if (!missing) return `${value.turns} 个回合均有明确总量`;
  if (!value.turnsWithTotal && value.turnsWithUsage) return `${value.turns} 个回合有用量字段，但没有可汇总的明确总量`;
  return `${value.turns} 个回合，${value.turnsWithTotal} 个返回总量，${missing} 个总量缺失`;
}

function sourceLabel(source: TokenDayBucket["source"]): string {
  return ({ "turn-details": "逐回合明细", "anonymous-local": "删除会话匿名汇总", "legacy-utc": "旧 UTC 汇总", mixed: "明细与历史汇总", none: "无数据" })[source];
}

function sourceName(value: string): string {
  return ({ "acp-turn": "CLI 回合上报", "prompt-result": "CLI Prompt 返回", history: "CLI 历史记录", "legacy-utc-aggregate": "旧版 UTC 汇总", unknown: "来源未知" } as Record<string, string>)[value] ?? value;
}

function combineSource(values: TokenDayBucket["source"][]): TokenDayBucket["source"] {
  const nonEmpty = new Set(values.filter((value) => value !== "none"));
  if (!nonEmpty.size) return "none";
  if (nonEmpty.size === 1) return [...nonEmpty][0]!;
  return "mixed";
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
