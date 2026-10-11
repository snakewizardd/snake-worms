// Free, deterministic stand-ins that drive the exact same tools a real model would.
import type { PlayerSpec, ToolExec, TurnResult } from '../../src/arena/link.ts';
import { emptyUsage } from '../../src/arena/link.ts';
import type { ToolSchema } from '../../src/arena/schema.ts';
import type { Adapter, ActivitySink } from './types.ts';
import { sleep } from './types.ts';

export const MOCK_MODELS = [
  { id: 'mock-sharpshooter', label: 'MOCK SHARPSHOOTER', note: 'free: searches, verifies, fires the best shot' },
  { id: 'mock-chaos', label: 'MOCK CHAOS GOBLIN', note: 'free: moves around, random weapons, lots of taunts' },
  { id: 'mock-stall', label: 'MOCK STALLER', note: 'free: never commits (tests timeouts)' },
];

interface Cand {
  shot_id?: string;
  weapon: string;
  facing: string;
  elevation_deg?: number;
  power?: number;
  fuse?: number;
  target_x?: number;
  target_y?: number;
  predicted?: { net_score?: number };
}

export class MockAdapter implements Adapter {
  private kind = 'mock-sharpshooter';
  private n = 0;
  /** Milliseconds of fake "thinking" between tool calls (0 in headless tests). */
  private readonly delayMs: number;
  constructor(delayMs = 600) {
    this.delayMs = delayMs;
  }

  async start(p: PlayerSpec, tools: ToolSchema[]): Promise<void> {
    this.kind = p.model;
    this.player = tools.some((t) => t.name === 'aim_guide');
  }

  private player = false;

  /** Real-player mock: aims by the physics formula at the nearest enemy, checks the guide, fires. */
  private async playerTurn(prompt: string, exec: ToolExec, act: ActivitySink, t0: number, usage: TurnResult['usage']): Promise<TurnResult> {
    const obs = JSON.parse(prompt.split('OBSERVATION:\n')[1]!.split('\n\nMAP:')[0]!) as { active_snake: { x: number; y: number }; enemy_snakes: Array<{ name: string; x: number; y: number }> };
    const me = obs.active_snake;
    const target = [...obs.enemy_snakes].sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
    if (!target) {
      await exec('skip_turn', {});
      return { ok: true, text: 'Nobody to shoot.', usage, ms: Date.now() - t0 };
    }
    const facing = target.x >= me.x ? 'right' : 'left';
    const dx = Math.abs(target.x - me.x);
    // 45 degree lob: range ~ v^2 / g (ignoring height); add some chaos for the goblin.
    let power = Math.min(1, Math.sqrt(dx * 0.2) / 10 + (this.kind === 'mock-chaos' ? (this.n % 3) * 0.05 : 0));
    act({ kind: 'reasoning', text: `Target ${target.name} is ${dx}px ${facing}. A 45 degree lob needs about power ${power.toFixed(2)}.` });
    const g1 = (await exec('aim_guide', { weapon: 'grenade', facing, elevation_deg: 45, power })) as { guide_ends?: string };
    if (String(g1.guide_ends ?? '').includes('DANGER')) power = Math.min(1, power + 0.2);
    await exec('attack', { weapon: 'grenade', facing, elevation_deg: 45, power, fuse: 3, retreat: 'auto', taunt: this.kind === 'mock-chaos' ? 'LOB CITY' : 'BY THE NUMBERS' });
    return { ok: true, text: `Lobbed a grenade at ${target.name}.`, usage, ms: Date.now() - t0 };
  }

  async turn(prompt: string, exec: ToolExec, timeoutMs: number, act: ActivitySink): Promise<TurnResult> {
    const t0 = Date.now();
    this.n++;
    const usage = { ...emptyUsage(), calls: 1, inputTokens: Math.round(prompt.length / 4), outputTokens: 40, cost: 0.5, nanoAiu: 0.5e9 };
    act({ kind: 'usage', text: '', usage });
    const think = async (): Promise<void> => {
      if (this.delayMs) await sleep(this.delayMs * (0.5 + Math.random()));
    };
    if (this.kind === 'mock-stall') {
      act({ kind: 'message', text: 'Hmm, let me think about this very carefully...' });
      await sleep(timeoutMs + 50);
      return { ok: false, timedOut: true, error: 'timed out', usage, ms: Date.now() - t0 };
    }
    act({ kind: 'reasoning', text: this.kind === 'mock-chaos' ? 'Chaos is a ladder. Let us find something loud.' : 'Scanning for the highest-value shot from here.' });
    await think();
    if (this.player) return this.playerTurn(prompt, exec, act, t0, usage);
    if (this.kind === 'mock-chaos') {
      if (this.n % 2 === 0) await exec('move', { direction: this.n % 4 === 0 ? 'left' : 'right', distance: 40 });
      await exec('taunt', { text: ['SHEEP O CLOCK', 'CALCULATED (NOT)', 'I AM THE WIND'][this.n % 3] });
      await think();
    }
    const found = (await exec('find_shots', { count: 4, ...(this.kind === 'mock-chaos' ? { weapons: ['grenade', 'cluster', 'sheep', 'bazooka', 'melon', 'piano', 'sheepRain'] } : {}) })) as { candidates?: Cand[] };
    await think();
    const cands = found.candidates ?? [];
    const pick = this.kind === 'mock-chaos' ? cands[Math.min(cands.length - 1, this.n % 3)] : cands[0];
    if (!pick) {
      act({ kind: 'message', text: 'Nothing hits from here. Repositioning.' });
      await exec('move', { direction: this.n % 2 ? 'left' : 'right', distance: 60 });
      const again = (await exec('find_shots', { count: 1 })) as { candidates?: Cand[] };
      const p2 = again.candidates?.[0];
      if (p2) {
        await exec('attack', { ...strip(p2), retreat: 'auto', taunt: 'FOUND YOU' });
        return { ok: true, text: 'Moved and fired.', usage, ms: Date.now() - t0 };
      }
      await exec('skip_turn', { taunt: 'I WILL ALLOW IT' });
      return { ok: true, text: 'Skipped.', usage, ms: Date.now() - t0 };
    }
    if (this.kind === 'mock-sharpshooter') {
      await exec('simulate', { shot_id: pick.shot_id });
      await think();
    }
    const res = (await exec('attack', { shot_id: pick.shot_id, retreat: 'auto', taunt: this.kind === 'mock-chaos' ? 'YOLO' : 'CALCULATED.' })) as { error?: string };
    if (res.error) {
      act({ kind: 'error', text: res.error });
      await exec('skip_turn', {});
    }
    act({ kind: 'message', text: `Fired ${pick.weapon}.` });
    return { ok: true, text: `Fired ${pick.weapon}.`, usage, ms: Date.now() - t0 };
  }

  async abort(): Promise<void> {}

  async stop(): Promise<void> {}
}

/** The human seat: they play with the normal controls, so the host never asks it for a turn. */
export class HumanSeat implements Adapter {
  async start(): Promise<void> {}
  async turn(): Promise<TurnResult> {
    return { ok: true, usage: emptyUsage(), ms: 0 };
  }
  async abort(): Promise<void> {}
  async stop(): Promise<void> {}
}

function strip(c: Cand): Record<string, unknown> {
  const o: Record<string, unknown> = { weapon: c.weapon, facing: c.facing };
  for (const k of ['elevation_deg', 'power', 'fuse', 'target_x', 'target_y'] as const) if (c[k] !== undefined) o[k] = c[k];
  return o;
}
