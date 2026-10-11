import { PHYS, WORLD_W } from './config.ts';
import { env } from './env.ts';
import type { Game } from './game.ts';
import type { Snake, Team, World } from './snake.ts';
import { Snake as SnakeClass } from './snake.ts';
import { Rocket, Sheep, Thrown } from './projectiles.ts';
import type { Projectile, ProjWorld } from './projectiles.ts';
import type { Brain } from './settings.ts';
import { WEAPON_BY_ID } from './weapons.ts';
import type { WeaponId } from './weapons.ts';
import { sfx } from './audio.ts';
import { Particles } from './particles.ts';
import { line } from './banter.ts';
import { clamp, rng } from './util.ts';

interface Blast {
  x: number;
  y: number;
  r: number;
  dmg: number;
  knock: number;
}

/** Throwaway particle sink so simulated shots never draw anything. */
const SIM_PARTICLES = new Particles();

class SimWorld implements ProjWorld {
  readonly sim = true;
  readonly control = { steer: 0, fire: false };
  blasts: Blast[] = [];
  flameSpots: Array<{ x: number; y: number; n: number }> = [];
  poisons: Array<{ x: number; y: number; r: number }> = [];
  spawned: Projectile[] = [];
  readonly terrain;
  readonly particles;
  readonly snakes;
  readonly theme;
  wind: number;

  constructor(g: Game, wind: number) {
    this.terrain = g.terrain;
    this.particles = SIM_PARTICLES;
    this.snakes = g.snakes;
    this.theme = g.theme;
    this.wind = wind;
  }
  explode(x: number, y: number, r: number, dmg: number, knock: number): void {
    this.blasts.push({ x, y, r, dmg, knock });
  }
  spawn(p: Projectile): void {
    this.spawned.push(p);
  }
  flames(x: number, y: number, n: number): void {
    this.flameSpots.push({ x, y, n });
  }
  poison(x: number, y: number, r: number): void {
    this.poisons.push({ x, y, r });
  }
}

interface Plan {
  weapon: WeaponId;
  facing: 1 | -1;
  aim: number;
  power: number;
  fuse: number;
  tx: number;
  ty: number;
  score: number;
  impactX: number;
  impactY: number;
  walk?: number;
  girderAngle?: number;
  say?: string;
}

const NOISE: Record<Brain, { aim: number; power: number }> = {
  easy: { aim: 0.11, power: 0.11 },
  normal: { aim: 0.035, power: 0.045 },
  hard: { aim: 0.006, power: 0.008 },
  troll: { aim: 0.045, power: 0.05 },
};
const FUNNY: WeaponId[] = ['sheep', 'sheepRain', 'piano', 'holyEgg', 'melon', 'skySheep', 'tailWhip', 'petrol'];

function gauss(): number {
  return (rng.next() + rng.next() + rng.next() - 1.5) / 1.5;
}

export class CpuBrain {
  private readonly g: Game;
  private readonly team: Team;
  readonly level: Brain;
  private s: Snake | null = null;
  private stage: 'wait' | 'think' | 'walk' | 'menu' | 'face' | 'aim' | 'fuse' | 'cursor' | 'charge' | 'fire' | 'done' = 'done';
  private t = 0;
  private thinker: Generator<void, Plan | null> | null = null;
  private plan: Plan | null = null;
  private rethinks = 0;
  private lastX = 0;
  private stuck = 0;
  private skyLaunched = false;
  private retreatDir = 0;

  constructor(g: Game, team: Team, level: Brain) {
    this.g = g;
    this.team = team;
    this.level = level;
  }

  beginTurn(s: Snake): void {
    this.s = s;
    this.stage = 'wait';
    this.t = 0;
    this.plan = null;
    this.thinker = null;
    this.rethinks = 0;
    this.skyLaunched = false;
    this.retreatDir = 0;
    if (this.level === 'troll') this.g.bubble(s, line('turn', this.g.theme, true));
    else if (rng.chance(0.45)) this.g.bubble(s, line('cpuThink', this.g.theme), 100);
  }

