/** Keep the user's shell environment, excluding credentials/control flags injected by Desktop. */
export function workspaceTerminalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key,value]) => value !== undefined
    && !/^GROK_DESKTOP_/i.test(key) && !/^ELECTRON_/i.test(key)).concat([["TERM","xterm-256color"]]));
}
