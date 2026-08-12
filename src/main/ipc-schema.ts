import { extname, posix, win32 } from "node:path";
import type { AppSettings, ComputerUseSettings } from "../shared/types";

const MAX_IPC_DEPTH = 16;
const MAX_IPC_NODES = 50_000;
const MAX_IPC_ARRAY = 10_000;
const MAX_IPC_KEYS = 2_000;
const MAX_IPC_STRING_BYTES = 32 * 1024 * 1024;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const BLOCKED_OPEN_EXTENSIONS = new Set([".appx", ".bat", ".chm", ".cmd", ".com", ".cpl", ".exe", ".hta", ".inf", ".ins", ".isp", ".js", ".jse", ".lnk", ".msc", ".msi", ".msix", ".msp", ".ps1", ".reg", ".scr", ".sct", ".url", ".vbe", ".vbs", ".ws", ".wsc", ".wsf", ".wsh"]);
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([".appx", ".com", ".cpl", ".dll", ".drv", ".exe", ".msi", ".msix", ".msp", ".ocx", ".scr", ".sys"]);
const isAbsoluteWindowsPath = (value: string): boolean => win32.isAbsolute(value) || posix.isAbsolute(value);

type Rule = (args: unknown[]) => void;

const RULES: Record<string, Rule> = {
  "app:bootstrap": noArgs,
  "app:build-info": noArgs,
  "onboarding:get": noArgs,
  "onboarding:update": (args) => objectArg(args, 0),
  "onboarding:reset": noArgs,
  "diagnostics:run": noArgs,
  "diagnostics:doctor-fix-preview": noArgs,
  "diagnostics:doctor-fix": (args) => { idArg(args, 0); stringArg(args, 1, 256); booleanArg(args, 2); },
  "diagnostics:failure": (args) => objectArg(args, 0),
  "diagnostics:cli-capabilities": (args) => optionalBooleanArg(args, 0),
  "diagnostics:support-preview": noArgs,
  "diagnostics:support-export": noArgs,
  "app-update:check": (args) => optionalBooleanArg(args, 0),
  "app-update:open": (args) => optionalHttpUrlArg(args, 0),
  "workspace:choose": noArgs,
  "workspace:create-temporary": noArgs,
  "workspace:set": (args) => absoluteFilesystemPathArg(args, 0, "工作区"),
  "workspace:open-offline": (args) => pathArg(args, 0),
  "workspace:discover": (args) => optionalBooleanArg(args, 0),
  "workspace:pin": (args) => { pathArg(args, 0); booleanArg(args, 1); },
  "workspace:hidden:list": noArgs,
  "workspace:hidden:set": (args) => { pathArg(args, 0); booleanArg(args, 1); },
  "workspace:rebind-sessions": (args) => { pathArg(args, 0); absoluteFilesystemPathArg(args, 1, "新工作区"); },
  "workspace:search-files": (args) => { pathArg(args, 0); stringArg(args, 1, 16_384); optionalIntegerArg(args, 2, 1, 10_000); },
  "workspace:tree:list": (args) => { pathArg(args, 0); optionalRelativePathArg(args, 1); optionalObjectArg(args, 2); },
  "editor:open": (args) => { pathArg(args, 0); pathArg(args, 1); },
  "editor:save": (args) => editorSaveArg(args, 0),
  "editor:create-file": (args) => { pathArg(args, 0); pathArg(args, 1); if (args[2] !== undefined) stringArg(args, 2, 32 * 1024 * 1024); },
  "editor:create-directory": (args) => { pathArg(args, 0); pathArg(args, 1); },
  "editor:rename": (args) => { pathArg(args, 0); pathArg(args, 1); pathArg(args, 2); },
  "editor:reveal": (args) => { pathArg(args, 0); pathArg(args, 1); },
  "system:open-path": (args) => safeOpenPathArg(args, 0),
  "system:open-target": (args) => openTargetArg(args, 0),
  "system:list-open-tools": noArgs,
  "system:copy-image": (args) => mediaSourceArg(args, 0, true),
  "system:save-image": (args) => mediaSourceArg(args, 0, true),
  "system:open-media": (args) => mediaSourceArg(args, 0, false),
  "system:open-external": (args) => {
    const value = stringArg(args, 0, 4_096);
    const url = new URL(value);
    if (!(url.protocol === "https:" || url.protocol === "http:")) throw new Error("IPC URL 仅允许 HTTP/HTTPS");
  },
  "editor:delete": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "git:trust:set": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "git:trust:get": (args) => pathArg(args, 0),
  "git:capability": (args) => pathArg(args, 0),
  "git:status": (args) => pathArg(args, 0),
  "git:diff": (args) => { pathArg(args, 0); booleanArg(args, 1); optionalPathArg(args, 2); },
  "git:review": (args) => { pathArg(args, 0); gitReviewScopeArg(args, 1); },
  "agent-changes:get": (args) => { idArg(args, 0); enumArg(args, 1, ["last-turn", "session"]); },
  "token-activity:get": (args) => optionalObjectArg(args, 0),
  "git:review:index": (args) => { pathArg(args, 0); gitReviewScopeArg(args, 1); },
  "git:review:file": (args) => { pathArg(args, 0); gitReviewScopeArg(args, 1); idArg(args, 2); idArg(args, 3); },
  "git:review:hunk": (args) => { pathArg(args, 0); gitHunkActionArg(args, 1); },
  "git:stage": (args) => { pathArg(args, 0); optionalStringArrayArg(args, 1, 10_000, 32_767); },
  "git:unstage": (args) => { pathArg(args, 0); optionalStringArrayArg(args, 1, 10_000, 32_767); },
  "git:commit": (args) => { pathArg(args, 0); stringArg(args, 1, 256 * 1024); },
  "git:branch:create": (args) => { pathArg(args, 0); stringArg(args, 1, 512); if (args[2] !== undefined) stringArg(args, 2, 512); },
  "git:branch:switch": (args) => { pathArg(args, 0); stringArg(args, 1, 512); },
  "git:discard": (args) => { pathArg(args, 0); gitDiscardArg(args, 1); },
  "git:branches": (args) => pathArg(args, 0),
  "git:history": (args) => { pathArg(args, 0); optionalIntegerArg(args, 1, 1, 10_000); },
  "git:commit:details": (args) => { pathArg(args, 0); stringArg(args, 1, 512); },
  "git:pull": (args) => { pathArg(args, 0); idArg(args, 1); },
  "git:push": (args) => { pathArg(args, 0); idArg(args, 1); },
  "git:cancel": (args) => idArg(args, 0),
  "worktree:list": (args) => pathArg(args, 0),
  "worktree:create": (args) => worktreeCreateArg(args, 0),
  "worktree:apply:preview": (args) => { pathArg(args, 0); idArg(args, 1); },
  "worktree:apply": (args) => { pathArg(args, 0); idArg(args, 1); tokenArg(args, 2); booleanArg(args, 3); optionalBooleanArg(args, 4); },
  "worktree:remove": (args) => { pathArg(args, 0); idArg(args, 1); booleanArg(args, 2); },
  "worktree:gc": (args) => { pathArg(args, 0); tokenArg(args, 1); booleanArg(args, 2); },
  "worktree:gc:preview": (args) => pathArg(args, 0),
  "memory:layout": (args) => pathArg(args, 0),
  "memory:settings:get": (args) => pathArg(args, 0),
  "memory:settings:update": (args) => { pathArg(args, 0); objectArg(args, 1); optionalIdArg(args, 2); },
  "memory:list": (args) => { pathArg(args, 0); optionalStringArg(args, 1, 16_384); },
  "memory:save": (args) => memorySaveArg(args, 0),
  "memory:remember:preview": (args) => { pathArg(args, 0); enumArg(args, 1, ["global", "workspace"]); stringArg(args, 2, 2 * 1024 * 1024); },
  "memory:remember": (args) => { objectArg(args, 0); tokenArg(args, 1); booleanArg(args, 2); optionalIdArg(args, 3); },
  "memory:structured:list": (args) => { pathArg(args, 0); optionalEnumArg(args, 1, ["global", "workspace"]); },
  "memory:structured:delete:preview": (args) => { pathArg(args, 0); idArg(args, 1); },
  "memory:structured:delete": (args) => { objectArg(args, 0); tokenArg(args, 1); booleanArg(args, 2); },
  "memory:clear": (args) => { pathArg(args, 0); enumArg(args, 1, ["workspace", "global", "all"]); booleanArg(args, 2); },
  "memory:session:delete": (args) => { pathArg(args, 0); idArg(args, 1); booleanArg(args, 2); },
  "memory:command": (args) => { idArg(args, 0); enumArg(args, 1, ["flush", "dream"]); },
  "agents:list": (args) => pathArg(args, 0),
  "agents:validate": (args) => { stringArg(args, 0, 2 * 1024 * 1024); optionalStringArg(args, 1, 512); },
  "agents:save": (args) => objectArg(args, 0),
  "agents:copy": (args) => { pathArg(args, 0); pathArg(args, 1); enumArg(args, 2, ["user", "project"]); stringArg(args, 3, 512); },
  "agents:rename": (args) => { pathArg(args, 0); pathArg(args, 1); stringArg(args, 2, 512); },
  "agents:toggle": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "agents:delete": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "personas:delete": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "personas:list": (args) => pathArg(args, 0),
  "personas:validate": (args) => stringArg(args, 0, 2 * 1024 * 1024),
  "personas:save": (args) => objectArg(args, 0),
  "personas:copy": (args) => { pathArg(args, 0); pathArg(args, 1); enumArg(args, 2, ["user", "project"]); stringArg(args, 3, 512); },
  "personas:rename": (args) => { pathArg(args, 0); pathArg(args, 1); stringArg(args, 2, 512); },
  "personas:toggle": (args) => { pathArg(args, 0); pathArg(args, 1); booleanArg(args, 2); },
  "profiles:list": (args) => pathArg(args, 0),
  "profiles:validate": (args) => objectArg(args, 0),
  "profiles:save": (args) => objectArg(args, 0),
  "profiles:delete": (args) => { pathArg(args, 0); idArg(args, 1); booleanArg(args, 2); },
  "profiles:assignment": (args) => idArg(args, 0),
  "dashboard:get": (args) => objectArg(args, 0),
  "dashboard:stop": (args) => idArg(args, 0),
  "dashboard:clear": (args) => optionalIdArg(args, 0),
  "attachment:inspect-privacy": (args) => { pathArg(args, 0); attachmentArrayArg(args, 1); },
  "providers:list": noArgs,
  "providers:remove": (args) => idArg(args, 0),
  "providers:upsert": (args) => objectArg(args, 0),
  "providers:probe-draft": (args) => objectArg(args, 0),
  "providers:discover-models": (args) => objectArg(args, 0),
  "providers:scan:start": (args) => providerScanScopeArg(args, 0),
  "providers:scan:get": (args) => idArg(args, 0),
  "providers:scan:list": (args) => optionalIdArg(args, 0),
  "providers:scan:cancel": (args) => idArg(args, 0),
  "providers:test": (args) => idArg(args, 0),
  "providers:pull-models": (args) => idArg(args, 0),
  "providers:capabilities": (args) => idArg(args, 0),
  "providers:deep-scan": (args) => { idArg(args, 0); optionalObjectArg(args, 1); },
  "providers:cancel-scan": (args) => idArg(args, 0),
  "providers:capabilities:application": (args) => idArg(args, 0),
  "providers:apply-capabilities": (args) => { idArg(args, 0); optionalObjectArg(args, 1); },
  "providers:set-desktop-default": (args) => idArg(args, 0),
  "providers:set-cli-default": (args) => idArg(args, 0),
  "providers:reload": noArgs,
  "automations:list": noArgs,
  "automations:delete": (args) => idArg(args, 0),
  "automations:create": (args) => automationTaskInputArg(args, 0),
  "automations:update": (args) => { idArg(args, 0); automationTaskPatchArg(args, 1); },
  "automations:pause": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "automations:run-now": (args) => idArg(args, 0),
  "automations:run:cancel": (args) => idArg(args, 0),
  "automations:runs": (args) => optionalIdArg(args, 0),
  "automations:policy:get": noArgs,
  "automations:policy:update": (args) => automationPolicyArg(args, 0),
  "automations:policy:apply-all": noArgs,
  "automations:pending:respond": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "automations:repair": noArgs,
  "automations:health:check": noArgs,
  "automations:health:repair": noArgs,
  "automations:clear-context": (args) => idArg(args, 0),
  // The renderer may ask for the initial catalog before settings hydration and
  // pass an empty workspace sentinel. The controller deliberately resolves
  // that sentinel from active settings; do not reject it as a forged path.
  "session:list": (args) => {
    if (args[0] !== undefined && args[0] !== null && args[0] !== "") pathArg(args, 0);
    if (args[1] !== undefined && args[1] !== null) stringArgAllowEmpty(args, 1, 16_384);
  },
  "session:official-list": (args) => {
    if (args[0] !== undefined && args[0] !== null && args[0] !== "") pathArg(args, 0);
    if (args[1] !== undefined && args[1] !== null) stringArg(args, 1, 4_096);
  },
  "session:create": (args) => sessionLaunchArg(args, 0),
  "session:preview": (args) => { pathArg(args, 0); idArg(args, 1); },
  "session:open": (args) => { pathArg(args, 0); idArg(args, 1); },
  "session:info": (args) => idArg(args, 0),
  "session:usage": (args) => idArg(args, 0),
  "session:runtime": (args) => idArg(args, 0),
  "session:compaction-policy": (args) => { idArg(args, 0); sessionCompactionPolicyArg(args, 1); },
  "session:compact": (args) => idArg(args, 0),
  "feedback:capability": (args) => idArg(args, 0),
  "feedback:preview": (args) => stringArg(args, 0, 64 * 1024),
  "feedback:submit": (args) => { idArg(args, 0); stringArg(args, 1, 64 * 1024); },
  "session:btw": (args) => { idArg(args, 0); stringArg(args, 1, 64 * 1024); },
  "session:rename": (args) => { idArg(args, 0); stringArg(args, 1, 4_096); },
  "session:delete": (args) => { pathArg(args, 0); idArg(args, 1); },
  "session:delete-desktop-data": (args) => { pathArg(args, 0); idArg(args, 1); },
  "session:clear": (args) => { pathArg(args, 0); optionalIdArg(args, 1); },
  "session:pin": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "session:export-markdown": (args) => { pathArg(args, 0); idArg(args, 1); },
  "session:media-capabilities": (args) => idArg(args, 0),
  "session:mode": (args) => { idArg(args, 0); enumArg(args, 1, ["agent", "plan", "auto"]); },
  "session:effort": (args) => { idArg(args, 0); enumArg(args, 1, ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]); },
  "session:model": (args) => { idArg(args, 0); idArg(args, 1); },
  "session:send": (args) => promptArgs(args),
  "session:enqueue": (args) => promptArgs(args),
  "session:interject": (args) => promptArgs(args),
  "session:cancel": (args) => idArg(args, 0),
  "ui-fixture:get": noArgs,
  "session:queue:edit": (args) => { idArg(args, 0); idArg(args, 1); stringArg(args, 2, 2 * 1024 * 1024); },
  "session:queue:remove": (args) => { idArg(args, 0); idArg(args, 1); },
  "session:queue:reorder": (args) => { idArg(args, 0); idArg(args, 1); integerArg(args, 2, 0, 10_000); },
  "session:queue:clear": (args) => idArg(args, 0),
  "session:queue:interject": (args) => { idArg(args, 0); idArg(args, 1); if (args[2] !== undefined) stringArg(args, 2, 2 * 1024 * 1024); },
  "session:fork": (args) => { idArg(args, 0); optionalIdArg(args, 1); optionalObjectArg(args, 2); },
  "session:rewind-points": (args) => idArg(args, 0),
  "session:rewind": (args) => { idArg(args, 0); idArg(args, 1); enumArg(args, 2, ["conversation", "conversation-and-files", "files"]); },
  "session:archive": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "tasks:list": noArgs,
  "tasks:kill": (args) => idArg(args, 0),
  "inbox:list": noArgs,
  "inbox:mark-read": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "inbox:clear": noArgs,
  "media:start": (args) => mediaCreationArg(args, 0),
  "media:get": (args) => idArg(args, 0),
  "media:cancel": (args) => idArg(args, 0),
  "plan:respond": (args) => { idArg(args, 0); requestIdArg(args, 1, true); enumArg(args, 2, ["approved", "rejected", "cancelled"]); if (args[3] !== undefined) stringArgAllowEmpty(args, 3, 64 * 1024); },
  "permission:respond": (args) => { idArg(args, 0); requestIdArg(args, 1); idArg(args, 2); },
  "question:respond": (args) => { idArg(args, 0); requestIdArg(args, 1); objectArg(args, 2); },
  "attachments:pick": noArgs,
  "attachments:pick-folders": noArgs,
  "attachments:dropped": (args) => attachmentPathArrayArg(args, 0, 128),
  "attachments:paths": (args) => { attachmentPathArrayArg(args, 0, 128); optionalIdArg(args, 1); },
  "auth:login-api-key": (args) => { stringArg(args, 0, 512); stringArg(args, 1, 64 * 1024); },
  "auth:switch": (args) => idArg(args, 0),
  "auth:remove": (args) => idArg(args, 0),
  "settings:get": noArgs,
  "settings:update": (args) => settingsPatchArg(args, 0),
  "updates:auto-check": noArgs,
  "theme:get": noArgs,
  "theme:update": (args) => objectArg(args, 0),
  "theme:pick-background": noArgs,
  "theme:remove-background": noArgs,
  "auth:list": noArgs,
  "auth:login-device": noArgs,
  "auth:logout": noArgs,
  "codex:list": (args) => { pathArg(args, 0); optionalBooleanArg(args, 1); optionalBooleanArg(args, 2); },
  "codex:open": (args) => idArg(args, 0),
  "codex:refresh": (args) => idArg(args, 0),
  "codex:hide": (args) => { idArg(args, 0); optionalBooleanArg(args, 1); },
  "codex:continue": (args) => idArg(args, 0),
  "claude:list": (args) => { pathArg(args, 0); optionalBooleanArg(args, 1); },
  "claude:open": (args) => idArg(args, 0),
  "claude:refresh": (args) => idArg(args, 0),
  "claude:hide": (args) => { idArg(args, 0); optionalBooleanArg(args, 1); },
  "claude:continue": (args) => idArg(args, 0),
  "quota:get": (args) => optionalBooleanArg(args, 0),
  "draft:get": (args) => stringArg(args, 0, 32_767),
  "draft:list": noArgs,
  "draft:set": (args) => { stringArg(args, 0, 32_767); stringArgAllowEmpty(args, 1, 2 * 1024 * 1024); optionalObjectArg(args, 2); optionalAttachmentArrayArg(args, 3); if (args[4] !== undefined) newTaskDraftArg(args, 4); },
  "draft:move": (args) => { stringArg(args, 0, 32_767); stringArg(args, 1, 32_767); },
  "draft:clear": (args) => stringArg(args, 0, 32_767),
  "draft:text:create": (args) => { stringArg(args, 0, 32_767); stringArg(args, 1, 32 * 1024 * 1024); },
  "draft:text:read": (args) => pathArg(args, 0),
  "draft:text:delete": (args) => pathArg(args, 0),
  "prompt-history:list": (args) => pathArg(args, 0),
  "prompt-history:append": (args) => { pathArg(args, 0); stringArg(args, 1, 2 * 1024 * 1024); },
  "extensions:plugins:install": (args) => { stringArg(args, 0, 32_767); booleanArg(args, 1); if (args[2] !== undefined) stringArg(args, 2, 4096); },
  "extensions:marketplace:install": (args) => { stringArg(args, 0, 32_767); stringArg(args, 1, 4096); booleanArg(args, 2); },
  "extensions:plugins:list": (args) => optionalBooleanArg(args, 0),
  "extensions:plugins:details": (args) => idArg(args, 0),
  "extensions:plugins:preview": (args) => stringArg(args, 0, 32_767),
  "extensions:plugins:action": (args) => { idArg(args, 0); enumArg(args, 1, ["enable", "disable", "update", "uninstall", "reload"]); },
  "extensions:marketplace:list": (args) => optionalBooleanArg(args, 0),
  "extensions:skills:list": noArgs,
  "extensions:mcp:list": (args) => optionalBooleanArg(args, 0),
  "extensions:mcp:diagnose": (args) => optionalStringArg(args, 0, 512),
  "extensions:mcp:toggle": (args) => { stringArg(args, 0, 512); booleanArg(args, 1); },
  "extensions:mcp:upsert": (args) => objectArg(args, 0),
  "extensions:mcp:auth": (args) => stringArg(args, 0, 512),
  "extensions:mcp:remove": (args) => stringArg(args, 0, 512),
  "extensions:hooks:list": noArgs,
  "extensions:reload": noArgs,
  "extensions:codex:scan": (args) => optionalBooleanArg(args, 0),
  "extensions:codex:adapt": (args) => idArg(args, 0),
  "extensions:codex:remove-adapter": (args) => idArg(args, 0),
  "computer:capability": noArgs,
  "computer:list-apps": noArgs,
  "computer:list-windows": (args) => optionalIdArg(args, 0),
  "computer:start": (args) => computerStartArg(args, 0),
  "computer:pause": (args) => idArg(args, 0),
  "computer:resume": (args) => idArg(args, 0),
  "computer:stop": (args) => idArg(args, 0),
  "computer:risk": (args) => { idArg(args, 0); booleanArg(args, 1); },
  "computer:permission": (args) => { idArg(args, 0); enumArg(args, 1, ["once", "always", "deny"]); },
  "computer:settings:get": noArgs,
  "computer:settings:update": (args) => computerSettingsArg(args, 0),
  "cli:check-update": noArgs,
  "cli:update-preview": noArgs,
  "cli:apply-update": (args) => cliUpdateInputArg(args, 0),
  "cli:compatibility": noArgs,
  "cli:update-history": noArgs,
  "logs:export": noArgs,
};

