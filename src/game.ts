import { AIM, DEATH_BLAST, PHYS, VIEW_H, VIEW_W, WATER_Y, WORLD_H, WORLD_W } from './config.ts';
import type { TeamDef } from './config.ts';
import { env, resetEnv } from './env.ts';
import { Terrain } from './terrain.ts';
import { Particles, setWaterColor } from './particles.ts';
import { Snake } from './snake.ts';
import type { AirKind, Team, World } from './snake.ts';
import { AirMissile, FallingSheep, MeteorStorm, Piano, Rocket, Sheep, Thrown } from './projectiles.ts';
import type { Projectile, ProjWorld } from './projectiles.ts';
import { Flame, Prop } from './entities.ts';
import type { EntWorld } from './entities.ts';
import { Backdrop } from './background.ts';
import type { Pad } from './input.ts';
import { VirtualPad } from './input.ts';
import { sfx } from './audio.ts';
import type { ThemeDef, LineKind } from './themes.ts';
import type { Settings } from './settings.ts';
import { startingAmmo, WEAPON_BY_ID, WEAPON_LIST, weaponName, MENU_ROWS } from './weapons.ts';
import type { WeaponId } from './weapons.ts';
import { drownFeed, killFeed, line, multiKill, trollLine } from './banter.ts';
import { CpuBrain } from './ai.ts';
import { clamp, hex, Rng, rng } from './util.ts';

export type Phase = 'intro' | 'play' | 'guide' | 'retreat' | 'settle' | 'damage' | 'death' | 'over';
const R = PHYS.snakeRadius;

export interface Popup {
  s: Snake;
  text: string;
  color: string;
  life: number;
}

export interface Bubble {
  s: Snake;
  text: string;
  life: number;
}

export interface FeedMsg {
  text: string;
  color: string;
  life: number;
}

export interface Banner {
  text: string;
  color: string;
  life: number;
  max: number;
}

export class Game implements World, ProjWorld, EntWorld {
  readonly seed: number;
  readonly theme: ThemeDef;
  readonly settings: Settings;
  readonly terrain: Terrain;
  readonly particles = new Particles();
  readonly snakes: Snake[] = [];
  readonly teams: Team[] = [];
  projectiles: Projectile[] = [];
  props: Prop[] = [];
  flameList: Flame[] = [];
  backdrop: Backdrop | null = null;
  private input: Pad;
  readonly cpuPad = new VirtualPad();
  private brains = new Map<Team, CpuBrain>();

  sim = false;
  control = { steer: 0, fire: false };
  wind = 0;
  phase: Phase = 'intro';
  phaseT = 0;
  turnT = 0;
  retreatT = 0;
  active: Snake | null = null;
  private teamTurn = -1;
  weapon: WeaponId = 'bazooka';
  fuse = 3;
  charging = false;
  power = 0;
  cursorMode = false;
  targetSet = false;
  tx = 0;
  ty = 0;
  girderAngle = 0;
  shotsLeft = 0;
  private toolsUsed = new Set<string>();
  attacked = false;
  enemyDamage = 0;
  private selfDamage = 0;
  private killsThisTurn = 0;
  private slowmoUsed = false;
  slowmo = 0;
  private lastBeepSec = 99;
  arrowT = 0;
  private hitStop = 0;
  dyingQueue: Snake[] = [];
  popups: Popup[] = [];
  bubbles: Bubble[] = [];
  feed: FeedMsg[] = [];
  banners: Banner[] = [];
  winner: Team | null = null;
  endReason = '';
  /** Freezes the turn timer (a live model is thinking). */
  holdClock = false;
  /** Live-arena overlays: predicted flight paths the models are testing, and who is thinking. */
  ghosts: Array<{ pts: number[]; color: string; life: number; max: number; label: string }> = [];
  thinking: { team: Team; since: number; status: string } | null = null;
  /** Every explosion with the turn it happened in (live-arena shot feedback). */
  blastLog: Array<{ turn: number; x: number; y: number; r: number }> = [];
  /** What the last attack was, in words (live arena reports the human's shots to the model). */
  lastShot: { turn: number; desc: string } | null = null;
  private lastPower = 0;
  paused = false;
  pauseSel = 0;
  showControls = false;
  menuOpen = false;
  menuRow = 0;
  menuCol = 0;
  debug = false;
  tick = 0;
  turnCount = 0;
  round = 1;
  suddenDeath = false;
  private waterTarget = WATER_Y;
  mouse = { x: 0, y: 0, inside: false, movedAt: -9999 };
  onExit: ((action: 'menu' | 'restart') => void) | null = null;

  cam = { x: 0, y: 0, z: 1, tz: 1, fx: WORLD_W / 2, fy: WORLD_H / 2, shake: 0, manual: false };

