/** Electron prefixes rejected IPC calls with "Error invoking remote method '<channel>': Error: ". */
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

/** Strip transport framing so users read the main-process message, not the IPC channel. */
export function readableError(message: string): string { return message.replace(IPC_PREFIX, "").trim() || message; }

/** Keep Error objects readable without losing non-Error IPC rejections. */
export function errorMessage(value: unknown): string { return readableError(value instanceof Error ? value.message : String(value)); }