/**
 * Runtime boundary shared by every ipcMain.handle registration. TypeScript
 * casts are erased at runtime; this rejects oversized/malformed payloads and
 * then applies stricter rules to destructive, path, credential and process
 * operations before the controller sees the values.
 */
export function validateIpcInvocation(channel: string, args: unknown[], declaredArity: number): void {
  if (!/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)+$/.test(channel)) throw new Error("IPC Channel 名称无效");
  if (args.length > declaredArity) throw new Error(`IPC ${channel} 参数数量无效`);
  const state = { nodes: 0 };
  for (const value of args) validateValue(value, 0, state);
  const rule = RULES[channel];
  if (!rule) throw new Error(`IPC ${channel} 缺少运行时 Schema`);
  rule(args);
}

export function hasIpcRuntimeSchema(channel: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULES, channel);
}

function validateValue(value: unknown, depth: number, state: { nodes: number }): void {
  state.nodes += 1;
  if (state.nodes > MAX_IPC_NODES) throw new Error("IPC 参数节点过多");
  if (depth > MAX_IPC_DEPTH) throw new Error("IPC 参数嵌套过深");
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_IPC_STRING_BYTES) throw new Error("IPC 字符串超过限制");
    if (value.includes("\0")) throw new Error("IPC 字符串包含 NUL");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("IPC 数字必须有限");
    return;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") throw new Error("IPC 参数类型无效");
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength > MAX_IPC_STRING_BYTES) throw new Error("IPC 二进制参数超过限制");
    return;
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > MAX_IPC_STRING_BYTES) throw new Error("IPC 二进制参数超过限制");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_IPC_ARRAY) throw new Error("IPC 数组超过限制");
    for (const item of value) validateValue(item, depth + 1, state);
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_IPC_KEYS) throw new Error("IPC 对象字段过多");
    for (const [key, item] of entries) {
      if (BLOCKED_KEYS.has(key)) throw new Error("IPC 对象包含危险字段");
      if (Buffer.byteLength(key, "utf8") > 256) throw new Error("IPC 字段名过长");
      validateValue(item, depth + 1, state);
    }
    return;
  }
  throw new Error("IPC 参数无法验证");
}