  constructor(input: Pad, settings: Settings, theme: ThemeDef, seed: number) {
    resetEnv();
    this.input = input;
    this.settings = settings;
    this.theme = theme;
    this.seed = seed;
    this.terrain = new Terrain(WORLD_W, WORLD_H, seed, theme);
    setWaterColor(theme.waterCrest);
    if (typeof document !== 'undefined') this.backdrop = new Backdrop(seed, theme);
    const r = new Rng(seed ^ 0x51ed);
    const per = clamp(settings.snakesPerTeam, 1, 4);
    const spots = this.terrain.findSpawns(per * 2, 140, r);
    theme.teams.forEach((base, index) => {
      const def: TeamDef = { ...base };
      if (index === 0 && settings.teamName.trim()) def.name = settings.teamName.trim().toUpperCase().slice(0, 16);
      const arena = settings.mode === 'arena' ? settings.arena : undefined;
      const seat = arena ? (index === 0 ? arena.a : arena.b) : undefined;
      const human = seat?.provider === 'human';
      const cpu = !human && (settings.mode === 'watch' || settings.mode === 'arena' || (settings.mode === 'cpu' && index === 1));
      if (cpu && settings.mode === 'cpu') def.name = `${def.name} (CPU)`;
      const team: Team = { def, index, snakes: [], cursor: 0, cpu, ammo: startingAmmo(), weapon: 'bazooka' };
      if (arena && seat) {
        def.name = seat.label.toUpperCase().slice(0, 18);
        if (!human) team.clanker = { label: seat.label, model: seat.model, provider: seat.provider };
        // Same arsenal for both seats: interactive flight tools need frame-by-frame steering a turn-based model cannot do.
        team.ammo.set('jetpack', 0);
        team.ammo.set('vine', 0);
        team.ammo.set('surrender', 0);
      }
      this.teams.push(team);
    });
    const outfits = [...theme.outfits];
    let k = 0;
    for (let j = 0; j < per; j++) {
      for (const team of this.teams) {
        const spot = spots[k] ?? { x: 200 + k * 230, y: 120 };
        k++;
        const s = new Snake(team, team.def.snakes[j % team.def.snakes.length]!, spot.x, spot.y - R - 1, settings.startHp);
        s.facing = spot.x < WORLD_W / 2 ? 1 : -1;
        s.outfit = outfits.length ? outfits.splice(r.int(0, outfits.length - 1), 1)[0]! : r.pick(theme.outfits);
        if (!outfits.length) outfits.push(...theme.outfits);
        team.snakes.push(s);
        this.snakes.push(s);
      }
    }
    if (settings.hazards) {
      const used = this.snakes.map((s) => ({ x: s.x, y: s.y }));
      for (const spot of this.terrain.findSpawns(6, 90, r, used)) this.props.push(new Prop('mine', spot.x, spot.y - 4));
      for (const spot of this.terrain.findSpawns(4, 120, r, [...used, ...this.props])) this.props.push(new Prop('barrel', spot.x, spot.y - 7));
      for (const p of this.props) p.resting = true;
    }
    for (const t of this.teams) {
      if (!t.cpu) continue;
      const brain = new CpuBrain(this, t, settings.brain);
      brain.external = !!t.clanker;
      this.brains.set(t, brain);
    }
    this.teamTurn = r.int(0, this.teams.length - 1) - 1;
    this.nextTurn();
    if (this.active) {
      this.cam.x = clamp(this.active.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
      this.cam.y = clamp(this.active.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
    }
  }

  get pad(): Pad {
    return this.active && this.active.team.cpu ? this.cpuPad : this.input;
  }

  get humanTurn(): boolean {
    return !!this.active && !this.active.team.cpu;
  }

  get viewW(): number {
    return VIEW_W / this.cam.z;
  }

  get viewH(): number {
    return VIEW_H / this.cam.z;
  }

  brainOf(t: Team): CpuBrain | undefined {
    return this.brains.get(t);
  }

  // ------------------------------------------------------------------ messages

  message(text: string, color: string): void {
    this.feed.push({ text, color, life: 200 });
    if (this.feed.length > 4) this.feed.shift();
  }

  banner(text: string, color: string, life = 120): void {
    this.banners.push({ text, color, life, max: life });
  }

  bubble(s: Snake, text: string, life = 150): void {
    if (!this.settings.banter || !s.alive) return;
    this.bubbles = this.bubbles.filter((b) => b.s !== s);
    this.bubbles.push({ s, text, life });
  }

  banter(s: Snake, kind: LineKind, chance = 1): void {
    if (rng.chance(chance)) this.bubble(s, line(kind, this.theme, s.team.cpu && this.settings.brain === 'troll'));
  }

  isAvailable(id: WeaponId, team: Team | null = this.active?.team ?? null): boolean {
    if (!team) return false;
    const def = WEAPON_BY_ID[id];
    return (team.ammo.get(id) ?? 0) !== 0 && this.round > def.delay;
  }

  // ------------------------------------------------------------------ turn flow

  private aliveTeams(): Team[] {
    return this.teams.filter((t) => t.snakes.some((s) => s.alive && s.hp > 0));
  }

  private nextTurn(): void {
    const alive = this.aliveTeams();
    if (alive.length <= 1) {
      this.endReason = alive.length ? 'LAST TEAM STANDING' : 'MUTUAL DESTRUCTION';
      this.endGame(alive[0] ?? null);
      return;
    }
    const cap = this.settings.maxTurns ?? 0;
    if (cap > 0 && this.turnCount >= cap) {
      const hp = alive.map((t) => ({ t, hp: t.snakes.reduce((a, s) => a + (s.alive ? s.hp : 0), 0) })).sort((a, b) => b.hp - a.hp);
      const tie = hp.length > 1 && hp[0]!.hp === hp[1]!.hp;
      this.endReason = tie ? `TURN LIMIT (${cap}): TIED ON HP` : `TURN LIMIT (${cap}): MOST HP WINS`;
      this.endGame(tie ? null : hp[0]!.t);
      return;
    }
    this.turnCount++;
    this.round = Math.floor((this.turnCount - 1) / this.teams.length) + 1;
    if (this.settings.suddenDeath > 0 && this.round > this.settings.suddenDeath) {
      if (!this.suddenDeath) {
        this.suddenDeath = true;
        this.banner('SUDDEN DEATH!', '#ff4b4b', 180);
        this.message('THE WATER IS RISING', '#7fc4e0');
        sfx.siren();
      }
      this.waterTarget = Math.max(260, env.waterY - 22);
    }
    for (const s of this.snakes) {
      if (s.alive && s.poisoned && s.hp > 1) {
        const d = Math.min(5, s.hp - 1);
        s.hp -= d;
        this.popups.push({ s, text: `-${d}`, color: '#7dff4a', life: 90 });
      }
    }
    if (this.settings.crates && rng.chance(0.5) && this.props.filter((p) => p.kind === 'crate').length < 4) {
      const c = new Prop('crate', rng.range(120, WORLD_W - 120), -20);
      c.chute = true;
      c.crate = rng.chance(0.3) ? 'health' : 'weapon';
      this.props.push(c);
    }
    for (let i = 0; i < this.teams.length; i++) {
      this.teamTurn = (this.teamTurn + 1) % this.teams.length;
      if (alive.includes(this.teams[this.teamTurn]!)) break;
    }
    const team = this.teams[this.teamTurn]!;
    let s: Snake | null = null;
    for (let i = 0; i < team.snakes.length; i++) {
      const c = team.snakes[(team.cursor + i) % team.snakes.length]!;
      if (c.alive && c.hp > 0) {
        s = c;
        team.cursor = (team.cursor + i + 1) % team.snakes.length;
        break;
      }
    }
    if (!s) return;
    this.active = s;
    for (const o of this.snakes) o.hurtThisTurn = false;
    this.wind = Math.round(rng.range(-1, 1) * 20) / 20;
    sfx.setWind(this.wind);
    this.turnT = this.settings.turnSeconds * 60;
    this.retreatT = 0;
    this.attacked = false;
    this.enemyDamage = 0;
    this.selfDamage = 0;
    this.killsThisTurn = 0;
    this.slowmoUsed = false;
    this.charging = false;
    this.power = 0;
    this.cursorMode = false;
    this.targetSet = false;
    this.shotsLeft = 0;
    this.toolsUsed.clear();
    this.menuOpen = false;
    this.lastBeepSec = 99;
    this.arrowT = 150;
    this.phase = 'intro';
    this.phaseT = 0;
    this.cam.manual = false;
    this.weapon = this.isAvailable(team.weapon as WeaponId, team) ? (team.weapon as WeaponId) : 'bazooka';
    this.tx = s.x + s.facing * 120;
    this.ty = s.y - 40;
    this.message(`${s.name}'S TURN`, team.def.color);
    sfx.jingle();
    if (!team.cpu) this.banter(s, 'turn', 0.3);
    this.cpuPad.releaseAll();
    this.brains.get(team)?.beginTurn(s);
  }

  endTurn(): void {
    if (this.phase !== 'intro' && this.phase !== 'play' && this.phase !== 'retreat' && this.phase !== 'guide') return;
    if (this.charging) {
      this.charging = false;
      sfx.chargeStop();
    }
    const a = this.active;
    if (a) {
      a.held = null;
      if (a.state === 'rope') a.releaseRope();
      if (a.state === 'jet') a.endJet();
    }
    this.menuOpen = false;
    this.cursorMode = false;
    this.phase = 'settle';
    this.phaseT = 0;
  }

  private endGame(winner: Team | null): void {
    this.phase = 'over';
    this.phaseT = 0;
    this.winner = winner;
    this.active = null;
    sfx.fanfare();
    if (winner) {
      this.banner(`${winner.def.name} WIN!`, winner.def.light, 100000);
      for (const s of winner.snakes) {
        if (!s.alive) continue;
        s.say('victory', true);
        s.shadesT = 100000;
        this.banter(s, 'win');
      }
    } else this.banner('NOBODY WINS!', '#ffffff', 100000);
  }

  allSettled(): boolean {
    if (this.projectiles.length || this.flameList.length) return false;
    if (!this.snakes.every((s) => s.settled)) return false;
    return this.props.every((p) => p.settled);
  }

  private startDamage(): void {
    const a = this.active;
    if (a && a.alive && a.hp - a.pendingDmg > 0 && this.attacked) {
      if (this.enemyDamage >= 25) {
        a.say('taunt', true);
        a.setExpr('happy', 80);
        a.celebrate = 40;
        this.banter(a, 'hit', 0.8);
      } else if (this.enemyDamage === 0 && this.selfDamage > 0) {
        a.setExpr('sad', 70);
        this.banter(a, 'self');
      } else if (this.enemyDamage === 0) {
        a.say('missed', true);
        a.setExpr('sad', 70);
        this.banter(a, 'miss', 0.8);
      }
    }
    for (const s of this.snakes) {
      if (s.pendingDmg > 0 && s.alive) {
        this.popups.push({ s, text: `-${s.pendingDmg}`, color: s.team.def.light, life: 100 });
        s.hp = Math.max(0, s.hp - s.pendingDmg);
      }
      s.pendingDmg = 0;
    }
    this.phase = 'damage';
    this.phaseT = 0;
  }

  private startDeaths(): void {
    this.dyingQueue = this.snakes.filter((s) => s.alive && s.hp <= 0);
    if (this.dyingQueue.length >= 2) {
      this.banner(multiKill(this.dyingQueue.length), '#ffe14d', 150);
      sfx.airhorn();
    }
    this.phase = 'death';
    this.phaseT = 0;
  }

  private afterDeaths(): void {
    if (this.snakes.some((s) => s.pendingDmg > 0) || this.projectiles.length > 0 || this.flameList.length > 0) {
      this.phase = 'settle';
      this.phaseT = 0;
      return;
    }
    const a = this.active;
    if (a && a.alive && this.killsThisTurn > 0) {
      a.shadesT = 240;
      a.celebrate = 60;
      this.banter(a, 'kill');
    }
    this.nextTurn();
  }

  // ------------------------------------------------------------------ world hooks

  damage(s: Snake, amount: number): void {
    if (!s.alive || amount <= 0) return;
    s.pendingDmg += amount;
    s.hurtThisTurn = true;
    const a = this.active;
    if (a && s.team !== a.team) this.enemyDamage += amount;
    if (a && s.team === a.team) this.selfDamage += amount;
    s.say(amount >= 30 ? 'bigHurt' : 'hurt');
    if (amount >= 15 && rng.chance(0.35)) this.banter(s, 'hurt');
    if (!this.slowmoUsed && s.hp - s.pendingDmg <= 0 && a && s.team !== a.team && (this.phase === 'retreat' || this.phase === 'guide' || this.phase === 'settle')) {
      this.slowmoUsed = true;
      this.slowmo = 50;
    }
    if (s === a) this.endTurn();
  }

  explode(x: number, y: number, radius: number, damage: number, knock: number): void {
    this.blastLog.push({ turn: this.turnCount, x, y, r: radius });
    if (this.blastLog.length > 300) this.blastLog.shift();
    const debris = this.terrain.carve(x, y, radius);
    this.particles.explosion(x, y, radius, debris);
    sfx.explosion(radius);
    this.cam.shake = Math.max(this.cam.shake, Math.min(14, radius / 4));
    this.hitStop = Math.max(this.hitStop, radius > 25 ? 4 : 2);
    const reach = radius + R * 1.5;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const dx = s.x - x;
      const dy = s.y - y;
      const d = Math.hypot(dx, dy);
      if (d >= reach) continue;
      const f = 1 - d / reach;
      let nx = d > 0.5 ? dx / d : 0;
      let ny = d > 0.5 ? dy / d : -1;
      ny -= 0.7;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const sp = knock * (0.35 + 0.65 * f);
      if (s.state === 'rope') s.releaseRope();
      if (s.state === 'jet') s.endJet();
      s.knock(nx * sp, ny * sp);
      this.damage(s, Math.max(1, Math.round(damage * f)));
    }
    for (const p of this.projectiles) {
      if (!(p instanceof Thrown)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < reach && d > 0.5) {
        const f = 1 - d / reach;
        p.vx += ((p.x - x) / d) * knock * f;
        p.vy += ((p.y - y) / d) * knock * f - 1;
      }
    }
    for (const p of this.props) p.hit(x, y, reach, damage, knock);
    for (const fl of this.flameList) {
      const d = Math.hypot(fl.x - x, fl.y - y);
      if (d < reach) {
        fl.stuck = false;
        fl.vx += ((fl.x - x) / (d || 1)) * 2;
        fl.vy -= 2;
      }
    }
  }

  spawn(p: Projectile): void {
    this.projectiles.push(p);
  }

  flames(x: number, y: number, n: number, spread: number): void {
    for (let i = 0; i < n && this.flameList.length < 140; i++) this.flameList.push(new Flame(x, y, rng.range(-spread, spread), rng.range(-spread * 1.4, -0.5)));
  }

  poison(x: number, y: number, r: number): void {
    this.particles.poisonCloud(x, y, r);
    sfx.gurgle();
    for (const s of this.snakes) {
      if (s.alive && Math.hypot(s.x - x, s.y - y) < r && !s.poisoned) {
        s.poisoned = true;
        this.particles.text('POISONED', s.x, s.y - 30, '#7dff4a', 70, 1, 0.3);
      }
    }
  }

  collect(p: Prop, s: Snake): void {
    sfx.coin();
    if (p.crate === 'health') {
      s.hp += 25;
      s.displayHp = s.hp;
      s.poisoned = false;
      this.popups.push({ s, text: '+25', color: '#7dff7d', life: 90 });
      this.message(`${s.name} GOT +25 HEALTH`, s.team.def.light);
    } else {
      const pool = WEAPON_LIST.filter((w) => w.crate > 0);
      let roll = rng.range(0, pool.reduce((a, w) => a + w.crate, 0));
      let got = pool[0]!;
      for (const w of pool) {
        roll -= w.crate;
        if (roll <= 0) {
          got = w;
          break;
        }
      }
      const cur = s.team.ammo.get(got.id) ?? 0;
      if (cur >= 0) s.team.ammo.set(got.id, cur + 1);
      const name = weaponName(got.id, this.theme);
      this.message(`${s.team.def.name} GOT ${name}!`, s.team.def.light);
      this.particles.text(`+${name}`, s.x, s.y - 30, '#ffe14d', 90, 1, 0.3);
    }
    this.banter(s, 'crate', 0.7);
  }

  onLand(s: Snake, impact: number, kind: AirKind): void {
    if (impact > 1.5) {
      sfx.land(impact / 6);
      this.particles.dust(s.x, s.y + R, Math.min(10, Math.round(impact * 2)));
    }
    if (impact > PHYS.fallDamageSpeed) {
      const dmg = Math.round((impact - PHYS.fallDamageSpeed) * PHYS.fallDamagePerSpeed) + 2;
      sfx.thud();
      s.setExpr('hurt', 45);
      this.cam.shake = Math.max(this.cam.shake, 3);
      this.particles.dust(s.x, s.y + R, 14, 2);
      this.damage(s, dmg);
      s.say('oof', true);
    } else if (kind === 'jump' || kind === 'flip') s.landSquash = Math.max(s.landSquash, 0.5);
  }

  onDrown(s: Snake): void {
    sfx.splash(true);
    this.particles.splash(s.x, true);
    this.particles.text('F', s.x, env.waterY - 10, '#ffffff', 120, 3, 0.4);
    s.say('drown', true);
    s.pendingDmg = 0;
    s.hp = 0;
    s.displayHp = 0;
    s.poisoned = false;
    this.bubbles = this.bubbles.filter((b) => b.s !== s);
    this.message(drownFeed(s.name), s.team.def.color);
    if (this.active && s.team !== this.active.team) this.killsThisTurn++;
    if (s === this.active) this.endTurn();
  }

  // ------------------------------------------------------------------ weapons

  selectWeapon(id: WeaponId): boolean {
    const a = this.active;
    if (!a || !this.isAvailable(id)) {
      sfx.beep(false);
      return false;
    }
    if (this.charging) return false;
    this.weapon = id;
    a.team.weapon = id;
    this.cursorMode = false;
    this.targetSet = false;
    sfx.blip();
    return true;
  }

  cycleWeapon(dir: number): void {
    const a = this.active;
    if (!a) return;
    const ids = MENU_ROWS.flatMap(([, list]) => list).filter((id) => this.isAvailable(id));
    const i = Math.max(0, ids.indexOf(this.weapon));
    this.selectWeapon(ids[(i + dir + ids.length) % ids.length]!);
  }

  private useAmmo(id: WeaponId): void {
    const team = this.active?.team;
    if (!team) return;
    const n = team.ammo.get(id) ?? 0;
    if (n > 0) team.ammo.set(id, n - 1);
  }

  /** Point in front of the snake's mouth along the aim. */
  muzzle(s: Snake): { x: number; y: number; dx: number; dy: number } {
    const dx = Math.cos(s.aim) * s.facing;
    const dy = Math.sin(s.aim);
    return { x: s.x + dx * 11, y: s.y - 7 + dy * 11, dx, dy };
  }

  private afterAttack(controllable: boolean): void {
    const s = this.active;
    if (s) {
      const def = WEAPON_BY_ID[this.weapon];
      const bits = [weaponName(this.weapon, this.theme), s.facing > 0 ? 'RIGHT' : 'LEFT'];
      if (def.usage === 'charge' || def.usage === 'targetCharge' || this.weapon === 'shotgun') bits.push(`${Math.round((-s.aim * 180) / Math.PI)} DEG`);
      if (def.usage === 'charge' || def.usage === 'targetCharge') bits.push(`${Math.round(this.lastPower * 100)}%`);
      if (def.usage === 'target' || def.usage === 'targetCharge') bits.push(`AT ${Math.round(this.tx)},${Math.round(this.ty)}`);
      this.lastShot = { turn: this.turnCount, desc: bits.join(' ') };
    }
    this.attacked = true;
    this.cam.manual = false;
    this.menuOpen = false;
    if (controllable) {
      this.phase = 'guide';
      this.phaseT = 0;
      return;
    }
    this.phase = 'retreat';
    this.phaseT = 0;
    this.retreatT = this.settings.turnSeconds > 0 ? 5 * 60 : 0;
  }

  fireCharged(power: number): void {
    const s = this.active;
    this.lastPower = Math.max(0.06, power);
    this.charging = false;
    sfx.chargeStop();
    if (!s) return;
    const id = this.weapon;
    const def = WEAPON_BY_ID[id];
    const m = this.muzzle(s);
    const v = Math.max(0.06, power) * (def.maxSpeed ?? 10);
    let p: Projectile;
    if (id === 'bazooka' || id === 'homing' || id === 'venom') {
      p = new Rocket(m.x, m.y, m.dx * v, m.dy * v, s, id === 'bazooka' ? 'rocket' : id, this.tx, this.ty);
      sfx.launch();
      s.say('fire', true);
      for (let i = 0; i < 6; i++) this.particles.add('smoke', s.x - m.dx * 6, m.y - m.dy * 4, -m.dx * rng.range(0.3, 1), -m.dy * rng.range(0.3, 1) - 0.2, rng.int(20, 40), rng.range(2, 4), hex('#8a8790'), -0.01, 0.94, 0.01);
      this.cam.shake = Math.max(this.cam.shake, 1.5);
    } else {
      const kind = id === 'cluster' ? 'cluster' : id === 'melon' ? 'melon' : id === 'holyEgg' ? 'holyEgg' : id === 'petrol' ? 'petrol' : 'grenade';
      p = new Thrown(m.x, m.y, m.dx * v, m.dy * v, s, kind, id === 'holyEgg' ? 3 : this.fuse);
      sfx.throwSwish();
      s.say('throw', true);
    }
    this.projectiles.push(p);
    this.useAmmo(id);
    s.held = null;
    s.mouth = 1;
    this.power = 0;
    this.targetSet = false;
    this.afterAttack(false);
  }

  /** Instant and targeted weapons. Returns false if it could not be used. */
  useWeapon(): boolean {
    const s = this.active;
    if (!s) return false;
    const id = this.weapon;
    const team = s.team;
    switch (id) {
      case 'dynamite':
        this.projectiles.push(new Thrown(s.x + s.facing * 6, s.y - 2, s.facing * 0.6, -1.2, s, 'dynamite', 5));
        sfx.throwSwish();
        break;
      case 'mine': {
        const mine = new Prop('mine', s.x + s.facing * 8, s.y - 2);
        mine.vx = s.facing * 0.8;
        mine.vy = -1;
        mine.armT = 120;
        this.props.push(mine);
        sfx.throwSwish();
        break;
      }
      case 'shotgun': {
        this.shootHitscan(s);
        if (this.shotsLeft === 0) this.shotsLeft = 1;
        else this.shotsLeft = -1;
        this.useAmmo(id);
        if (this.shotsLeft === 1) {
          this.attacked = true;
          return true;
        }
        this.afterAttack(false);
        return true;
      }
      case 'tailWhip': {
        sfx.whoosh();
        s.celebrate = 10;
        let hit = false;
        for (const o of this.snakes) {
          if (o === s || !o.alive) continue;
          const dx = (o.x - s.x) * s.facing;
          if (dx > -2 && dx < 22 && Math.abs(o.y - s.y) < 14) {
            o.knock(s.facing * 6.5, -4.5);
            this.damage(o, 25);
            hit = true;
          }
        }
        for (const p of this.props) {
          const dx = (p.x - s.x) * s.facing;
          if (dx > -2 && dx < 22 && Math.abs(p.y - s.y) < 14) p.hit(p.x - s.facing * 5, p.y + 3, 20, 10, 6);
        }
        if (hit) {
          sfx.thud();
          this.particles.text('SLAP!', s.x + s.facing * 14, s.y - 16, '#ffe14d', 50, 2, 0.4);
        }
        break;
      }
      case 'sheep':
      case 'skySheep': {
        const sh = new Sheep(s.x + s.facing * 9, s.y - 3, s.facing, s, id === 'skySheep');
        this.projectiles.push(sh);
        sfx.bleat();
        this.useAmmo(id);
        s.held = null;
        this.afterAttack(true);
        return true;
      }
      case 'sheepRain':
        for (let i = 0; i < 6; i++) {
          const fs = new FallingSheep(this.tx + rng.range(-70, 70), -30 - i * 28, rng.range(-0.6, 0.6), rng.range(0, 2), s);
          this.projectiles.push(fs);
        }
        sfx.bleat(0.8);
        this.message('IT IS RAINING SHEEP', '#ffffff');
        break;
      case 'airStrike':
        for (let i = 0; i < 5; i++) {
          const am = new AirMissile(this.tx + (i - 2) * 24 - s.facing * 90, -40 - i * 14, s.facing * 2.3, 4, s);
          am.skin = this.theme.id;
          this.projectiles.push(am);
        }
        sfx.whistle();
        break;
      case 'piano':
        this.projectiles.push(new Piano(this.tx, -40, 0, 2, s));
        sfx.whistle();
        break;
      case 'doomsday':
        this.projectiles.push(new MeteorStorm(0, 0, 0, 0, s));
        this.banner(weaponName('doomsday', this.theme), '#ff6a3a', 150);
        sfx.siren();
        break;
      case 'teleport': {
        if (!this.terrain.free(this.tx, this.ty, R + 1) || this.ty > env.waterY - 10 || this.ty < 5) {
          sfx.beep(false);
          this.particles.text('NOPE', this.tx, this.ty, '#ff6a6a', 40, 1, 0.3);
          return false;
        }
        this.particles.sparkle(s.x, s.y, 20);
        s.x = this.tx;
        s.y = this.ty;
        s.vx = 0;
        s.vy = 0;
        s.state = 'air';
        s.airKind = 'fall';
        this.particles.sparkle(s.x, s.y, 20);
        sfx.teleport();
        break;
      }
      case 'girder': {
        const ok = this.terrain.stampGirder(this.tx, this.ty, this.girderAngle, 64, (x, y) => this.snakes.some((o) => o.alive && Math.hypot(o.x - x, o.y - y) < R + 1));
        if (!ok) {
          sfx.beep(false);
          return false;
        }
        sfx.clink(4);
        if (team.cpu && this.settings.brain === 'troll') this.bubble(s, trollLine('girder'));
        break;
      }
      case 'jetpack':
        if (s.state !== 'ground' && s.state !== 'air') return false;
        if (!this.toolsUsed.has(id)) this.useAmmo(id);
        this.toolsUsed.add(id);
        s.startJet(330);
        return true;
      case 'vine': {
        const m = this.muzzle(s);
        if (!s.startRope(this.terrain, m.dx, m.dy, 240)) {
          sfx.beep(false);
          return false;
        }
        sfx.twang();
        if (!this.toolsUsed.has(id)) this.useAmmo(id);
        this.toolsUsed.add(id);
        return true;
      }
      case 'skip':
        if (team.cpu && this.settings.brain === 'troll') this.bubble(s, trollLine('skip'));
        this.endTurn();
        return true;
      case 'surrender':
        this.banner(`${team.def.name} RAGE QUIT`, team.def.light, 150);
        for (const o of team.snakes) if (o.alive) {
          o.pendingDmg = o.hp;
          o.setExpr('sad', 200);
        }
        this.bubble(s, 'GG NO RE');
        this.endTurn();
        return true;
      default:
        return false;
    }
    this.useAmmo(id);
    s.held = null;
    this.targetSet = false;
    this.cursorMode = false;
    this.afterAttack(false);
    return true;
  }

  private shootHitscan(s: Snake): void {
    const m = this.muzzle(s);
    sfx.gunshot();
    this.cam.shake = Math.max(this.cam.shake, 2);
    let x = m.x;
    let y = m.y;
    for (let d = 0; d < 700; d += 2) {
      x = m.x + m.dx * d;
      y = m.y + m.dy * d;
      if (this.terrain.solid(x, y)) break;
      if (this.snakes.some((o) => o !== s && o.alive && Math.hypot(o.x - x, o.y - 3 - y) < R + 1)) break;
      if (y > env.waterY || x < -50 || x > WORLD_W + 50) break;
    }
    this.particles.tracer(m.x, m.y, x, y);
    this.explode(x, y, 13, 25, 3.5);
  }
  // ------------------------------------------------------------------ controls (human or CPU pad)

  get targeting(): boolean {
    const def = WEAPON_BY_ID[this.weapon];
    return def.usage === 'target' || (def.usage === 'targetCharge' && !this.targetSet);
  }

  confirmTarget(): void {
    const def = WEAPON_BY_ID[this.weapon];
    this.cursorMode = false;
    this.tx = clamp(this.tx, 0, WORLD_W);
    this.ty = clamp(this.ty, -40, WORLD_H);
    if (def.usage === 'targetCharge') {
      this.targetSet = true;
      this.particles.sparkle(this.tx, this.ty, 12, '#ff6a6a');
      sfx.mineBeep();
      return;
    }
    this.useWeapon();
  }

  openMenu(): void {
    this.menuOpen = true;
    MENU_ROWS.forEach(([, ids], r) => {
      const c = ids.indexOf(this.weapon);
      if (c >= 0) {
        this.menuRow = r;
        this.menuCol = c;
      }
    });
    sfx.blip();
  }

  private menuControls(pad: Pad): void {
    const rows = MENU_ROWS;
    if (pad.pressed('up')) this.menuRow = (this.menuRow + rows.length - 1) % rows.length;
    if (pad.pressed('down')) this.menuRow = (this.menuRow + 1) % rows.length;
    const len = rows[this.menuRow]![1].length;
    if (pad.pressed('left')) this.menuCol = (this.menuCol + len - 1) % len;
    if (pad.pressed('right')) this.menuCol = (this.menuCol + 1) % len;
    this.menuCol = Math.min(this.menuCol, len - 1);
    if (pad.pressed('up') || pad.pressed('down') || pad.pressed('left') || pad.pressed('right')) sfx.countTick();
    if (pad.pressed('fire') || pad.pressed('jump')) {
      const id = rows[this.menuRow]![1][this.menuCol]!;
      if (this.selectWeapon(id)) this.menuOpen = false;
    }
  }

  private controls(): void {
    const s = this.active;
    const pad = this.pad;
    if (!s || !s.alive) return;
    const phase = this.phase;
    const canAttack = phase === 'intro' || phase === 'play';

    if (pad.pressed('menu') && canAttack && !this.charging) {
      if (this.menuOpen) this.menuOpen = false;
      else this.openMenu();
    }
    if (this.menuOpen) {
      this.menuControls(pad);
      s.held = null;
      return;
    }
    if (phase === 'guide') {
      this.control.steer = (pad.isHeld('left') ? -1 : 0) + (pad.isHeld('right') ? 1 : 0);
      this.control.fire = pad.pressed('fire');
      return;
    }
    if (s.state === 'rope') {
      s.ropeSwing = (pad.isHeld('left') ? -1 : 0) + (pad.isHeld('right') ? 1 : 0);
      s.ropeReel = pad.isHeld('up') ? -1 : pad.isHeld('down') ? 1 : 0;
      if (pad.pressed('fire') || pad.pressed('jump')) s.releaseRope();
      this.cam.manual = false;
      return;
    }
    if (s.state === 'jet') {
      s.jetUp = pad.isHeld('up');
      s.jetX = (pad.isHeld('left') ? -1 : 0) + (pad.isHeld('right') ? 1 : 0);
      if (pad.pressed('fire') || pad.pressed('jump')) s.endJet();
      this.cam.manual = false;
      return;
    }
    if (s.state === 'air' && canAttack && (this.weapon === 'vine' || this.weapon === 'jetpack') && pad.pressed('fire')) {
      this.useWeapon();
      return;
    }
    if (s.state === 'ground' && s.crouchT === 0 && !this.charging && !this.cursorMode) {
      if (pad.isHeld('left')) s.moveDir = -1;
      else if (pad.isHeld('right')) s.moveDir = 1;
      if (pad.pressed('jump')) s.jump('jump');
      else if (pad.pressed('backflip')) s.jump('flip');
    }
    if (s.moveDir !== 0 || s.state !== 'ground') {
      this.cam.manual = false;
      this.arrowT = Math.min(this.arrowT, 20);
    }
    if (!canAttack) {
      s.held = null;
      return;
    }
    if (pad.pressed('nextWeapon')) this.cycleWeapon(1);
    if (pad.pressed('prevWeapon')) this.cycleWeapon(-1);
    for (let n = 1; n <= 5; n++) {
      if (pad.pressed(`fuse${n}` as 'fuse1')) {
        this.fuse = n;
        sfx.blip();
      }
    }
    if (pad.pressed('fuseCycle')) {
      this.fuse = (this.fuse % 5) + 1;
      sfx.blip();
    }
    if (this.cursorMode) {
      const sp = 4 / this.cam.z;
      if (pad.isHeld('left')) this.tx -= sp;
      if (pad.isHeld('right')) this.tx += sp;
      if (pad.isHeld('up')) this.ty -= sp;
      if (pad.isHeld('down')) this.ty += sp;
      this.tx = clamp(this.tx, 0, WORLD_W);
      this.ty = clamp(this.ty, -40, WORLD_H);
      this.cam.manual = true;
      this.cam.fx = this.tx;
      this.cam.fy = this.ty;
      this.followPoint(this.tx, this.ty, 0.12);
      if (pad.pressed('fire')) this.confirmTarget();
      s.held = this.weapon;
      return;
    }
    const up = pad.isHeld('up');
    const down = pad.isHeld('down');
    if (this.weapon === 'girder') {
      if (pad.pressed('up')) this.girderAngle = clamp(this.girderAngle - Math.PI / 8, -Math.PI / 2, Math.PI / 2);
      if (pad.pressed('down')) this.girderAngle = clamp(this.girderAngle + Math.PI / 8, -Math.PI / 2, Math.PI / 2);
    } else if (up || down) {
      const held = pad.heldFor(up ? 'up' : 'down');
      const sp = held > AIM.fastAfterTicks ? AIM.fastSpeed : AIM.speed;
      s.aim = clamp(s.aim + (up ? -sp : sp), -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }
    const ready = s.state === 'ground' && s.crouchT === 0 && !s.moving;
    s.held = ready || this.charging ? this.weapon : null;
    s.heldAim = s.aim;
    if (!ready && !this.charging) return;
    const def = WEAPON_BY_ID[this.weapon];
    if (this.targeting) {
      if (pad.pressed('fire')) {
        this.cursorMode = true;
        sfx.blip();
      }
      return;
    }
    if (def.usage === 'charge' || def.usage === 'targetCharge') {
      if (pad.pressed('fire') && !this.charging) {
        this.charging = true;
        this.power = 0;
        sfx.chargeStart();
      }
      if (this.charging) {
        this.power = Math.min(1, this.power + 1 / AIM.chargeTicks);
        sfx.chargeUpdate(this.power);
        if (this.power >= 1 || !pad.isHeld('fire')) this.fireCharged(this.power);
      }
    } else if (pad.pressed('fire')) this.useWeapon();
  }

  // ------------------------------------------------------------------ mouse (called by main)

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.cam.x + sx / this.cam.z, y: this.cam.y + sy / this.cam.z };
  }

