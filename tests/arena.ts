// Headless live-arena matches with free mock players: `node tests/arena.ts`.
// Exercises the full pipeline (observations, oracle tools, moves, commits, forfeits, logs, report) without any model cost.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/game.ts';
import type { Pad } from '../src/input.ts';
import { DEFAULTS } from '../src/settings.ts';
import type { Settings } from '../src/settings.ts';
import { THEMES } from '../src/themes.ts';
import { ArenaController } from '../src/arena/controller.ts';
import { ArenaHost } from '../arena-host/host.ts';
import { DirectLink } from '../arena-host/directLink.ts';

const idle: Pad = { isHeld: () => false, pressed: () => false, released: () => false, heldFor: () => 0 };
const root = fileURLToPath(new URL('../arena-logs/_test/', import.meta.url));
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function play(name: string, a: string, b: string, opts: { thinkSeconds: number; maxTurns: number; snakes: number; theme: keyof typeof THEMES; seed: number; costCap?: number; style?: 'player' | 'oracle' }): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  const settings: Settings = {
    ...DEFAULTS,
    mode: 'arena',
    snakesPerTeam: opts.snakes,
    maxTurns: opts.maxTurns,
    suddenDeath: 6,
    arena: {
      a: a === 'human' ? { provider: 'human', model: 'human', label: 'YOU' } : { provider: 'mock', model: a, label: a.toUpperCase() },
      b: { provider: 'mock', model: b, label: b.toUpperCase() },
      toolBudget: 4,
      thinkSeconds: opts.thinkSeconds,
      record: false,
      costCap: opts.costCap ?? 0,
      style: opts.style ?? 'oracle',
    },
  };
  const g = new Game(idle, settings, THEMES[opts.theme], opts.seed);
  const host = new ArenaHost({ root, mockDelayMs: 0 });
  const link = new DirectLink(host);
  const ctl = new ArenaController(g, link, settings.arena!, `${name}-${opts.seed}`);
  ctl.sliceMs = 200;
  const t0 = Date.now();
  await ctl.start();
  let ticks = 0;
  let maxSettle = 0;
  while (!ctl.ended && ticks < 60 * 60 * 40) {
    g.update();
    ctl.update();
    ticks++;
    if (g.phase === 'settle') maxSettle = Math.max(maxSettle, g.phaseT);
    if ((g.phase === 'play' || g.phase === 'intro') && g.phaseT > 60 * 200 && !g.holdClock) {
      notes.push(`STUCK in ${g.phase} at turn ${g.turnCount}`);
      break;
    }
    if (!['play', 'intro'].includes(g.phase) && g.phase !== 'over' && g.phaseT > 60 * 60) {
      notes.push(`STUCK in ${g.phase} at turn ${g.turnCount}`);
      break;
    }
    // While a (mock) model "thinks" in real time, let real time pass like the browser would.
    if (g.holdClock) await new Promise((r) => setTimeout(r, 4));
    else if (ticks % 2 === 0) await tick();
  }
  for (let i = 0; i < 500 && !ctl.savedDir; i++) await tick();
  if (g.phase !== 'over') {
    const a = g.active;
    notes.push(`  HUNG: phase=${g.phase} phaseT=${g.phaseT} turn=${g.turnCount} holdClock=${g.holdClock} turnT=${g.turnT} active=${a?.name}/${a?.state}/alive=${a?.alive} proj=${g.projectiles.map((p) => `${p.constructor.name}${p.controllable ? '*' : ''}@${Math.round(p.x)},${Math.round(p.y)}`).join(' ')} flames=${g.flameList.length} props=${g.props.filter((p) => !p.settled).map((p) => p.kind).join(',')} snakes=${g.snakes.map((s) => `${s.name}:${s.state}`).join(' ')}`);
    const brain = g.brainOf(a!.team) as unknown as { stage: string; plan: unknown } | undefined;
    notes.push(`  brain stage=${brain?.stage} plan=${JSON.stringify(brain?.plan)?.slice(0, 160)} menuOpen=${g.menuOpen} cursorMode=${g.cursorMode} charging=${g.charging}`);
  }
  await host.shutdown();
  const dir = link.dir;
  const log = existsSync(join(dir, 'match.jsonl')) ? readFileSync(join(dir, 'match.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  const count = (t: string, f?: (e: Record<string, unknown>) => boolean): number => log.filter((e) => e.type === t && (!f || f(e))).length;
  const tools = log.filter((e) => e.type === 'tool');
  const toolErrors = tools.filter((e) => (e.result as Record<string, unknown>)?.error).map((e) => `${e.name}: ${(e.result as Record<string, unknown>).error}`);
  const summary = log.find((e) => e.type === 'match_end') as Record<string, unknown> | undefined;
  const exact = ['bazooka', 'grenade', 'shotgun', 'homing', 'holyEgg', 'petrol', 'dynamite', 'piano', 'airStrike'];
  const preds = log.filter((e) => e.type === 'outcome' && exact.includes(String(e.weapon)) && typeof e.predictedEnemyDamage === 'number');
  const hits = preds.filter((e) => Math.abs(Number(e.predictedEnemyDamage) - Number(e.actualEnemyDamage)) <= 3);
  const accuracy = preds.length ? `${hits.length}/${preds.length} deterministic shots landed as predicted (+/-3 HP)` : 'no deterministic shots';
  const misses = preds.filter((e) => !hits.includes(e)).map((e) => `${e.weapon}: predicted ${e.predictedEnemyDamage} actual ${e.actualEnemyDamage}`);
  notes.push(
    `${name}: ${summary?.winner ?? 'NO WINNER'} (${summary?.reason}) in ${g.turnCount} turns, ${ticks} ticks, ${((Date.now() - t0) / 1000).toFixed(1)}s real`,
    `  log entries ${log.length}: turn_start=${count('turn_start')} tool=${tools.length} commit=${count('commit')} forfeit=${count('forfeit')} outcome=${count('outcome')} activity=${count('activity')}`,
    `  tools used: ${[...new Set(tools.map((e) => e.name))].join(', ')}   tool errors: ${toolErrors.length}${toolErrors.length ? ` (${[...new Set(toolErrors)].slice(0, 3).join(' | ')})` : ''}`,
    `  weapons committed: ${log.filter((e) => e.type === 'commit').map((e) => (e.plan as Record<string, unknown>)?.weapon).join(', ')}`,
    `  max settle ticks ${maxSettle}; report.md ${existsSync(join(dir, 'report.md')) ? 'written' : 'MISSING'}; summary.json ${existsSync(join(dir, 'summary.json')) ? 'written' : 'MISSING'}`,
    `  oracle accuracy: ${accuracy}${misses.length ? `  misses: ${misses.slice(0, 4).join(' | ')}` : ''}`,
  );
  let ok = !!summary && existsSync(join(dir, 'report.md')) && g.phase === 'over' && !notes.some((n) => n.startsWith('STUCK'));
  if (a !== 'mock-stall' && b !== 'mock-stall' && a !== 'human' && count('commit') + count('turn_lost') < Math.min(g.turnCount, 4)) {
    ok = false;
    notes.push('  FAIL: too few commits');
  }
  if ((a === 'mock-stall' || b === 'mock-stall') && count('forfeit') === 0) {
    ok = false;
    notes.push('  FAIL: staller never forfeited');
  }
  if (opts.costCap) {
    const capped = count('budget_cap') === 1 && String(summary?.reason ?? '').startsWith('BUDGET CAP') && g.turnCount <= opts.costCap / 0.5 + 1;
    notes.push(`  budget cap ${opts.costCap}: ${capped ? 'enforced' : 'NOT ENFORCED'} (ended after ${g.turnCount} turns, reason "${summary?.reason}")`);
    if (!capped) ok = false;
  }
  if (opts.style === 'player') {
    const names = new Set(tools.map((e) => e.name));
    const sysPrompt = String(((log.find((e) => e.type === 'match_start') as Record<string, unknown>)?.systemPrompts as string[])?.[0] ?? '');
    const fine = names.has('aim_guide') && !names.has('find_shots') && !names.has('simulate') && sysPrompt.includes('GAME PHYSICS') && log.some((e) => e.type === 'outcome' && String(e.landed).includes('start-of-turn position'));
    notes.push(`  real-player mode: ${fine ? 'aim_guide used, no solver tools, physics rules + landing feedback present' : 'NOT CORRECT'}`);
    if (!fine) ok = false;
  }
  if (a === 'human') {
    const sys = String(((log.find((e) => e.type === 'match_start') as Record<string, unknown>)?.systemPrompts as string[])?.[1] ?? '');
    const humanTurns = count('turn_start', (e) => e.human === true);
    const told = log.some((e) => e.type === 'turn_start' && !e.human && String(e.prompt).includes('OPPONENT (YOU)'));
    const fine = sys.includes('HUMAN player') && humanTurns > 0 && told && g.phase === 'over';
    notes.push(`  human vs model: ${fine ? `ok (${humanTurns} human turns, model told it faces a human and what the human did)` : 'NOT CORRECT'}`);
    if (!fine) ok = false;
  }
  const leaked = log.filter((e) => e.type === 'tool' && e.name === 'taunt' && /[<>]/.test(String((e.result as Record<string, unknown>)?.shown ?? '')));
  if (leaked.length) {
    ok = false;
    notes.push('  FAIL: markup leaked into a taunt');
  }
  return { ok, notes };
}

rmSync(root, { recursive: true, force: true });
const runs = [
  await play('duel', 'mock-sharpshooter', 'mock-chaos', { thinkSeconds: 30, maxTurns: 20, snakes: 2, theme: 'island', seed: 777 }),
  await play('medieval', 'mock-chaos', 'mock-sharpshooter', { thinkSeconds: 30, maxTurns: 16, snakes: 3, theme: 'medieval', seed: 4242 }),
  await play('timeouts', 'mock-stall', 'mock-sharpshooter', { thinkSeconds: 1, maxTurns: 6, snakes: 2, theme: 'acc', seed: 99 }),
  await play('budget', 'mock-sharpshooter', 'mock-chaos', { thinkSeconds: 30, maxTurns: 30, snakes: 2, theme: 'island', seed: 31337, costCap: 2 }),
  await play('player', 'mock-sharpshooter', 'mock-chaos', { thinkSeconds: 30, maxTurns: 10, snakes: 2, theme: 'medieval', seed: 2026, style: 'player' }),
  await play('human', 'human', 'mock-sharpshooter', { thinkSeconds: 30, maxTurns: 6, snakes: 3, theme: 'acc', seed: 4040, style: 'player' }),
];
let failed = 0;
for (const r of runs) {
  for (const n of r.notes) console.log(n);
  if (!r.ok) failed++;
}
const keep = process.argv.includes('--keep');
if (!keep) rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} ARENA RUN(S) FAILED` : '\nALL ARENA RUNS COMPLETED');
if (failed) process.exitCode = 1;