function stringArg(args: unknown[], index: number, maxBytes: number): string {
  const value = args[index];
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > maxBytes || value.includes("\0")) throw new Error(`IPC 参数 ${index + 1} 必须是有效字符串`);
  return value;
}
function stringArgAllowEmpty(args: unknown[], index: number, maxBytes: number): string {
  const value = args[index];
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes || value.includes("\0")) throw new Error(`IPC 参数 ${index + 1} 必须是有效字符串`);
  return value;
}
function noArgs(args: unknown[]): void { if (args.length) throw new Error("IPC 操作不接受参数"); }
function pathArg(args: unknown[], index: number): string { return stringArg(args, index, 32_767); }
function absoluteFilesystemPathArg(args: unknown[], index: number, purpose: string): string {
  const value = pathArg(args, index);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) throw new Error(`IPC ${purpose}路径不能是 URL`);
  if (/^\\\\[?.]\\/.test(value)) throw new Error(`IPC ${purpose}路径不能使用设备命名空间`);
  const windowsAbsolute = win32.isAbsolute(value);
  if (!(windowsAbsolute || posix.isAbsolute(value))) throw new Error(`IPC ${purpose}路径必须是绝对路径`);
  if (windowsAbsolute) {
    const withoutDrive = /^[A-Za-z]:/.test(value) ? value.slice(2) : value;
    if (withoutDrive.includes(":")) throw new Error(`IPC ${purpose}路径不能包含备用数据流`);
  }
  return value;
}
function pathExtension(value: string): string {
  return (win32.isAbsolute(value) ? win32.extname(value) : extname(value)).toLowerCase();
}
function safeOpenPathArg(args: unknown[], index: number): void {
  const value = absoluteFilesystemPathArg(args, index, "系统打开");
  const extension = pathExtension(value);
  if (BLOCKED_OPEN_EXTENSIONS.has(extension)) throw new Error(`IPC 系统打开不允许可执行扩展名 ${extension}`);
}
function idArg(args: unknown[], index: number): string { return stringArg(args, index, 512); }
function tokenArg(args: unknown[], index: number): string { return stringArg(args, index, 4_096); }
function objectArg(args: unknown[], index: number): void { if (!args[index] || typeof args[index] !== "object" || Array.isArray(args[index])) throw new Error(`IPC 参数 ${index + 1} 必须是对象`); }
function booleanArg(args: unknown[], index: number): void { if (typeof args[index] !== "boolean") throw new Error(`IPC 参数 ${index + 1} 必须是布尔值`); }
function enumArg(args: unknown[], index: number, allowed: readonly string[]): void { if (typeof args[index] !== "string" || !allowed.includes(args[index])) throw new Error(`IPC 参数 ${index + 1} 不在允许范围`); }
function optionalPathArg(args: unknown[], index: number): void { if (args[index] !== undefined) pathArg(args, index); }
function optionalRelativePathArg(args: unknown[], index: number): void {
  if (args[index] === undefined) return;
  stringArgAllowEmpty(args, index, 32_767);
}
function optionalIdArg(args: unknown[], index: number): void { if (args[index] !== undefined) idArg(args, index); }
function optionalStringArg(args: unknown[], index: number, maxBytes: number): void { if (args[index] !== undefined) stringArg(args, index, maxBytes); }
function optionalBooleanArg(args: unknown[], index: number): void { if (args[index] !== undefined) booleanArg(args, index); }
function optionalEnumArg(args: unknown[], index: number, allowed: readonly string[]): void { if (args[index] !== undefined) enumArg(args, index, allowed); }
function optionalObjectArg(args: unknown[], index: number): void { if (args[index] !== undefined) objectArg(args, index); }
function integerArg(args: unknown[], index: number, min: number, max: number): void { const value = args[index]; if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`IPC 参数 ${index + 1} 必须是 ${min}-${max} 的整数`); }
function optionalIntegerArg(args: unknown[], index: number, min: number, max: number): void { if (args[index] !== undefined) integerArg(args, index, min, max); }
function optionalStringArrayArg(args: unknown[], index: number, maxLength: number, maxBytes: number): void {
  const value = args[index];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`IPC 参数 ${index + 1} 必须是受限字符串数组`);
  for (let item = 0; item < value.length; item += 1) if (typeof value[item] !== "string" || !value[item] || Buffer.byteLength(value[item], "utf8") > maxBytes || value[item].includes("\0")) throw new Error(`IPC 参数 ${index + 1} 包含无效字符串`);
}
function pathArrayArg(args: unknown[], index: number, maxLength: number): void {
  const value = args[index];
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`IPC 参数 ${index + 1} 必须是受限路径数组`);
  for (const path of value) {
    if (typeof path !== "string" || !path || path.includes("\0") || Buffer.byteLength(path, "utf8") > 32_767) throw new Error(`IPC 参数 ${index + 1} 包含无效路径`);
  }
}
function attachmentPathArrayArg(args: unknown[], index: number, maxLength: number): void {
  const value = args[index];
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`IPC 参数 ${index + 1} 必须是受限路径数组`);
  for (let item = 0; item < value.length; item += 1) {
    const path = absoluteFilesystemPathArg([value[item]], 0, "附件读取");
    const extension = pathExtension(path);
    if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) throw new Error(`IPC 附件读取不允许二进制扩展名 ${extension}`);
  }
}
function stringOrObjectArg(args: unknown[], index: number, maxBytes: number): void {
  if (typeof args[index] === "string") stringArg(args, index, maxBytes);
  else objectArg(args, index);
}

