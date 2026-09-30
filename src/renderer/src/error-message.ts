/** Keep Error objects readable without losing non-Error IPC rejections. */
export function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
