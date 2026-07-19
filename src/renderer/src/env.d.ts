/// <reference types="vite/client" />

import type { GrokDesktopApi } from "../../shared/types";

declare global {
  interface Window {
    grokDesktop: GrokDesktopApi;
  }
}

export {};
