import type { ComposerCapabilitySelection } from "./types";

export function buildComposerCommand(text: string, capability?: ComposerCapabilitySelection): string {
  const prompt = text.trim();
  if (!capability) return prompt;
  const command = normalizeSkillCommand(capability.command);
  return `${command}${prompt ? ` ${prompt}` : ""}`;
}

export function normalizeSkillCommand(command: string): string {
  const value = command.trim();
  return value.startsWith("/") ? value : `/${value}`;
}