  mouseMove(sx: number, sy: number): void {
    this.mouse.x = sx;
    this.mouse.y = sy;
    this.mouse.inside = true;
    this.mouse.movedAt = this.tick;
    if (this.humanTurn && this.targeting && !this.cursorMode && (this.phase === 'play' || this.phase === 'intro')) {
      const w = this.screenToWorld(sx, sy);
      this.tx = w.x;
      this.ty = w.y;
    }
  }

  /** Left click in world space. Returns true if it was consumed (so it does not start a drag). */
  clickWorld(sx: number, sy: number): boolean {
    if (!this.humanTurn || this.paused) return false;
    if (!(this.phase === 'play' || this.phase === 'intro') || !this.targeting || this.menuOpen) return false;
    const w = this.screenToWorld(sx, sy);
    this.tx = w.x;
    this.ty = w.y;
    this.confirmTarget();
    return true;
  }

  zoomBy(factor: number, sx = VIEW_W / 2, sy = VIEW_H / 2): void {
    const c = this.cam;
    const fit = Math.min(VIEW_W / WORLD_W, VIEW_H / WORLD_H);
    const nz = clamp(c.z * factor, fit, 2);
    const w = this.screenToWorld(sx, sy);
    c.z = nz;
    c.tz = nz;
    c.x = w.x - sx / nz;
    c.y = w.y - sy / nz;
    this.clampCam();
  }