  update(): void {
    const g = this.g;
    const s = this.s;
    const pad = g.cpuPad;
    if (!s || !s.alive || s !== g.active) return;
    this.t++;
    if (g.phase === 'guide') {
      this.guide();
      return;
    }
    if (g.phase === 'retreat') {
      this.retreat();
      return;
    }
    switch (this.stage) {
      case 'wait':
        if (this.t > 20 && g.phase === 'play') {
          this.stage = 'think';
          this.thinker = this.think();
          this.t = 0;
        }
        break;
      case 'think': {
        const r = this.thinker!.next();
        if (r.done) {
          this.plan = r.value;
          this.t = 0;
          if (!this.plan) this.plan = this.fallback();
          if (this.plan.say) g.bubble(s, this.plan.say);
          this.stage = this.plan.walk ? 'walk' : 'menu';
          this.lastX = s.x;
          this.stuck = 0;
        }
        break;
      }
      case 'walk': {
        const dir = this.plan!.walk! > 0 ? 'right' : 'left';
        pad.hold(dir, true);
        if (Math.abs(s.x - this.lastX) < 0.1) this.stuck++;
        else this.stuck = 0;
        this.lastX = s.x;
        if (this.stuck > 12 && s.state === 'ground') {
          pad.tap(this.stuck > 40 ? 'backflip' : 'jump');
          this.stuck = this.stuck > 40 ? 0 : this.stuck;
        }
        if (this.t > Math.abs(this.plan!.walk!) || g.turnT < 60 * 12) {
          pad.hold(dir, false);
          if (s.state === 'ground' && s.crouchT === 0) {
            this.stage = 'think';
            this.rethinks++;
            this.thinker = this.think();
            this.t = 0;
          }
        }
        break;
      }
      case 'menu':
        if (g.weapon === this.plan!.weapon) {
          this.stage = 'face';
          this.t = 0;
          break;
        }
        if (this.t === 1) g.openMenu();
        if (this.t > 22) {
          g.selectWeapon(this.plan!.weapon);
          g.menuOpen = false;
          this.stage = 'face';
          this.t = 0;
        }
        break;
      case 'face':
        if (s.facing !== this.plan!.facing && s.state === 'ground') {
          pad.hold(this.plan!.facing > 0 ? 'right' : 'left', this.t % 2 === 1);
          break;
        }
        pad.releaseAll();
        if (this.plan!.weapon === 'girder') g.girderAngle = this.plan!.girderAngle ?? 0;
        this.stage = 'aim';
        this.t = 0;
        break;
      case 'aim': {
        const want = this.plan!.aim;
        const d = want - s.aim;
        const usesAim = !['sheepRain', 'airStrike', 'piano', 'teleport', 'girder', 'doomsday', 'skip', 'surrender', 'dynamite', 'mine', 'sheep', 'skySheep', 'tailWhip'].includes(this.plan!.weapon);
        if (usesAim && Math.abs(d) > 0.03 && this.t < 120) {
          pad.hold('up', d < 0);
          pad.hold('down', d > 0);
          break;
        }
        pad.releaseAll();
        if (usesAim) s.aim = want;
        this.stage = 'fuse';
        this.t = 0;
        break;
      }
      case 'fuse':
        if (WEAPON_BY_ID[this.plan!.weapon].fuse) pad.tap(`fuse${this.plan!.fuse}` as 'fuse1');
        this.stage = g.targeting ? 'cursor' : this.isCharge() ? 'charge' : 'fire';
        this.t = 0;
        break;
      case 'cursor':
        if (this.t === 2) {
          g.tx = s.x;
          g.ty = s.y - 30;
          pad.tap('fire');
        }
        if (this.t > 2 && g.cursorMode) {
          g.tx += (this.plan!.tx - g.tx) * 0.12;
          g.ty += (this.plan!.ty - g.ty) * 0.12;
          g.cam.manual = true;
          if (this.t > 45) {
            g.tx = this.plan!.tx;
            g.ty = this.plan!.ty;
            pad.tap('fire');
            this.stage = this.isCharge() ? 'charge' : 'done';
            this.t = 0;
          }
        }
        if (this.t > 120) this.stage = 'done';
        break;
      case 'charge':
        if (this.t < 4) break;
        if (!g.charging) pad.hold('fire', true);
        else if (g.power >= this.plan!.power - 0.008) {
          pad.hold('fire', false);
          this.stage = 'done';
        }
        if (this.t > 150) {
          pad.hold('fire', false);
          this.stage = 'done';
        }
        break;
      case 'fire':
        if (this.t === 6) {
          pad.tap('fire');
          if (this.plan!.weapon === 'shotgun') this.t = -40;
        }
        if (this.t === 0 && this.plan!.weapon === 'shotgun' && g.phase === 'play') {
          pad.tap('fire');
          this.stage = 'done';
        }
        if (this.t > 10 && this.plan!.weapon !== 'shotgun') this.stage = 'done';
        break;
      case 'done':
        if (g.phase === 'play' && this.t > 240 && g.turnT > 120) {
          this.stage = 'think';
          this.thinker = this.think();
          this.t = 0;
        }
        break;
    }
  }

