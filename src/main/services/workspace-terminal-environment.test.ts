import { expect, it } from "vitest";
import { workspaceTerminalEnvironment } from "./workspace-terminal-environment";
it("removes Desktop injected provider credentials/controls but preserves user shell configuration",()=>{
 const input={Path:"tools",HTTPS_PROXY:"http://localhost:7890",CUSTOM_USER_KEY:"user-value",GROK_DESKTOP_PROVIDER_DEMO_KEY:"secret",grok_desktop_automation_worker:"1",ELECTRON_RUN_AS_NODE:"1"};
 expect(workspaceTerminalEnvironment(input)).toEqual({Path:"tools",HTTPS_PROXY:"http://localhost:7890",CUSTOM_USER_KEY:"user-value",TERM:"xterm-256color"});
 expect(input.GROK_DESKTOP_PROVIDER_DEMO_KEY).toBe("secret");
});