  zoomCycle(): void {
    const fit = Math.min(VIEW_W / WORLD_W, VIEW_H / WORLD_H);
    const levels = [1, 0.6, fit];
    const i = levels.findIndex((l) => Math.abs(l - this.cam.z) < 0.02);
    this.zoomBy(levels[(i + 1) % levels.length]! / this.cam.z);
  }

  panCamera(dx: number, dy: number): void {
    this.cam.manual = true;
    this.cam.x += dx / this.cam.z;
    this.cam.y += dy / this.cam.z;
    this.clampCam();
  }

  centerCamera(x: number, y: number): void {
    this.cam.manual = true;
    this.cam.x = x - this.viewW / 2;
    this.cam.y = y - this.viewH / 2;
    this.clampCam();
  }

  private clampCam(): void {
    const c = this.cam;
    const vw = this.viewW;
    const vh = this.viewH;
    c.x = vw >= WORLD_W ? (WORLD_W - vw) / 2 : clamp(c.x, 0, WORLD_W - vw);
    c.y = vh >= WORLD_H ? (WORLD_H - vh) / 2 : clamp(c.y, -60, WORLD_H - vh);
  }

  private followPoint(x: number, y: number, k: number): void {
    const c = this.cam;
    c.x += (x - this.viewW / 2 - c.x) * k;
    c.y += (y - this.viewH / 2 - 10 / c.z - c.y) * k;
    this.clampCam();
  }

