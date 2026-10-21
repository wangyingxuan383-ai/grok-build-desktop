/** One deadline timer serves frames, fades, hover, long press and deferred clicks. */
export class PetScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly run: (now: number) => number | undefined, private readonly now: () => number = () => performance.now()) {}
  wake(): void {
    this.stop();
    if (this.disposed) return;
    const next = this.run(this.now());
    if (next !== undefined && Number.isFinite(next)) this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, Math.max(1, Math.ceil(next - this.now())));
  }
  stop(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; } }
  dispose(): void { this.disposed = true; this.stop(); }
}
