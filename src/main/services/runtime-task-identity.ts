import { createHash } from "node:crypto";

/**
 * Prefer the runtime's durable task/subagent id. Older or partially replayed
 * events sometimes omit it; in that case derive a deterministic display
 * identity instead of allocating a new UUID on every refresh.
 */
export function stableRuntimeTaskIdentifier(row: Record<string, unknown>, ordinal = 0): string {
  const direct = [row.id, row.taskId, row.task_id, row.subagentId, row.subagent_id]
    .find((value) => typeof value === "string" && value.trim());
  if (typeof direct === "string") return direct.trim();
  const evidence = [
    row.kind,
    row.task_type,
    row.title,
    row.name,
    row.description,
    row.command,
    row.display_command,
    row.subagentType,
    row.subagent_type,
    row.createdAt,
    row.created_at,
    ordinal,
  ];
  return `unidentified-${createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0, 16)}`;
}
