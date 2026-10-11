// Headless CPU-vs-CPU matches: `npm test` (optionally: node tests/sim.ts <count>).
// Real AI on both sides, every skin and brain. Fails on stalls, NaNs, broken phases, or endless matches.
import { Game } from '../src/game.ts';
import type { Pad } from '../src/input.ts';
import { DEFAULTS } from '../src/settings.ts';
import type { Brain, Settings } from '../src/settings.ts';
import { THEMES, THEME_ORDER } from '../src/themes.ts';
import { WEAPON_BY_ID } from '../src/weapons.ts';
import type { WeaponId } from '../src/weapons.ts';

const idle: Pad = { isHeld: () => false, pressed: () => false, released: () => false, heldFor: () => 0 };

function fail(msg: string): never {
  throw new Error(msg);
}

interface Result {
  winner: string;
  turns: number;
  seconds: number;
  used: Map<string, number>;
  deaths: number;
  drowned: number;
  suddenDeath: boolean;
  crates: number;
  thinkMs: number;
}

function runMatch(seed: number, settings: Settings, themeId: keyof typeof THEMES): Result {
  const g = new Game(idle, settings, THEMES[themeId], seed);
  const used = new Map<string, number>();
  let ticks = 0;
  let lastTurn = -1;
  let attackedThisTurn = false;
  let idleTurns = 0;
  let crates = 0;
  const origCollect = g.collect.bind(g);
  g.collect = (p, s) => {
    crates++;
    origCollect(p, s);
  };
  const origFireCharged = g.fireCharged.bind(g);
  g.fireCharged = (power) => {
    used.set(g.weapon, (used.get(g.weapon) ?? 0) + 1);
    origFireCharged(power);
  };
  const origUse = g.useWeapon.bind(g);
  g.useWeapon = () => {
    const id = g.weapon;
    const ok = origUse();
    if (ok) used.set(id, (used.get(id) ?? 0) + 1);
    return ok;
  };
  let thinkMs = 0;
  while (g.phase !== 'over' && ticks < 60 * 60 * 30) {
    if (g.turnCount !== lastTurn) {
      if (lastTurn > 0 && !attackedThisTurn) idleTurns++;
      lastTurn = g.turnCount;
      attackedThisTurn = false;
    }
    const t0 = performance.now();
    g.update();
    thinkMs = Math.max(thinkMs, performance.now() - t0);
    if (g.attacked || g.phase === 'retreat' || g.phase === 'guide') attackedThisTurn = true;
    ticks++;
    for (const s of g.snakes) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) fail(`${s.name} non-finite position`);
      if (s.hp < 0) fail(`${s.name} hp < 0`);
    }
    for (const p of g.projectiles) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('projectile non-finite');
    if (g.phase === 'settle' && g.phaseT > 1300) fail(`settle stuck 21s at turn ${g.turnCount}`);
    if ((g.phase === 'play' || g.phase === 'intro') && g.phaseT > 60 * 100) fail(`turn ${g.turnCount} never ended`);
    if (g.turnCount > 150) fail('match exceeded 150 turns');
  }
  if (g.phase !== 'over') fail('match did not finish in 30 game-minutes');
  if (idleTurns > g.turnCount * 0.5) fail(`CPU sat idle on ${idleTurns}/${g.turnCount} turns`);
  return {
    winner: g.winner ? g.winner.def.name : 'DRAW',
    turns: g.turnCount,
    seconds: ticks / 60,
    used,
    deaths: g.snakes.filter((s) => s.state === 'dead').length,
    drowned: g.snakes.filter((s) => s.drownT > 0).length,
    suddenDeath: g.suddenDeath,
    crates,
    thinkMs,
  };
}

const count = Number(process.argv[2] ?? 9);
const brains: Brain[] = ['easy', 'normal', 'hard', 'troll'];
const allUsed = new Map<string, number>();
let failures = 0;
const t0 = performance.now();
for (let i = 0; i < count; i++) {
  const themeId = THEME_ORDER[i % THEME_ORDER.length]!;
  const brain = brains[i % brains.length]!;
  const settings: Settings = { ...DEFAULTS, mode: 'watch', brain, snakesPerTeam: 2 + (i % 3), suddenDeath: 8 };
  const seed = 1000 + i * 7919;
  try {
    const r = runMatch(seed, settings, themeId);
    for (const [k, v] of r.used) allUsed.set(k, (allUsed.get(k) ?? 0) + v);
    const weapons = [...r.used.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(' ');
    console.log(`#${i} ${themeId.padEnd(8)} ${brain.padEnd(6)} ${settings.snakesPerTeam}v${settings.snakesPerTeam}: ${r.winner} in ${r.turns} turns (${Math.round(r.seconds)}s) deaths=${r.deaths} drowned=${r.drowned} crates=${r.crates}${r.suddenDeath ? ' SUDDEN-DEATH' : ''} worstTick=${r.thinkMs.toFixed(0)}ms\n     ${weapons}`);
  } catch (e) {
    failures++;
    console.log(`#${i} ${themeId} ${brain} seed=${seed}: FAIL ${(e as Error).message}`);
  }
}
const never = (Object.keys(WEAPON_BY_ID) as WeaponId[]).filter((id) => !allUsed.has(id));
console.log(`\nweapons the CPU used: ${allUsed.size}/${Object.keys(WEAPON_BY_ID).length}   never: ${never.join(', ') || 'none'}`);
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures ? `${failures} FAILED` : 'ALL MATCHES COMPLETED');
if (failures) process.exitCode = 1;