function sessionLaunchArg(args: unknown[], index: number): void {
  if (typeof args[index] === "string") { absoluteFilesystemPathArg(args, index, "工作区"); return; }
  const value = strictRecordArg(args, index, ["workspacePath", "profileId", "worktreeName", "worktreeRef", "modelId", "providerId", "effort", "mode"]);
  const workspacePath = requiredRecordString(value, "workspacePath", 32_767);
  if (!isAbsoluteWindowsPath(workspacePath)) throw new Error("IPC 字段 workspacePath 必须是绝对路径");
  optionalRecordString(value, "profileId", 512);
  optionalRecordString(value, "worktreeName", 512);
  optionalRecordString(value, "worktreeRef", 4_096);
  optionalRecordString(value, "modelId", 4_096);
  optionalRecordString(value, "providerId", 512);
  optionalRecordEnum(value, "effort", ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  optionalRecordEnum(value, "mode", ["agent", "plan", "auto"]);
}

function newTaskDraftArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["projectId", "workspacePath", "profileId", "worktreeName", "worktreeRef", "modelId", "providerId", "effort", "mode"]);
  requiredRecordString(value, "projectId", 512);
  const workspacePath = requiredRecordString(value, "workspacePath", 32_767);
  if (!isAbsoluteWindowsPath(workspacePath)) throw new Error("IPC 字段 workspacePath 必须是绝对路径");
  optionalRecordString(value, "profileId", 512);
  optionalRecordString(value, "worktreeName", 512);
  optionalRecordString(value, "worktreeRef", 4_096);
  optionalRecordString(value, "modelId", 4_096);
  optionalRecordString(value, "providerId", 512);
  optionalRecordEnum(value, "effort", ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  optionalRecordEnum(value, "mode", ["agent", "plan", "auto"]);
}
function optionalHttpUrlArg(args: unknown[], index: number): void {
  if (args[index] === undefined) return;
  const value = stringArg(args, index, 4_096);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("IPC URL 仅允许 HTTPS");
}
function attachmentArrayArg(args: unknown[], index: number): void {
  const value = args[index];
  if (!Array.isArray(value) || value.length > 128) throw new Error("IPC 附件列表无效或超过限制");
  for (const [attachmentIndex, attachment] of value.entries()) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) throw new Error(`IPC 附件 ${attachmentIndex + 1} 无效`);
    const record = attachment as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id || record.id.length > 512) throw new Error(`IPC 附件 ${attachmentIndex + 1} ID 无效`);
    if (typeof record.name !== "string" || !record.name || Buffer.byteLength(record.name, "utf8") > 32_767) throw new Error(`IPC 附件 ${attachmentIndex + 1} 名称无效`);
    if (!(record.kind === "file" || record.kind === "image" || record.kind === "folder")) throw new Error(`IPC 附件 ${attachmentIndex + 1} 类型无效`);
    if (record.path !== undefined && (typeof record.path !== "string" || !record.path || record.path.includes("\0") || Buffer.byteLength(record.path, "utf8") > 32_767)) throw new Error(`IPC 附件 ${attachmentIndex + 1} 路径无效`);
    if (record.data !== undefined && (typeof record.data !== "string" || Buffer.byteLength(record.data, "utf8") > 28 * 1024 * 1024)) throw new Error(`IPC 附件 ${attachmentIndex + 1} 数据过大`);
    if (record.size !== undefined && (typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0 || record.size > 20 * 1024 * 1024)) throw new Error(`IPC 附件 ${attachmentIndex + 1} 大小无效`);
  }
}
function optionalAttachmentArrayArg(args: unknown[], index: number): void { if (args[index] !== undefined) attachmentArrayArg(args, index); }
function requestIdArg(args: unknown[], index: number, optional = false): void {
  const value = args[index];
  if (optional && value === undefined) return;
  if (typeof value === "number") { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`IPC 参数 ${index + 1} 请求 ID 无效`); return; }
  idArg(args, index);
}
function promptArgs(args: unknown[]): void {
  idArg(args, 0);
  const text = args[1];
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 || text.includes("\0")) throw new Error("IPC Prompt 文本无效或超过限制");
  attachmentArrayArg(args, 2);
  if (args[3] !== undefined) idArg(args, 3);
}