  // ------------------------------------------------------------------ update

  private globalKeys(): void {
    const inp = this.input;
    if (inp.pressed('pause') && this.phase !== 'over' && this.settings.mode !== 'arena') {
      if (this.menuOpen && this.humanTurn) this.menuOpen = false;
      else if (this.cursorMode && this.humanTurn) this.cursorMode = false;
      else {
        this.paused = !this.paused;
        this.pauseSel = 0;
        this.showControls = false;
      }
      sfx.blip();
    }
    if (inp.pressed('mute')) sfx.toggleMute();
    if (inp.pressed('debug')) this.debug = !this.debug;
    if (inp.pressed('zoomIn')) this.zoomBy(1.25);
    if (inp.pressed('zoomOut')) this.zoomBy(0.8);
    if (inp.pressed('zoomCycle')) this.zoomCycle();
    if (inp.pressed('center')) this.cam.manual = false;
    const k = 7;
    if (inp.isHeld('camLeft')) this.panCamera(-k, 0);
    if (inp.isHeld('camRight')) this.panCamera(k, 0);
    if (inp.isHeld('camUp')) this.panCamera(0, -k);
    if (inp.isHeld('camDown')) this.panCamera(0, k);
  }

  pauseItems(): string[] {
    return ['RESUME', 'CONTROLS', 'NEW ISLAND', 'MAIN MENU', sfx.muted ? 'SOUND: OFF' : 'SOUND: ON'];
  }

