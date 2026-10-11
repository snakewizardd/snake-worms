// Records the broadcast canvas + game audio and streams chunks to the host as it goes,
// so even a crash mid-match keeps everything recorded up to that point.
export class Recorder {
  private rec: MediaRecorder | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stopped: Promise<void> | null = null;
  bytes = 0;
  mime = '';

  start(canvas: HTMLCanvasElement, audio: MediaStream | null, upload: (b: Blob, done: boolean) => Promise<string>): boolean {
    if (typeof MediaRecorder === 'undefined') return false;
    const stream = canvas.captureStream(30);
    for (const t of audio?.getAudioTracks() ?? []) stream.addTrack(t);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    this.mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    let finalResolve: () => void = () => {};
    this.stopped = new Promise((r) => (finalResolve = r));
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      this.bytes += e.data.size;
      const chunk = e.data;
      this.queue = this.queue.then(() => upload(chunk, false)).catch(() => {});
    };
    rec.onstop = () => {
      this.queue = this.queue.then(() => upload(new Blob([]), true)).then(() => finalResolve(), () => finalResolve());
    };
    rec.start(3000);
    this.rec = rec;
    return true;
  }

  /** Stops recording and resolves once the host has the whole file (and converted it). */
  async stop(): Promise<void> {
    if (!this.rec || this.rec.state === 'inactive') return;
    this.rec.stop();
    await this.stopped;
    await this.queue;
  }
}