function strictRecordArg(args: unknown[], index: number, allowed: readonly string[]): Record<string, unknown> {
  objectArg(args, index);
  const record = args[index] as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`IPC 参数 ${index + 1} 包含未知字段 ${key}`);
  return record;
}
function requiredRecordString(record: Record<string, unknown>, key: string, maxBytes: number, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== "string" || (!allowEmpty && !value) || value.includes("\0") || Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`IPC 字段 ${key} 无效`);
  return value;
}
function optionalRecordString(record: Record<string, unknown>, key: string, maxBytes: number): string | undefined {
  if (record[key] === undefined) return undefined;
  return requiredRecordString(record, key, maxBytes);
}
function optionalRecordStringAllowEmpty(record: Record<string, unknown>, key: string, maxBytes: number): string | undefined {
  if (record[key] === undefined) return undefined;
  const value = record[key];
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`IPC 字段 ${key} 无效`);
  return value;
}
function requiredRecordBoolean(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== "boolean") throw new Error(`IPC 字段 ${key} 必须是布尔值`);
  return record[key] as boolean;
}
function optionalRecordBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  if (record[key] === undefined) return undefined;
  return requiredRecordBoolean(record, key);
}
function requiredRecordInteger(record: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`IPC 字段 ${key} 必须是 ${min}-${max} 的整数`);
  return value as number;
}
function optionalRecordInteger(record: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  if (record[key] === undefined) return undefined;
  return requiredRecordInteger(record, key, min, max);
}
function requiredRecordNumber(record: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`IPC 字段 ${key} 必须是 ${min}-${max} 的数字`);
  return value;
}
function requiredRecordEnum(record: Record<string, unknown>, key: string, allowed: readonly (string | number)[]): string | number {
  const value = record[key];
  if (!allowed.includes(value as never)) throw new Error(`IPC 字段 ${key} 不在允许范围`);
  return value as string | number;
}
function optionalRecordEnum(record: Record<string, unknown>, key: string, allowed: readonly (string | number)[]): string | number | undefined {
  if (record[key] === undefined) return undefined;
  return requiredRecordEnum(record, key, allowed);
}
function recordStringArray(record: Record<string, unknown>, key: string, maxLength: number, maxBytes: number, optional = false): string[] | undefined {
  const value = record[key];
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`IPC 字段 ${key} 必须是受限字符串数组`);
  for (const item of value) if (typeof item !== "string" || !item || item.includes("\0") || Buffer.byteLength(item, "utf8") > maxBytes) throw new Error(`IPC 字段 ${key} 包含无效字符串`);
  return value as string[];
}