  private isCharge(): boolean {
    const u = WEAPON_BY_ID[this.plan!.weapon].usage;
    return u === 'charge' || u === 'targetCharge';
  }

  private guide(): void {
    const g = this.g;
    const pad = g.cpuPad;
    const sh = g.projectiles.find((p) => p instanceof Sheep && p.controllable) as Sheep | undefined;
    if (!sh) return;
    const enemies = g.snakes.filter((o) => o.alive && o.team !== this.team);
    let best: Snake | null = null;
    let bd = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - sh.x, e.y - sh.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return;
    if (sh.sky && !this.skyLaunched && sh.age > 30) {
      pad.tap('fire');
      this.skyLaunched = true;
      return;
    }
    if (sh.mode === 'fly') {
      const want = Math.atan2(best.y - 4 - sh.y, best.x - sh.x);
      let d = want - sh.flyAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      pad.hold('left', d < -0.05);
      pad.hold('right', d > 0.05);
      if (bd < 12) pad.tap('fire');
      return;
    }
    const close = bd < 16 || (Math.abs(best.x - sh.x) < 8 && Math.abs(best.y - sh.y) < 22);
    if (close || (sh.age > 300 && bd < 40)) pad.tap('fire');
  }

  private retreat(): void {
    const g = this.g;
    const s = this.s!;
    const pad = g.cpuPad;
    const p = this.plan;
    if (!p) return;
    if (this.retreatDir === 0) {
      const dist = Math.hypot(p.impactX - s.x, p.impactY - s.y);
      const danger = p.weapon === 'dynamite' || p.weapon === 'mine' || dist < 70;
      this.retreatDir = danger ? (p.weapon === 'dynamite' || p.weapon === 'mine' ? -s.facing : s.x >= p.impactX ? 1 : -1) : 2;
      this.t = 0;
      this.lastX = s.x;
    }
    if (this.retreatDir === 2) return;
    const dir = this.retreatDir > 0 ? 'right' : 'left';
    pad.hold(dir, this.t < 200);
    if (Math.abs(s.x - this.lastX) < 0.1 && s.state === 'ground') {
      this.stuck++;
      if (this.stuck > 10) {
        pad.tap('jump');
        this.stuck = 0;
      }
    } else this.stuck = 0;
    this.lastX = s.x;
    if (s.state === 'ground' && s.x + this.retreatDir * 30 > 0 && s.x + this.retreatDir * 30 < WORLD_W) {
      const ahead = g.terrain.surfaceY(Math.round(s.x + this.retreatDir * 14), Math.round(s.y - 20));
      if (ahead < 0 || ahead > env.waterY - 20 || ahead - s.y > 60) pad.hold(dir, false);
    }
  }