  pauseChoose(i: number): void {
    sfx.blip();
    switch (i) {
      case 0:
        this.paused = false;
        break;
      case 1:
        this.showControls = !this.showControls;
        break;
      case 2:
        this.onExit?.('restart');
        break;
      case 3:
        this.onExit?.('menu');
        break;
      case 4:
        sfx.toggleMute();
        break;
    }
  }

  private pauseMenu(): void {
    const inp = this.input;
    const n = this.pauseItems().length;
    if (this.showControls) {
      if (inp.pressed('confirm') || inp.pressed('back') || inp.pressed('jump')) this.showControls = false;
      return;
    }
    if (inp.pressed('up')) this.pauseSel = (this.pauseSel + n - 1) % n;
    if (inp.pressed('down')) this.pauseSel = (this.pauseSel + 1) % n;
    if (inp.pressed('confirm')) this.pauseChoose(this.pauseSel);
  }

  update(): void {
    this.globalKeys();
    if (this.paused) {
      this.pauseMenu();
      this.updateCamera();
      return;
    }
    this.tick++;
    this.backdrop?.update(this.wind);
    if (this.slowmo > 0) {
      this.slowmo--;
      if (this.slowmo % 3 !== 0) {
        this.updateCamera();
        return;
      }
    }
    if (this.hitStop > 0) {
      this.hitStop--;
      this.updateCamera();
      return;
    }
    this.phaseT++;
    if (env.waterY > this.waterTarget) env.waterY = Math.max(this.waterTarget, env.waterY - 0.4);
    this.control.steer = 0;
    this.control.fire = false;
    const live = this.phase === 'intro' || this.phase === 'play' || this.phase === 'guide' || this.phase === 'retreat';
    if (live && this.active) this.brains.get(this.active.team)?.update();

    switch (this.phase) {
      case 'intro':
        if (this.phaseT === 18 && this.active) this.active.say('turn', true);
        this.controls();
        if (this.phaseT >= 40 && this.phase === 'intro') {
          this.phase = 'play';
          this.phaseT = 0;
        }
        break;
      case 'play': {
        if ((!this.menuOpen || this.active?.team.cpu) && !this.holdClock) this.turnT--;
        const sec = Math.ceil(this.turnT / 60);
        if (sec <= 5 && sec >= 1 && sec < this.lastBeepSec) {
          this.lastBeepSec = sec;
          sfx.beep(sec <= 2);
        }
        this.controls();
        if (this.turnT <= 0) this.endTurn();
        break;
      }
      case 'guide':
        this.controls();
        if (!this.projectiles.some((p) => p.controllable && p.alive)) {
          this.phase = 'retreat';
          this.phaseT = 0;
          this.retreatT = 3 * 60;
        }
        break;
      case 'retreat':
        this.retreatT--;
        this.controls();
        if (this.retreatT <= 0) this.endTurn();
        break;
      case 'settle':
        if (this.phaseT >= 30 && this.allSettled()) this.startDamage();
        else if (this.phaseT > 900 && this.projectiles.length === 0) this.startDamage();
        else if (this.phaseT > 1200) {
          // Last-resort safety net: nothing may ever hang a turn.
          for (const p of this.projectiles) p.alive = false;
          this.projectiles = [];
        } else if (this.phaseT > 720) {
          for (const s of this.snakes) if (s.state === 'air') s.forceGround();
          for (const p of this.props) if (!p.sinking) {
            p.resting = true;
            p.chute = false;
          }
          for (const f of this.flameList) f.life = Math.min(f.life, 5);
        }
        break;
      case 'damage': {
        const ticking = this.snakes.some((s) => s.displayHp > s.hp);
        if (ticking && this.phaseT % 3 === 0) sfx.countTick();
        if (!ticking && this.phaseT >= 50) this.startDeaths();
        break;
      }
      case 'death': {
        const s = this.dyingQueue[0];
        if (!s) {
          if (this.phaseT >= 30) this.afterDeaths();
          break;
        }
        if (this.phaseT === 1) {
          s.say('bye', true);
          s.setExpr('sad', 80);
          s.dying = 60;
          this.banter(s, 'death');
        }
        if (s.dying > 0) s.dying--;
        if (this.phaseT === 62) {
          s.state = 'dead';
          const g = new Prop('grave', s.x, s.y);
          g.vy = -2.5;
          g.team = s.team;
          this.props.push(g);
          this.bubbles = this.bubbles.filter((b) => b.s !== s);
          this.message(killFeed(s.name, this.theme), s.team.def.color);
          if (this.active && s.team !== this.active.team) this.killsThisTurn++;
          sfx.pop();
          this.explode(s.x, s.y, DEATH_BLAST.radius, DEATH_BLAST.damage, DEATH_BLAST.knock);
          this.dyingQueue.shift();
          this.phaseT = 0;
        }
        break;
      }
      case 'over':
        if (this.phaseT % 70 === 0 && this.winner) {
          for (const s of this.winner.snakes) {
            if (!s.alive) continue;
            s.celebrate = 60;
            s.setExpr('happy', 70);
            for (let i = 0; i < 12; i++) this.particles.add('spark', s.x + rng.range(-20, 20), s.y - 40, rng.range(-1, 1), rng.range(-1, 0.5), rng.int(40, 80), 2, hex(rng.pick([this.winner.def.color, this.winner.def.pattern, '#ffffff'])), 0.05, 0.98);
          }
        }
        if (this.phaseT > 90) {
          if (this.settings.mode === 'arena') {
            if (this.input.pressed('back')) this.onExit?.('menu');
          } else if (this.input.pressed('confirm')) this.onExit?.('restart');
          else if (this.input.pressed('back')) this.onExit?.('menu');
        }
        break;
    }

    this.updateLooks();
    for (const s of this.snakes) s.update(this);
    for (let i = 0; i < this.projectiles.length; i++) this.projectiles[i]!.update(this);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    for (const p of this.props) p.update(this);
    this.props = this.props.filter((p) => p.alive);
    for (const f of this.flameList) f.update(this, this.tick);
    this.flameList = this.flameList.filter((f) => f.alive);
    this.particles.update(this.terrain, this.wind);
    for (const s of this.snakes) {
      if (s.displayHp > s.hp) s.displayHp = Math.max(s.hp, s.displayHp - 1);
      else if (s.displayHp < s.hp) s.displayHp = s.hp;
    }
    for (const p of this.popups) p.life--;
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const b of this.bubbles) b.life--;
    this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.s.alive);
    for (const m of this.feed) m.life--;
    this.feed = this.feed.filter((m) => m.life > 0);
    for (const b of this.banners) b.life--;
    this.banners = this.banners.filter((b) => b.life > 0);
    for (const gh of this.ghosts) gh.life--;
    this.ghosts = this.ghosts.filter((gh) => gh.life > 0);
    if (this.arrowT > 0) this.arrowT--;
    this.updateCamera();
    this.cpuPad.endTick();
  }

  private updateLooks(): void {
    const a = this.active;
    const proj = this.projectiles[this.projectiles.length - 1];
    for (const s of this.snakes) {
      if (s === a && s.held) {
        s.lookX = s.x + Math.cos(s.aim) * s.facing * 40;
        s.lookY = s.y - 7 + Math.sin(s.aim) * 40;
      } else if (proj) {
        s.lookX = proj.x;
        s.lookY = proj.y;
      } else if (a && s !== a) {
        s.lookX = a.x;
        s.lookY = a.y - 8;
      } else {
        s.lookX = s.x + s.facing * 30;
        s.lookY = s.y - 8;
      }
    }
  }

  private focusPoint(): [number, number] | null {
    const proj = this.projectiles.find((p) => p.controllable) ?? this.projectiles.find((p) => !(p instanceof MeteorStorm));
    if (proj) return [proj.x, proj.y];
    if (this.phase === 'death' && this.dyingQueue[0]) return [this.dyingQueue[0].x, this.dyingQueue[0].y];
    if (this.phase === 'settle' || this.phase === 'damage' || this.phase === 'death') {
      const moving = this.snakes.find((s) => s.state === 'air' || s.state === 'drown');
      if (moving) return [moving.x, moving.y];
      const fl = this.flameList[0];
      if (fl) return [fl.x, fl.y];
      return null;
    }
    if (this.phase === 'over' && this.winner) {
      const s = this.winner.snakes.find((x) => x.alive);
      if (s) return [s.x, s.y];
    }
    if (this.active) return [this.active.x, this.active.y];
    return null;
  }

  private updateCamera(): void {
    const c = this.cam;
    const inp = this.input;
    if (this.settings.edgeScroll && this.mouse.inside && this.tick - this.mouse.movedAt < 240 && !this.paused) {
      const m = 6;
      if (this.mouse.x < m) this.panCamera(-6, 0);
      if (this.mouse.x > VIEW_W - m) this.panCamera(6, 0);
      if (this.mouse.y < m) this.panCamera(0, -6);
      if (this.mouse.y > VIEW_H - m) this.panCamera(0, 6);
    }
    void inp;
    const fp = this.focusPoint();
    if (fp && !c.manual) {
      c.fx = fp[0];
      c.fy = fp[1];
      this.followPoint(fp[0], fp[1], 0.09);
    }
    c.shake *= 0.86;
    if (c.shake < 0.1) c.shake = 0;
  }
}