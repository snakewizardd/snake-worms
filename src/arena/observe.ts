import { PHYS, WORLD_H, WORLD_W } from '../config.ts';
import { env } from '../env.ts';
import type { Game } from '../game.ts';
import type { Snake, Team } from '../snake.ts';
import { WEAPON_BY_ID, weaponName } from '../weapons.ts';
import { ARENA_WEAPONS } from './schema.ts';

const COLS = 96;
const ROWS = 30;

/** Upward-open check: true when nothing solid is directly above (exposed to air strikes, piano, sheep rain). */
function skyExposed(g: Game, s: Snake): boolean {
  for (let dx = -4; dx <= 4; dx += 4) for (let y = 0; y < s.y - 10; y += 3) if (g.terrain.solid(s.x + dx, y)) return false;
  return true;
}

/** Distance (px) to the nearest drop into the sea on each side along the ground, if within 200px. */
function edgeRisk(g: Game, s: Snake): string {
  const out: string[] = [];
  for (const dir of [-1, 1]) {
    for (let d = 8; d <= 200; d += 4) {
      const x = s.x + dir * d;
      if (x < 0 || x > WORLD_W) {
        out.push(`${dir < 0 ? 'left' : 'right'} map edge ${d}px`);
        break;
      }
      const top = g.terrain.surfaceY(Math.round(x), Math.round(s.y - 30));
      if (top < 0 || top > env.waterY - 4) {
        out.push(`${dir < 0 ? 'left' : 'right'}: open drop to the sea ~${d}px away`);
        break;
      }
    }
  }
  return out.join('; ') || 'no drop to the sea within 200px';
}

export function snakeInfo(g: Game, s: Snake, from: Snake | null): Record<string, unknown> {
  const o: Record<string, unknown> = {
    name: s.name,
    x: Math.round(s.x),
    y: Math.round(s.y),
    hp: s.hp,
    state: s.state,
  };
  if (s.poisoned) o.poisoned = true;
  if (from && from !== s) {
    o.dx = Math.round(s.x - from.x);
    o.dy = Math.round(s.y - from.y);
    o.distance = Math.round(Math.hypot(s.x - from.x, s.y - from.y));
  }
  o.exposed_to_sky = skyExposed(g, s);
  o.edges = edgeRisk(g, s);
  o.height_above_sea = Math.round(env.waterY - s.y);
  return o;
}

export function asciiMap(g: Game, team: Team, active: Snake): { map: string; legend: string } {
  const cw = WORLD_W / COLS;
  const rh = WORLD_H / ROWS;
  const grid: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: string[] = [];
    for (let c = 0; c < COLS; c++) {
      const x = (c + 0.5) * cw;
      const y = (r + 0.5) * rh;
      let solid = 0;
      for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]] as Array<[number, number]>) if (g.terrain.solid(x + ox * cw, y + oy * rh)) solid++;
      row.push(solid >= 3 ? '#' : y >= env.waterY ? '~' : solid > 0 ? '.' : ' ');
    }
    grid.push(row);
  }
  const legend: string[] = [];
  const place = (x: number, y: number, ch: string): void => {
    const c = Math.max(0, Math.min(COLS - 1, Math.floor(x / cw)));
    const r = Math.max(0, Math.min(ROWS - 1, Math.floor(y / rh)));
    grid[r]![c] = ch;
  };
  for (const p of g.props) {
    if (!p.alive || p.sinking) continue;
    if (p.kind === 'mine') place(p.x, p.y, '*');
    else if (p.kind === 'barrel') place(p.x, p.y, 'o');
    else if (p.kind === 'crate') place(p.x, p.y, '+');
  }
  let mine = 0;
  let theirs = 0;
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const yours = s.team === team;
    const ch = s === active ? '@' : yours ? String.fromCharCode(65 + mine++) : String.fromCharCode(97 + theirs++);
    place(s.x, s.y, ch);
    legend.push(`${ch}=${s.name}${yours ? ' (yours)' : ' (enemy)'}`);
  }
  const header = `x: 0${' '.repeat(COLS / 2 - 6)}960${' '.repeat(COLS / 2 - 8)}1920`;
  const map = [header, ...grid.map((r, i) => `${r.join('')}| y=${Math.round(i * rh)}`)].join('\n');
  return { map, legend: `Each char = ${Math.round(cw)}x${Math.round(rh)} px. '#' land, '.' partial land, '~' sea, '*' mine, 'o' barrel, '+' crate, '@' = YOUR ACTIVE SNAKE. ${legend.join(', ')}` };
}

export interface Budgets {
  oracleLeft: number;
  movesLeft: number;
  tauntsLeft: number;
  secondsLeft: number;
  style?: 'player' | 'oracle';
}

export function observation(g: Game, team: Team, active: Snake, b: Budgets): Record<string, unknown> {
  const enemies = g.snakes.filter((s) => s.alive && s.team !== team);
  const friends = g.snakes.filter((s) => s.alive && s.team === team && s !== active);
  const weapons = ARENA_WEAPONS.filter((id) => g.isAvailable(id, team)).map((id) => {
    const ammo = team.ammo.get(id) ?? 0;
    return { id, name: weaponName(id, g.theme), ammo: ammo < 0 ? 'unlimited' : ammo, use: WEAPON_BY_ID[id].usage, about: WEAPON_BY_ID[id].desc.toLowerCase() };
  });
  const locked = ARENA_WEAPONS.filter((id) => !g.isAvailable(id, team) && (team.ammo.get(id) ?? 0) !== 0).map((id) => `${id} (unlocks round ${WEAPON_BY_ID[id].delay + 1})`);
  const hazards = g.props
    .filter((p) => p.alive && !p.sinking && p.kind !== 'grave')
    .map((p) => ({ kind: p.kind === 'crate' ? `${p.crate} crate` : p.kind, x: Math.round(p.x), y: Math.round(p.y), distance: Math.round(Math.hypot(p.x - active.x, p.y - active.y)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12);
  const totals = g.teams.map((t) => ({ team: t.def.name, yours: t === team, alive: t.snakes.filter((s) => s.alive).length, total_hp: t.snakes.reduce((a, s) => a + (s.alive ? s.hp : 0), 0) }));
  return {
    turn: g.turnCount,
    round: g.round,
    max_turns: g.settings.maxTurns ?? 0,
    sudden_death: g.suddenDeath,
    you: team.def.name,
    active_snake: { ...snakeInfo(g, active, null), facing: active.facing > 0 ? 'right' : 'left' },
    your_other_snakes: friends.map((s) => snakeInfo(g, s, active)),
    enemy_snakes: enemies.map((s) => snakeInfo(g, s, active)),
    score: totals,
    wind: { value: g.wind, meaning: g.wind === 0 ? 'calm' : `pushes ${g.wind > 0 ? 'RIGHT' : 'LEFT'} with strength ${Math.abs(g.wind).toFixed(2)} of 1` },
    water_y: Math.round(env.waterY),
    world: { width: WORLD_W, height: WORLD_H, snake_radius: PHYS.snakeRadius },
    weapons,
    locked_weapons: locked,
    hazards,
    budget: { [b.style === 'player' ? 'aim_checks_left' : 'oracle_calls_left']: b.oracleLeft, moves_left: b.movesLeft, taunts_left: b.tauntsLeft, seconds_left: Math.max(0, Math.round(b.secondsLeft)) },
  };
}