  private fallback(): Plan {
    const s = this.s!;
    const e = this.g.snakes.filter((o) => o.alive && o.team !== this.team).sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
    const facing: 1 | -1 = e && e.x < s.x ? -1 : 1;
    return { weapon: 'bazooka', facing, aim: -0.6, power: 0.7, fuse: 3, tx: 0, ty: 0, score: 0, impactX: s.x + facing * 200, impactY: s.y };
  }

  // ------------------------------------------------------------------ planning

  private simulate(p: Projectile, wind: number, maxTicks: number): SimWorld {
    const w = new SimWorld(this.g, wind);
    let list: Projectile[] = [p];
    for (let t = 0; t < maxTicks && list.length; t++) {
      for (const q of list) q.update(w);
      list = list.filter((q) => q.alive).concat(w.spawned);
      w.spawned = [];
    }
    return w;
  }

  /** Whether a knock would put this snake in the sea (runs the real snake physics silently). */
  private drowns(target: Snake, ix: number, iy: number): boolean {
    const clone = new SnakeClass(target.team, target.name, target.x, target.y, target.hp);
    let drowned = false;
    const w: World = {
      terrain: this.g.terrain,
      particles: SIM_PARTICLES,
      onLand: () => {},
      onDrown: () => {
        drowned = true;
      },
    };
    clone.knock(ix, iy);
    for (let i = 0; i < 260 && clone.state === 'air'; i++) clone.update(w);
    return drowned || clone.state === 'drown';
  }