const APP_SETTINGS_PATCH_KEYS = [
  "cliPath", "httpProxy", "httpsProxy", "defaultModel", "defaultEffort", "defaultMode",
  "showThinking", "expandToolDetails", "automaticUpdateChecks", "lastAutomaticUpdateCheckAt",
  "fontScale", "uiDensity", "conversationContentWidth", "conversationFontScale", "recentWorkspaces", "activeWorkspace",
  "codexGroupCollapsed", "claudeGroupCollapsed", "projectToolsOpen", "sessionGroupCollapsed", "showArchivedCodex", "theme",
] as const satisfies readonly (keyof AppSettings)[];
type MissingAppSettingsPatchKey = Exclude<keyof AppSettings, (typeof APP_SETTINGS_PATCH_KEYS)[number]>;
const _assertAppSettingsPatchKeys: [MissingAppSettingsPatchKey] extends [never] ? true : MissingAppSettingsPatchKey = true;
void _assertAppSettingsPatchKeys;

const COMPUTER_SETTINGS_PATCH_KEYS = [
  "enabled", "experimentalUnlocked", "acceptanceVersion", "confirmNewApps", "alwaysAllowedAppIds", "maxScreenshotEdge", "emergencyShortcut",
] as const satisfies readonly (keyof ComputerUseSettings)[];
type MissingComputerSettingsPatchKey = Exclude<keyof ComputerUseSettings, (typeof COMPUTER_SETTINGS_PATCH_KEYS)[number]>;
const _assertComputerSettingsPatchKeys: [MissingComputerSettingsPatchKey] extends [never] ? true : MissingComputerSettingsPatchKey = true;
void _assertComputerSettingsPatchKeys;

function settingsPatchArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, APP_SETTINGS_PATCH_KEYS);
  if (value.cliPath !== undefined) cliPathSetting(value.cliPath);
  for (const key of ["httpProxy", "httpsProxy"] as const) {
    const proxy = optionalRecordStringAllowEmpty(value, key, 4_096);
    if (proxy) {
      let url: URL;
      try { url = new URL(proxy); } catch { throw new Error(`IPC 字段 ${key} 必须是代理 URL`); }
      if (!["http:", "https:", "socks:", "socks5:", "socks5h:"].includes(url.protocol)) throw new Error(`IPC 字段 ${key} 代理协议无效`);
    }
  }
  optionalRecordStringAllowEmpty(value, "defaultModel", 512);
  optionalRecordEnum(value, "defaultEffort", ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  optionalRecordEnum(value, "defaultMode", ["agent", "plan", "auto"]);
  optionalRecordBoolean(value, "showThinking");
  optionalRecordBoolean(value, "expandToolDetails");
  optionalRecordBoolean(value, "automaticUpdateChecks");
  if (value.lastAutomaticUpdateCheckAt !== undefined) {
    const stamp = requiredRecordString(value, "lastAutomaticUpdateCheckAt", 64);
    if (Number.isNaN(Date.parse(stamp))) throw new Error("IPC 字段 lastAutomaticUpdateCheckAt 无效");
  }
  optionalRecordInteger(value, "fontScale", 85, 130);
  optionalRecordInteger(value, "conversationContentWidth", 640, 1040);
  optionalRecordInteger(value, "conversationFontScale", 90, 135);
  optionalRecordEnum(value, "uiDensity", ["compact", "balanced", "comfortable"]);
  if (value.recentWorkspaces !== undefined) {
    if (!Array.isArray(value.recentWorkspaces) || value.recentWorkspaces.length > 200) throw new Error("IPC 字段 recentWorkspaces 必须是受限路径数组");
    for (const path of value.recentWorkspaces) absoluteFilesystemPathArg([path], 0, "最近工作区");
  }
  const activeWorkspace = optionalRecordStringAllowEmpty(value, "activeWorkspace", 32_767);
  if (activeWorkspace) absoluteFilesystemPathArg([activeWorkspace], 0, "活动工作区");
  optionalRecordBoolean(value, "codexGroupCollapsed");
  optionalRecordBoolean(value, "claudeGroupCollapsed");
  optionalRecordBoolean(value, "projectToolsOpen");
  optionalRecordBoolean(value, "showArchivedCodex");
  if (value.sessionGroupCollapsed !== undefined) {
    const groups = strictRecordArg([value.sessionGroupCollapsed], 0, ["normal", "fork", "worktree", "codex-continuation", "claude-continuation", "automation", "other"]);
    for (const key of Object.keys(groups)) requiredRecordBoolean(groups, key);
  }
  if (value.theme !== undefined) themeSettingsArg(value.theme);
}

function cliPathSetting(input: unknown): void {
  if (typeof input !== "string" || input.includes("\0") || Buffer.byteLength(input, "utf8") > 32_767) throw new Error("IPC 字段 cliPath 无效");
  if (!input) return;
  const path = absoluteFilesystemPathArg([input], 0, "Grok CLI");
  const name = win32.isAbsolute(path) ? win32.basename(path) : posix.basename(path);
  if (!/^grok(?:\.exe|\.cmd)?$/i.test(name)) throw new Error("IPC 字段 cliPath 必须指向 Grok CLI 可执行文件");
}

