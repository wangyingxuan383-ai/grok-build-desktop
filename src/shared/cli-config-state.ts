/** Renderer-safe observation only; never include paths, endpoints or parser errors. */
export interface CliConfigState {
  revision: number;
  changedAt: string;
  defaultModelId?: string;
  /** The declared default model has an explicit HTTP(S) loopback endpoint. */
  externalRouting: boolean;
  notice?: "config-unavailable" | "config-invalid" | "config-too-large" | "watch-unavailable";
}

/** Optional future preload contract. Subscribing must return an unsubscribe function. */
export interface CliConfigStatusApi {
  getCliConfigState(): Promise<CliConfigState>;
  onCliConfigChanged(listener: (state: CliConfigState) => void): () => void;
}
