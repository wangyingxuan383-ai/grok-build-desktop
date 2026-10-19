/** Public desktop activity: display labels and counts, never paths, prompts or credentials. */
export interface DesktopActivitySnapshot {
  sessions: Array<{
    sessionId: string;
    title: string;
    projectName: string;
    status: "running" | "awaiting" | "error";
  }>;
  runningCount: number;
  awaitingCount: number;
  errorCount: number;
  inboxUnreadCount: number;
  livePhoneCount: number;
}
