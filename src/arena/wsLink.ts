/// <reference types="vite/client" />
// Browser side of the arena bridge (only active under `npm run arena`).
import type { Activity, ClankerLink, MatchInfo, ModelChoice, ToolExec, TurnResult } from './link.ts';

type Hot = NonNullable<ImportMeta['hot']>;

export function arenaAvailable(): boolean {
  return import.meta.env.MODE === 'arena' && !!import.meta.hot;
}

let models: ModelChoice[] | null = null;
let modelsError = '';
let helloSent = false;

/** Asks the host which models exist (Copilot catalog + free mocks). */
export function requestModels(onReady: (m: ModelChoice[], err: string) => void): void {
  const hot = import.meta.hot;
  if (!arenaAvailable() || !hot) return;
  if (models) {
    onReady(models, modelsError);
    return;
  }
  hot.on('arena:hello', (d: { models: ModelChoice[]; copilotError?: string }) => {
    models = d.models;
    modelsError = d.copilotError ?? '';
    onReady(models, modelsError);
  });
  if (!helloSent) {
    helloSent = true;
    hot.send('arena:hello', {});
  }
}

export function cachedModels(): ModelChoice[] {
  return models ?? [];
}

export class WsLink implements ClankerLink {
  onActivity: ((a: Activity) => void) | null = null;
  private readonly hot: Hot;
  private matchId = '';
  private reqSeq = 0;
  private readonly replies = new Map<string, (d: { ok: boolean; error?: string; result?: TurnResult; dir?: string }) => void>();
  private readonly execs = new Map<string, ToolExec>();

  constructor() {
    const hot = import.meta.hot;
    if (!hot) throw new Error('arena needs the dev server (npm run arena)');
    this.hot = hot;
    hot.on('arena:reply', (d: { reqId: string; ok: boolean; error?: string; result?: TurnResult; dir?: string }) => {
      const r = this.replies.get(d.reqId);
      if (!r) return;
      this.replies.delete(d.reqId);
      r(d);
    });
    hot.on('arena:tool-call', async (d: { matchId: string; turnReq: string; callId: string; name: string; args: Record<string, unknown> }) => {
      if (d.matchId !== this.matchId) return;
      const exec = this.execs.get(d.turnReq);
      const result = exec ? await exec(d.name, d.args ?? {}) : { error: 'That turn is over.' };
      hot.send('arena:tool-result', { callId: d.callId, result });
    });
    hot.on('arena:activity', (d: { matchId: string; activity: Activity }) => {
      if (d.matchId === this.matchId) this.onActivity?.(d.activity);
    });
  }

  private request<T extends { ok: boolean; error?: string }>(event: string, payload: Record<string, unknown>, reqId = `r${++this.reqSeq}`): Promise<T> {
    return new Promise((resolve) => {
      this.replies.set(reqId, resolve as (d: unknown) => void);
      this.hot.send(event, { ...payload, reqId });
    });
  }

  async startMatch(info: MatchInfo): Promise<void> {
    this.matchId = info.matchId;
    const r = await this.request<{ ok: boolean; error?: string }>('arena:start', { info });
    if (!r.ok) throw new Error(r.error ?? 'could not start match');
  }

  async playTurn(team: 0 | 1, prompt: string, exec: ToolExec, timeoutMs: number): Promise<TurnResult> {
    const reqId = `t${++this.reqSeq}`;
    this.execs.set(reqId, exec);
    try {
      const r = await this.request<{ ok: boolean; error?: string; result?: TurnResult }>('arena:turn', { matchId: this.matchId, team, prompt, timeoutMs }, reqId);
      if (!r.ok || !r.result) return { ok: false, error: r.error ?? 'host error', usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, nanoAiu: 0 }, ms: 0 };
      return r.result;
    } finally {
      this.execs.delete(reqId);
    }
  }

  log(entry: Record<string, unknown>): void {
    this.hot.send('arena:log', { matchId: this.matchId, entry });
  }

  abort(team: 0 | 1): void {
    this.hot.send('arena:abort', { matchId: this.matchId, team });
  }

  async endMatch(summary: Record<string, unknown>): Promise<{ dir?: string }> {
    const r = await this.request<{ ok: boolean; error?: string; dir?: string }>('arena:end', { matchId: this.matchId, summary });
    if (!r.ok) throw new Error(r.error ?? 'end failed');
    return { dir: r.dir };
  }

  /** Streams a recorded video chunk to the host. */
  async sendVideo(chunk: Blob, done: boolean): Promise<string> {
    const res = await fetch(`/arena/video?match=${encodeURIComponent(this.matchId)}${done ? '&done=1' : ''}`, { method: 'POST', body: chunk });
    return res.text();
  }
}