  private score(w: SimWorld, self: Snake): { score: number; x: number; y: number } {
    const dmg = new Map<Snake, number>();
    const kx = new Map<Snake, [number, number]>();
    for (const b of w.blasts) {
      const reach = b.r + PHYS.snakeRadius * 1.5;
      for (const s of this.g.snakes) {
        if (!s.alive) continue;
        const dx = s.x - b.x;
        const dy = s.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= reach) continue;
        const f = 1 - d / reach;
        dmg.set(s, (dmg.get(s) ?? 0) + Math.max(1, Math.round(b.dmg * f)));
        let nx = d > 0.5 ? dx / d : 0;
        let ny = (d > 0.5 ? dy / d : -1) - 0.7;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        const sp = b.knock * (0.35 + 0.65 * f);
        const prev = kx.get(s) ?? [0, 0];
        kx.set(s, [prev[0] + nx * sp, prev[1] + ny * sp]);
      }
    }
    for (const f of w.flameSpots) for (const s of this.g.snakes) if (s.alive && Math.hypot(s.x - f.x, s.y - f.y) < 45) dmg.set(s, (dmg.get(s) ?? 0) + 14);
    for (const p of w.poisons) for (const s of this.g.snakes) if (s.alive && !s.poisoned && Math.hypot(s.x - p.x, s.y - p.y) < p.r) dmg.set(s, (dmg.get(s) ?? 0) + 18);
    let score = 0;
    for (const [s, d] of dmg) {
      const hp = s.hp - s.pendingDmg;
      const enemy = s.team !== this.team;
      const k = kx.get(s);
      const sea = k ? this.drowns(s, k[0], k[1]) : false;
      const lethal = d >= hp || sea;
      const real = sea ? hp : Math.min(d, hp);
      if (enemy) score += real + (lethal ? 45 : 0);
      else score -= (real + (lethal ? 80 : 0)) * (s === self ? 2.2 : 1.6);
    }
    const last = w.blasts[w.blasts.length - 1];
    return { score, x: last?.x ?? self.x, y: last?.y ?? self.y };
  }

  private allowed(): WeaponId[] {
    const lvl = this.level;
    const base: WeaponId[] = ['bazooka', 'grenade', 'shotgun', 'tailWhip'];
    if (lvl !== 'easy') base.push('cluster', 'venom', 'petrol', 'homing', 'sheep', 'dynamite', 'airStrike');
    if (lvl === 'hard' || lvl === 'troll') base.push('melon', 'holyEgg', 'sheepRain', 'piano', 'skySheep', 'doomsday');
    return base.filter((id) => this.g.isAvailable(id, this.team));
  }

  private *think(): Generator<void, Plan | null> {
    const g = this.g;
    const s = this.s!;
    const started = g.tick;
    const enemies = g.snakes.filter((o) => o.alive && o.hp > 0 && o.team !== this.team);
    if (!enemies.length) return null;
    const wind = this.level === 'easy' ? g.wind * 0.3 : g.wind;
    const weapons = this.allowed();
    const cands: Plan[] = [];
    const fine = this.level === 'hard';
    let budget = performance.now();
    const breathe = function* (): Generator<void, void> {
      if (performance.now() - budget > 4) {
        sfx.silent = false;
        yield;
        budget = performance.now();
      }
    };

    const ballistic = weapons.filter((w) => ['bazooka', 'grenade', 'cluster', 'venom', 'petrol', 'melon', 'holyEgg'].includes(w));
    for (const id of ballistic) {
      const def = WEAPON_BY_ID[id];
      const aimStep = fine ? 0.045 : id === 'bazooka' || id === 'venom' ? 0.06 : 0.08;
      const powStep = fine ? 0.04 : 0.06;
      for (const facing of [1, -1] as const) {
        for (let aim = -1.5; aim <= 0.7; aim += aimStep) {
          for (let power = 0.18; power <= 1.0001; power += powStep) {
            const dx = Math.cos(aim) * facing;
            const dy = Math.sin(aim);
            const mx = s.x + dx * 11;
            const my = s.y - 7 + dy * 11;
            if (g.terrain.solid(mx, my)) continue;
            const v = power * (def.maxSpeed ?? 10);
            const fuse = id === 'holyEgg' ? 3 : 3;
            let p: Projectile;
            if (id === 'bazooka' || id === 'venom') p = new Rocket(mx, my, dx * v, dy * v, s, id === 'bazooka' ? 'rocket' : 'venom');
            else p = new Thrown(mx, my, dx * v, dy * v, s, id === 'cluster' ? 'cluster' : id === 'melon' ? 'melon' : id === 'holyEgg' ? 'holyEgg' : id === 'petrol' ? 'petrol' : 'grenade', fuse);
            sfx.silent = true;
            const w = this.simulate(p, wind, 420);
            const sc = this.score(w, s);
            sfx.silent = false;
            if (sc.score > 0) cands.push({ weapon: id, facing, aim, power, fuse, tx: 0, ty: 0, score: sc.score, impactX: sc.x, impactY: sc.y });
            yield* breathe();
          }
        }
      }
    }

    for (const e of enemies) {
      const exposed = this.exposed(e);
      if (weapons.includes('shotgun')) {
        const facing: 1 | -1 = e.x >= s.x ? 1 : -1;
        const ax = Math.abs(e.x - s.x);
        const aim = Math.atan2(e.y - 3 - (s.y - 7), ax);
        if (Math.abs(aim) < Math.PI / 2 - 0.05 && this.lineClear(s, e, aim, facing)) {
          const w = new SimWorld(g, 0);
          w.blasts.push({ x: e.x, y: e.y - 3, r: 13, dmg: 25, knock: 3.5 }, { x: e.x, y: e.y - 3, r: 13, dmg: 25, knock: 3.5 });
          sfx.silent = true;
          const sc = this.score(w, s);
          sfx.silent = false;
          cands.push({ weapon: 'shotgun', facing, aim, power: 0, fuse: 3, tx: 0, ty: 0, score: sc.score * 0.9, impactX: e.x, impactY: e.y });
        }
      }
      if (weapons.includes('tailWhip')) {
        const dx = e.x - s.x;
        if (Math.abs(dx) < 20 && Math.abs(e.y - s.y) < 13) {
          const facing: 1 | -1 = dx >= 0 ? 1 : -1;
          sfx.silent = true;
          const sea = this.drowns(e, facing * 6.5, -4.5);
          sfx.silent = false;
          const hp = e.hp - e.pendingDmg;
          cands.push({ weapon: 'tailWhip', facing, aim: 0, power: 0, fuse: 3, tx: 0, ty: 0, score: (sea ? hp + 45 : Math.min(25, hp) + (25 >= hp ? 45 : 0)) * 1.1, impactX: e.x, impactY: e.y });
        }
      }
      if (weapons.includes('dynamite') && Math.abs(e.x - s.x) < 34 && Math.abs(e.y - s.y) < 20) {
        cands.push({ weapon: 'dynamite', facing: e.x >= s.x ? 1 : -1, aim: 0, power: 0, fuse: 3, tx: 0, ty: 0, score: 55, impactX: s.x, impactY: s.y });
      }
      for (const id of ['airStrike', 'sheepRain', 'piano'] as WeaponId[]) {
        if (!weapons.includes(id) || !exposed) continue;
        const base = id === 'piano' ? 55 : id === 'airStrike' ? 45 : 40;
        const near = g.snakes.filter((o) => o.alive && o.team === this.team && Math.abs(o.x - e.x) < 80).length;
        cands.push({ weapon: id, facing: s.facing, aim: 0, power: 0, fuse: 3, tx: e.x, ty: e.y - 10, score: base - near * 60, impactX: e.x, impactY: e.y });
      }
      if (weapons.includes('homing')) {
        sfx.silent = true;
        let best: Plan | null = null;
        for (const facing of [1, -1] as const) {
          for (const aim of [-1.2, -0.8, -0.4]) {
            const dx = Math.cos(aim) * facing;
            const dy = Math.sin(aim);
            const p = new Rocket(s.x + dx * 11, s.y - 7 + dy * 11, dx * 6.5, dy * 6.5, s, 'homing', e.x, e.y - 3);
            const sc = this.score(this.simulate(p, 0, 300), s);
            if (!best || sc.score > best.score) best = { weapon: 'homing', facing, aim, power: 0.72, fuse: 3, tx: e.x, ty: e.y - 3, score: sc.score, impactX: sc.x, impactY: sc.y };
          }
        }
        sfx.silent = false;
        if (best) cands.push(best);
      }
      yield* breathe();
    }

    for (const id of ['sheep', 'skySheep'] as WeaponId[]) {
      if (!weapons.includes(id)) continue;
      for (const facing of [1, -1] as const) {
        sfx.silent = true;
        const sh = new Sheep(s.x + facing * 9, s.y - 3, facing, s, false);
        const sc = this.score(this.simulate(sh, 0, 480), s);
        sfx.silent = false;
        if (sc.score > 0) cands.push({ weapon: id, facing, aim: 0, power: 0, fuse: 3, tx: 0, ty: 0, score: sc.score * (id === 'skySheep' ? 1.05 : 0.95), impactX: sc.x, impactY: sc.y });
        yield* breathe();
      }
    }

    if (weapons.includes('doomsday')) {
      const mine = this.team.snakes.reduce((a, o) => a + (o.alive ? o.hp : 0), 0);
      const theirs = enemies.reduce((a, o) => a + o.hp, 0);
      if (theirs > mine + 80 || this.level === 'troll') cands.push({ weapon: 'doomsday', facing: s.facing, aim: 0, power: 0, fuse: 3, tx: 0, ty: 0, score: 38, impactX: -999, impactY: -999 });
    }

    while (g.tick - started < 40) yield;

    cands.sort((a, b) => b.score - a.score);
    let pick = cands[0] ?? null;
    if (this.level === 'troll' && pick) {
      const funny = cands.find((c) => FUNNY.includes(c.weapon) && c.score >= pick!.score * 0.6);
      if (funny && rng.chance(0.7)) pick = funny;
      const roll = rng.next();
      if (roll < 0.05 && g.isAvailable('skip', this.team)) return { ...pick, weapon: 'skip', score: 0 };
      if (roll < 0.11 && g.isAvailable('girder', this.team)) {
        const e = rng.pick(enemies);
        if (this.exposed(e)) return { weapon: 'girder', facing: s.facing, aim: 0, power: 0, fuse: 3, tx: e.x, ty: e.y - 24, score: 0, impactX: -999, impactY: -999, girderAngle: 0 };
      }
    }
    if (this.level === 'easy' && pick && cands.length > 3 && rng.chance(0.35)) pick = cands[Math.min(cands.length - 1, rng.int(1, 4))]!;

    if ((!pick || pick.score < 10) && this.rethinks < 2 && g.turnT > 60 * 15) {
      if (g.isAvailable('teleport', this.team) && (this.level === 'hard' || this.level === 'troll') && rng.chance(0.6)) {
        const spot = this.teleportSpot(enemies);
        if (spot) return { weapon: 'teleport', facing: s.facing, aim: 0, power: 0, fuse: 3, tx: spot.x, ty: spot.y, score: 1, impactX: -999, impactY: -999, say: this.level === 'troll' ? 'HI :)' : undefined };
      }
      const target = enemies.sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0]!;
      const dir = target.x >= s.x ? 1 : -1;
      return { weapon: 'bazooka', facing: dir, aim: 0, power: 0, fuse: 3, tx: 0, ty: 0, score: 0, impactX: 0, impactY: 0, walk: dir * rng.int(70, 130) };
    }
    if (!pick) return null;
    const n = NOISE[this.level];
    const out = { ...pick };
    if (WEAPON_BY_ID[out.weapon].usage === 'charge' || out.weapon === 'shotgun' || out.weapon === 'homing') {
      out.aim = clamp(out.aim + gauss() * n.aim, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03);
      out.power = clamp(out.power + gauss() * n.power, 0.08, 1);
    }
    if (out.tx) out.tx += gauss() * n.aim * 160;
    return out;
  }

  private exposed(e: Snake): boolean {
    for (let dx = -5; dx <= 5; dx += 5) for (let y = 0; y < e.y - 10; y += 3) if (this.g.terrain.solid(e.x + dx, y)) return false;
    return true;
  }

  private lineClear(s: Snake, e: Snake, aim: number, facing: number): boolean {
    const dx = Math.cos(aim) * facing;
    const dy = Math.sin(aim);
    const mx = s.x + dx * 11;
    const my = s.y - 7 + dy * 11;
    const dist = Math.hypot(e.x - mx, e.y - 3 - my);
    if (dist > 600) return false;
    for (let d = 0; d < dist - 4; d += 2) {
      const x = mx + dx * d;
      const y = my + dy * d;
      if (this.g.terrain.solid(x, y)) return false;
      if (this.g.snakes.some((o) => o !== s && o !== e && o.alive && Math.hypot(o.x - x, o.y - 3 - y) < 6)) return false;
    }
    return true;
  }

  private teleportSpot(enemies: Snake[]): { x: number; y: number } | null {
    const g = this.g;
    for (let i = 0; i < 80; i++) {
      const e = rng.pick(enemies);
      const x = clamp(e.x + rng.range(-140, 140), 40, WORLD_W - 40);
      const top = g.terrain.surfaceY(Math.round(x), 20);
      if (top < 0 || top > env.waterY - 30) continue;
      const y = top - PHYS.snakeRadius - 2;
      if (Math.abs(x - e.x) < 40) continue;
      if (g.terrain.free(x, y, PHYS.snakeRadius + 1)) return { x, y };
    }
    return null;
  }
}
