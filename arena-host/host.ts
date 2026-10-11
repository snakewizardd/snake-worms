// Match host: owns the model adapters, the match log on disk, the report and the video file.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { MatchInfo, ModelChoice, ToolExec, TurnResult } from '../src/arena/link.ts';
import type { Activity } from '../src/arena/link.ts';
import { toolsFor } from '../src/arena/schema.ts';
import type { Adapter } from './adapters/types.ts';
import { HumanSeat, MockAdapter, MOCK_MODELS } from './adapters/mock.ts';
import { CopilotAdapter, listCopilotModels, stopCopilot } from './adapters/copilot.ts';
import { writeReport } from './report.ts';

interface Match {
  info: MatchInfo;
  dir: string;
  adapters: [Adapter, Adapter];
  videoBytes: number;
}

export interface HostOptions {
  root: string;
  /** Fake thinking delay for mock players (ms). */
  mockDelayMs?: number;
}

export class ArenaHost {
  private readonly matches = new Map<string, Match>();
  private modelCache: ModelChoice[] | null = null;
  readonly logRoot: string;
  readonly stateDir: string;
  private readonly opts: HostOptions;

  constructor(opts: HostOptions) {
    this.opts = opts;
    this.logRoot = join(opts.root, 'arena-logs');
    this.stateDir = join(opts.root, '.arena-state');
  }

  async models(): Promise<{ models: ModelChoice[]; copilotError?: string }> {
    const mocks: ModelChoice[] = MOCK_MODELS.map((m) => ({ provider: 'mock', id: m.id, label: m.label, note: m.note }));
    if (this.modelCache) return { models: [...this.modelCache, ...mocks] };
    try {
      const list = await listCopilotModels();
      this.modelCache = list
        .filter((m) => m.id !== 'auto' && m.policy?.state !== 'disabled')
        .map((m) => ({ provider: 'copilot', id: m.id, label: prettyModel(m.id), note: m.policy?.state === 'enabled' ? undefined : 'may need enabling in Copilot settings' }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { models: [...this.modelCache, ...mocks] };
    } catch (e) {
      return { models: mocks, copilotError: String((e as Error).message).slice(0, 200) };
    }
  }

  private match(id: string): Match {
    const m = this.matches.get(id);
    if (!m) throw new Error(`unknown match ${id}`);
    return m;
  }

  log(matchId: string, entry: Record<string, unknown>): void {
    const m = this.matches.get(matchId);
    if (!m) return;
    appendFileSync(join(m.dir, 'match.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  }

  async start(info: MatchInfo): Promise<string> {
    const dir = join(this.logRoot, info.matchId);
    mkdirSync(dir, { recursive: true });
    const make = (provider: string): Adapter => (provider === 'human' ? new HumanSeat() : provider === 'mock' ? new MockAdapter(this.opts.mockDelayMs ?? 600) : new CopilotAdapter(this.stateDir));
    const adapters: [Adapter, Adapter] = [make(info.players[0].provider), make(info.players[1].provider)];
    const m: Match = { info, dir, adapters, videoBytes: 0 };
    this.matches.set(info.matchId, m);
    this.log(info.matchId, { type: 'host_start', players: info.players.map((p) => ({ provider: p.provider, model: p.model, label: p.label, effort: p.effort })), meta: info.meta });
    await Promise.all(adapters.map((a, i) => a.start(info.players[i]!, toolsFor(info.meta.style === 'player' ? 'player' : 'oracle'))));
    this.log(info.matchId, { type: 'sessions_ready' });
    return dir;
  }

  async turn(matchId: string, team: 0 | 1, prompt: string, timeoutMs: number, exec: ToolExec, onActivity: (a: Activity) => void): Promise<TurnResult> {
    const m = this.match(matchId);
    const r = await m.adapters[team].turn(prompt, exec, timeoutMs, (a) => {
      const full = { ...a, team } as Activity;
      this.log(matchId, { type: 'activity', team, kind: a.kind, text: a.text, usage: a.usage });
      onActivity(full);
    });
    return r;
  }

  async abort(matchId: string, team: 0 | 1): Promise<void> {
    const m = this.matches.get(matchId);
    if (!m) return;
    this.log(matchId, { type: 'abort', team, note: 'turn already ended in the game; model call stopped to save credits' });
    await m.adapters[team].abort().catch(() => {});
  }

  async end(matchId: string, summary: Record<string, unknown>): Promise<string> {
    const m = this.match(matchId);
    this.log(matchId, { type: 'host_end' });
    await Promise.all(m.adapters.map((a) => a.stop().catch(() => {})));
    writeFileSync(join(m.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    try {
      writeReport(m.dir);
    } catch (e) {
      writeFileSync(join(m.dir, 'report-error.txt'), String((e as Error).stack));
    }
    return m.dir;
  }

  appendVideo(matchId: string, chunk: Buffer): void {
    const m = this.match(matchId);
    appendFileSync(join(m.dir, 'broadcast.webm'), chunk);
    m.videoBytes += chunk.length;
  }

  /** Converts the browser recording to MP4 with the local ffmpeg (if present). */
  finishVideo(matchId: string): Promise<string> {
    const m = this.match(matchId);
    const src = join(m.dir, 'broadcast.webm');
    const out = join(m.dir, 'broadcast.mp4');
    if (!existsSync(src)) return Promise.resolve('no video');
    return new Promise((resolve) => {
      const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'fps=30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += String(d)));
      p.on('error', (e) => resolve(`ffmpeg not available: ${e.message}`));
      p.on('close', (code) => {
        this.log(matchId, { type: 'video', webmBytes: m.videoBytes, mp4: code === 0 ? out : null, ffmpegError: code === 0 ? undefined : err.slice(0, 500) });
        resolve(code === 0 ? out : `ffmpeg exit ${code}: ${err.slice(0, 200)}`);
      });
    });
  }

  async shutdown(): Promise<void> {
    for (const m of this.matches.values()) await Promise.all(m.adapters.map((a) => a.stop().catch(() => {})));
    await stopCopilot();
  }

  readLog(matchId: string): string {
    return readFileSync(join(this.match(matchId).dir, 'match.jsonl'), 'utf8');
  }
}

export function prettyModel(id: string): string {
  const m = id.match(/^(claude|gpt|grok|kimi|mai|gemini)-(.*)$/);
  if (!m) return id.toUpperCase();
  const fam = m[1] === 'gpt' ? 'GPT' : m[1]!.toUpperCase();
  const rest = m[2]!.replace(/-/g, ' ').toUpperCase();
  return m[1] === 'gpt' ? `${fam}-${rest}` : `${fam} ${rest}`;
}
