import { createContext } from "react";

/** Opens a sub-agent's session in the right pane. Provided by App; absent in read-only child views. */
export const SubagentOpenContext = createContext<((nodeId: string) => void) | undefined>(undefined);

/** Dashboard node id of a sub-agent that lives under `parentSessionId` (see AgentDashboardService). */
export function subagentNodeId(parentSessionId: string, identity: string): string {
  return `session:${parentSessionId}:subagent:${identity}`;
}