function themeSettingsArg(input: unknown): void {
  const value = strictRecordArg([input], 0, ["mode", "customBase", "colors", "background"]);
  requiredRecordEnum(value, "mode", ["dark", "light", "system", "custom"]);
  requiredRecordEnum(value, "customBase", ["dark", "light"]);
  const colors = strictRecordArg([value.colors], 0, ["background", "surface", "text", "muted", "accent", "border"]);
  for (const key of ["background", "surface", "text", "muted", "accent", "border"]) {
    const color = requiredRecordString(colors, key, 64);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`IPC 主题颜色 ${key} 无效`);
  }
  const background = strictRecordArg([value.background], 0, ["enabled", "scope", "fit", "position", "opacity", "blur", "dim"]);
  requiredRecordBoolean(background, "enabled");
  requiredRecordEnum(background, "scope", ["conversation", "window"]);
  requiredRecordEnum(background, "fit", ["cover", "contain"]);
  requiredRecordEnum(background, "position", ["center", "top", "bottom", "left", "right"]);
  requiredRecordNumber(background, "opacity", 0, 1);
  requiredRecordNumber(background, "blur", 0, 24);
  requiredRecordNumber(background, "dim", 0, 0.9);
}

function editorSaveArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["workspacePath", "path", "content", "encoding", "lineEnding", "expectedHash", "expectedModifiedAt", "overwrite"]);
  requiredRecordString(value, "workspacePath", 32_767);
  requiredRecordString(value, "path", 32_767);
  requiredRecordString(value, "content", 32 * 1024 * 1024, true);
  requiredRecordEnum(value, "encoding", ["utf8", "utf8-bom", "gb18030"]);
  requiredRecordEnum(value, "lineEnding", ["lf", "crlf", "mixed", "none"]);
  requiredRecordString(value, "expectedHash", 512, true);
  requiredRecordString(value, "expectedModifiedAt", 512, true);
  optionalRecordBoolean(value, "overwrite");
}
function openTargetArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["target", "sessionId", "executionRoot", "action", "applicationId", "line", "column"]);
  requiredRecordString(value, "target", 32_767);
  optionalRecordString(value, "sessionId", 512);
  optionalRecordString(value, "executionRoot", 32_767);
  optionalRecordEnum(value, "action", ["open", "reveal", "copy-path", "open-with"]);
  optionalRecordEnum(value, "applicationId", ["explorer", "vscode", "cursor", "notepad", "terminal", "codex-cli"]);
  optionalRecordInteger(value, "line", 1, 10_000_000);
  optionalRecordInteger(value, "column", 1, 10_000_000);
}
function gitReviewScopeArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["kind", "revision", "base", "paths"]);
  const kind = requiredRecordEnum(value, "kind", ["unstaged", "staged", "commit", "branch", "last-turn"]);
  if (kind === "commit") requiredRecordString(value, "revision", 512);
  if (kind === "branch") requiredRecordString(value, "base", 512);
  if (kind === "last-turn") recordStringArray(value, "paths", 10_000, 32_767);
}
function gitHunkActionArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["snapshotId", "scope", "fileId", "hunkId", "action", "confirmed"]);
  requiredRecordString(value, "snapshotId", 512);
  const nested = value.scope;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) throw new Error("IPC 字段 scope 无效");
  gitReviewScopeArg([nested], 0);
  if (!(["unstaged", "staged"] as unknown[]).includes((nested as Record<string, unknown>).kind)) throw new Error("IPC 区块操作范围无效");
  requiredRecordString(value, "fileId", 512);
  requiredRecordString(value, "hunkId", 512);
  requiredRecordEnum(value, "action", ["stage", "unstage", "revert"]);
  optionalRecordBoolean(value, "confirmed");
}
function gitDiscardArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["trackedPaths", "untrackedPaths", "confirmedPaths"]);
  recordStringArray(value, "trackedPaths", 10_000, 32_767);
  recordStringArray(value, "untrackedPaths", 10_000, 32_767);
  recordStringArray(value, "confirmedPaths", 10_000, 32_767);
}
function worktreeCreateArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["workspacePath", "name", "baseRef", "sourceSessionId", "agentId"]);
  requiredRecordString(value, "workspacePath", 32_767);
  requiredRecordString(value, "name", 512);
  optionalRecordString(value, "baseRef", 512);
  optionalRecordString(value, "sourceSessionId", 512);
  optionalRecordString(value, "agentId", 512);
}
function memorySaveArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["workspacePath", "scope", "content", "expectedHash", "expectedModifiedAt", "overwrite"]);
  requiredRecordString(value, "workspacePath", 32_767);
  requiredRecordEnum(value, "scope", ["global", "workspace"]);
  requiredRecordString(value, "content", 2 * 1024 * 1024, true);
  requiredRecordString(value, "expectedHash", 512, true);
  requiredRecordString(value, "expectedModifiedAt", 512, true);
  optionalRecordBoolean(value, "overwrite");
}
function providerScanScopeArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["providerId", "modelIds", "protocols", "includeReasoning", "includeTools", "includeImages", "context"]);
  requiredRecordString(value, "providerId", 512);
  recordStringArray(value, "modelIds", 1_000, 512, true);
  const protocols = recordStringArray(value, "protocols", 3, 64, true);
  if (protocols?.some((protocol) => !["chat_completions", "responses", "messages"].includes(protocol))) throw new Error("IPC Provider 扫描协议无效");
  optionalRecordBoolean(value, "includeReasoning");
  optionalRecordBoolean(value, "includeTools");
  optionalRecordBoolean(value, "includeImages");
  if (value.context !== undefined) {
    const context = value.context;
    if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("IPC Provider 上下文扫描参数无效");
    const nested = strictRecordArg([context], 0, ["mode", "targetTokens", "maxRequests", "confirmedCost"]);
    requiredRecordEnum(nested, "mode", ["off", "safe", "exact"]);
    optionalRecordInteger(nested, "targetTokens", 1, 10_000_000);
    optionalRecordInteger(nested, "maxRequests", 1, 64);
    optionalRecordBoolean(nested, "confirmedCost");
  }
}
function automationTaskInputArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["id", "name", "workspace", "schedule", "profile", "executionProfileId", "enabled", "wakeToRun", "notify", "missedRunPolicy", "skillCommand", "contextPolicy", "prompt"]);
  optionalRecordString(value, "id", 512);
  requiredRecordString(value, "name", 512);
  requiredRecordString(value, "workspace", 32_767);
  optionalRecordString(value, "executionProfileId", 512);
  requiredRecordBoolean(value, "enabled");
  requiredRecordBoolean(value, "wakeToRun");
  requiredRecordBoolean(value, "notify");
  requiredRecordEnum(value, "missedRunPolicy", ["run-once", "skip"]);
  optionalRecordString(value, "skillCommand", 4_096);
  requiredRecordEnum(value, "contextPolicy", ["reuse", "fresh"]);
  optionalRecordString(value, "prompt", 2 * 1024 * 1024);
  const schedule = value.schedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) throw new Error("IPC 自动化 schedule 无效");
  const scheduleValue = strictRecordArg([schedule], 0, ["kind", "at", "time", "days", "minutes"]);
  const kind = requiredRecordEnum(scheduleValue, "kind", ["once", "daily", "weekly", "interval"]);
  if (kind === "once") requiredRecordString(scheduleValue, "at", 512);
  if (kind === "daily" || kind === "weekly") requiredRecordString(scheduleValue, "time", 64);
  if (kind === "weekly") {
    const days = scheduleValue.days;
    if (!Array.isArray(days) || days.length > 7 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("IPC 自动化周日期无效");
  }
  if (kind === "interval") requiredRecordInteger(scheduleValue, "minutes", 1, 525_600);
  const profile = value.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("IPC 自动化 profile 无效");
  const profileValue = strictRecordArg([profile], 0, ["accountId", "providerId", "modelId", "effort", "mode", "permissionPolicy", "computerEnabled"]);
  optionalRecordString(profileValue, "accountId", 512);
  optionalRecordString(profileValue, "providerId", 512);
  requiredRecordString(profileValue, "modelId", 512, true);
  requiredRecordEnum(profileValue, "effort", ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  requiredRecordEnum(profileValue, "mode", ["agent", "plan", "auto"]);
  requiredRecordEnum(profileValue, "permissionPolicy", ["auto", "agent", "read-only"]);
  requiredRecordBoolean(profileValue, "computerEnabled");
}
function automationTaskPatchArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["id", "name", "workspace", "schedule", "profile", "executionProfileId", "enabled", "wakeToRun", "notify", "missedRunPolicy", "skillCommand", "contextPolicy", "prompt"]);
  optionalRecordString(value, "id", 512);
  optionalRecordString(value, "name", 512);
  optionalRecordString(value, "workspace", 32_767);
  optionalRecordString(value, "executionProfileId", 512);
  optionalRecordBoolean(value, "enabled");
  optionalRecordBoolean(value, "wakeToRun");
  optionalRecordBoolean(value, "notify");
  optionalRecordEnum(value, "missedRunPolicy", ["run-once", "skip"]);
  optionalRecordString(value, "skillCommand", 4_096);
  optionalRecordEnum(value, "contextPolicy", ["reuse", "fresh"]);
  if (value.prompt !== undefined) requiredRecordString(value, "prompt", 2 * 1024 * 1024, true);
  if (value.schedule !== undefined) {
    automationTaskInputArg([{
      name: "patch",
      workspace: "patch",
      schedule: value.schedule,
      profile: { modelId: "", effort: "", mode: "agent", permissionPolicy: "agent", computerEnabled: false },
      enabled: true,
      wakeToRun: false,
      notify: false,
      missedRunPolicy: "skip",
      contextPolicy: "reuse",
    }], 0);
  }
  if (value.profile !== undefined) {
    const profile = strictRecordArg([value.profile], 0, ["accountId", "providerId", "modelId", "effort", "mode", "permissionPolicy", "computerEnabled"]);
    optionalRecordString(profile, "accountId", 512);
    optionalRecordString(profile, "providerId", 512);
    if (profile.modelId !== undefined) requiredRecordString(profile, "modelId", 512, true);
    optionalRecordEnum(profile, "effort", ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    optionalRecordEnum(profile, "mode", ["agent", "plan", "auto"]);
    optionalRecordEnum(profile, "permissionPolicy", ["auto", "agent", "read-only"]);
    optionalRecordBoolean(profile, "computerEnabled");
  }
}

function automationPolicyArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["defaultProfile", "maxConcurrentRuns", "confirmationTimeoutMinutes", "inactivityTimeoutMinutes", "notifyOnSuccess", "notifyOnFailure"]);
  if (value.defaultProfile !== undefined) {
    const profile = value.defaultProfile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("IPC 自动化默认 profile 无效");
    automationTaskInputArg([{ name: "policy", workspace: "policy", schedule: { kind: "interval", minutes: 1 }, profile, enabled: true, wakeToRun: false, notify: false, missedRunPolicy: "skip", contextPolicy: "fresh" }], 0);
  }
  optionalRecordInteger(value, "maxConcurrentRuns", 1, 64);
  optionalRecordInteger(value, "confirmationTimeoutMinutes", 1, 10_080);
  optionalRecordInteger(value, "inactivityTimeoutMinutes", 0, 10_080);
  optionalRecordBoolean(value, "notifyOnSuccess");
  optionalRecordBoolean(value, "notifyOnFailure");
}
function mediaCreationArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["kind", "prompt", "aspectRatio", "duration", "resolution", "sessionId", "route", "providerId", "modelId", "referencePaths"]);
  requiredRecordEnum(value, "kind", ["image", "video"]);
  requiredRecordString(value, "prompt", 2 * 1024 * 1024);
  requiredRecordEnum(value, "aspectRatio", ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"]);
  optionalRecordEnum(value, "duration", [6, 10]);
  optionalRecordEnum(value, "resolution", ["480p", "720p"]);
  requiredRecordString(value, "sessionId", 512);
  optionalRecordEnum(value, "route", ["auto", "cli", "provider"]);
  optionalRecordString(value, "providerId", 512);
  optionalRecordString(value, "modelId", 512);
  recordStringArray(value, "referencePaths", 16, 32_767, true);
}
function computerStartArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["sessionId", "appId", "windowId"]);
  requiredRecordString(value, "sessionId", 512);
  requiredRecordString(value, "appId", 512);
  optionalRecordString(value, "windowId", 512);
}
function computerSettingsArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, COMPUTER_SETTINGS_PATCH_KEYS);
  optionalRecordBoolean(value, "enabled");
  optionalRecordBoolean(value, "experimentalUnlocked");
  optionalRecordString(value, "acceptanceVersion", 512);
  optionalRecordBoolean(value, "confirmNewApps");
  recordStringArray(value, "alwaysAllowedAppIds", 1_000, 512, true);
  optionalRecordInteger(value, "maxScreenshotEdge", 256, 8_192);
  optionalRecordString(value, "emergencyShortcut", 128);
}
function cliUpdateInputArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["targetVersion", "expectedCurrentVersion", "allowMajorUpgrade"]);
  const target = requiredRecordString(value, "targetVersion", 64);
  const current = requiredRecordString(value, "expectedCurrentVersion", 64);
  if (!/^\d+\.\d+\.\d+$/.test(target) || !/^\d+\.\d+\.\d+$/.test(current)) throw new Error("IPC CLI 版本格式无效");
  optionalRecordBoolean(value, "allowMajorUpgrade");
}
function sessionCompactionPolicyArg(args: unknown[], index: number): void {
  const value = strictRecordArg(args, index, ["mode", "thresholdPercent"]);
  const mode = requiredRecordEnum(value, "mode", ["inherit", "custom"]);
  if (mode === "custom") requiredRecordInteger(value, "thresholdPercent", 60, 95);
  else if (value.thresholdPercent !== undefined) throw new Error("继承 CLI 压缩策略时不能指定阈值");
}
function mediaSourceArg(args: unknown[], index: number, allowData: boolean): void {
  const value = stringArg(args, index, allowData ? 28 * 1024 * 1024 : 32_767);
  if (/^grok-media:\/\/access\/[0-9a-f-]{36}$/i.test(value)) return;
  if (allowData && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return;
  throw new Error("IPC 媒体来源必须是受控媒体句柄");
}
