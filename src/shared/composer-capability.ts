import type { ComposerCapabilitySelection } from "./types";

export function buildComposerCommand(text: string, capability?: ComposerCapabilitySelection): string {
  const prompt = text.trim();
  if (!capability) return prompt;
  if (capability.kind === "mcp") return `本次请求使用 MCP 服务 ${JSON.stringify(capability.selection.serverName)} 的工具 ${JSON.stringify(capability.selection.toolName)}。这是工具使用请求，仍须遵守当前权限；没有实际调用时请明确说明。\n\n${prompt}`;
  const command = normalizeSkillCommand(capability.command);
  return `${command}${prompt ? ` ${prompt}` : ""}`;
}

export function normalizeSkillCommand(command: string): string {
  const value = command.trim();
  return value.startsWith("/") ? value : `/${value}`;
}

/** Selection edits a visible draft only; execution still goes through the existing CLI route. */
export function selectComposerCommand(text: string, name: string, knownCommands: readonly string[] = []): string {
  const command = normalizeSkillCommand(name);
  const token = text.match(/^\s*(\/[^\s]+)/)?.[1];
  const replace = token && (knownCommands.some(value => normalizeSkillCommand(value) === token)
    || (text.trim() === token && command.startsWith(token)));
  const body = replace ? text.replace(/^\s*\/[^\s]+(?:[ \t]+)?/, "") : text;
  return `${command} ${body}`;
}
