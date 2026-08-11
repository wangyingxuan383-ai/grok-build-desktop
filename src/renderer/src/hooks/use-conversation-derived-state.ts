import { useMemo } from "react";
import { buildChatTurns, type SessionView, type UiChatTurn } from "../store";

export interface ConversationDerivedState {
  turns: UiChatTurn[];
  planWaiting: boolean;
  lastTurnPaths: string[];
  utilityTurn?: UiChatTurn;
}

/** Derives only the active session surface; background session streams are not inputs. */
export function useConversationDerivedState(view: SessionView | undefined, executionRoot: string): ConversationDerivedState {
  const planWaiting = Boolean(view?.messages.some((message) => message.kind === "plan" && message.interactive && !message.resolved));
  const turns = useMemo(() => buildChatTurns(view?.messages ?? [], view?.status, view?.turnPresentations), [view?.messages, view?.status, view?.turnPresentations]);
  const lastTurnPaths = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index--) {
      const paths = Array.from(new Set(turns[index]!.groups
        .filter((group) => group.kind === "files")
        .flatMap((group) => group.items.flatMap((message) => message.kind === "tool"
          ? (message.tool.locations ?? []).map((location) => location.path).filter((path): path is string => typeof path === "string" && path.length > 0 && isPathInExecutionRoot(path, executionRoot))
          : []))));
      if (paths.length) return paths;
    }
    return [];
  }, [executionRoot, turns]);
  const utilityTurn = useMemo(() => [...turns].reverse().find((turn) => turn.final || turn.pending.some((item) => item.kind === "plan") || turn.groups.some((group) => group.items.some((item) => item.kind === "plan"))) ?? turns.at(-1), [turns]);
  return { turns, planWaiting, lastTurnPaths, utilityTurn };
}

export function isPathInExecutionRoot(path: string, root: string): boolean {
  if (!root) return false;
  const normalize = (value: string): string => value.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
  const target = normalize(path);
  const base = normalize(root);
  if (!/^[a-z]:\\|^\\\\/.test(target)) return true;
  return target === base || target.startsWith(`${base}\\`);
}
