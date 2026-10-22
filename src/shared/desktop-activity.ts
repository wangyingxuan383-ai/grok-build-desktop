/** Public desktop activity: display labels and counts, never paths, prompts or credentials. */
export interface DesktopActivitySnapshot {
  /** Already-owned background work, projected without launching or polling a CLI. */
  tasks?: import("./desktop-pet").PetTarget[];
  sessions: Array<{
    sessionId: string;
    title: string;
    projectName: string;
    status: "running" | "awaiting" | "error";
    /** False for configuration/control transitions with no real prompt turn. */
    activeTurn?: boolean;
  }>;
  runningCount: number;
  awaitingCount: number;
  errorCount: number;
  inboxUnreadCount: number;
  livePhoneCount: number;
}
