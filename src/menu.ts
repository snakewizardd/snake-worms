import { GAME_TITLE, PHYS, VIEW_H, VIEW_W, WORLD_W } from './config.ts';
import type { Input } from './input.ts';
import { sfx } from './audio.ts';
import { drawText } from './font.ts';
import { Backdrop } from './background.ts';
import { Particles } from './particles.ts';
import { Snake } from './snake.ts';
import type { Team, World } from './snake.ts';
import type { Terrain } from './terrain.ts';
import { THEMES, THEME_ORDER } from './themes.ts';
import type { ThemeDef, ThemeId } from './themes.ts';
import type { Brain, Mode, Settings } from './settings.ts';
import { saveSettings } from './settings.ts';
import { startingAmmo } from './weapons.ts';
import { line } from './banter.ts';
import { rng, TAU } from './util.ts';

export const VERSION = 'v1.0';
const GROUND = 252;
const flatTerrain = {
  solid: (_x: number, y: number) => y >= GROUND,
  circleHit: () => ({ hit: false, nx: 0, ny: 0 }),
} as unknown as Terrain;

type Screen = 'title' | 'main' | 'setup' | 'howto';
export type FrontResult = { start: Settings } | null;

interface Row {
  label: string;
  value: () => string;
  change?: (dir: number) => void;
  text?: boolean;
  start?: boolean;
}

export class Front {
  screen: Screen = 'title';
  private sel = 0;
  private t = 0;
  private theme!: ThemeDef;
  private backdrop!: Backdrop;
  private snakes: Snake[] = [];
  private world: World;
  private bubbles: Array<{ s: Snake; text: string; life: number }> = [];
  private readonly settings: Settings;
  private readonly input: Input;
  private rects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];

  constructor(input: Input, settings: Settings, screen: Screen = 'title') {
    this.input = input;
    this.settings = settings;
    this.screen = screen;
    this.world = { terrain: flatTerrain, particles: new Particles(), onLand: () => {}, onDrown: () => {} };
    this.setTheme(settings.theme === 'random' ? rng.pick(THEME_ORDER) : settings.theme);
  }

  private setTheme(id: ThemeId): void {
    this.theme = THEMES[id];
    this.backdrop = new Backdrop(rng.int(1, 1e9), this.theme);
    const teams: Team[] = this.theme.teams.map((def, index) => ({ def, index, snakes: [], cursor: 0, cpu: false, ammo: startingAmmo(), weapon: 'bazooka' }));
    this.snakes = [
      new Snake(teams[0]!, 'A', VIEW_W / 2 - 34, GROUND - PHYS.snakeRadius - 1, 100),
      new Snake(teams[1]!, 'B', VIEW_W / 2 + 34, GROUND - PHYS.snakeRadius - 1, 100),
    ];
    this.snakes[0]!.facing = 1;
    this.snakes[1]!.facing = -1;
    const pool = [...this.theme.outfits];
    for (const s of this.snakes) s.outfit = pool.splice(rng.int(0, pool.length - 1), 1)[0] ?? 'none';
    this.bubbles = [];
    if (sfx.ctx?.state === 'running') {
      sfx.stopMusic();
      sfx.startMusic(this.theme.music);
    }
  }

  private rows(): Row[] {
    const s = this.settings;
    const cyc = <T,>(list: T[], cur: T, dir: number): T => list[(list.indexOf(cur) + dir + list.length) % list.length]!;
    const themes: Array<ThemeId | 'random'> = [...THEME_ORDER, 'random'];
    const modes: Mode[] = ['cpu', 'hotseat', 'watch'];
    const brains: Brain[] = ['easy', 'normal', 'hard', 'troll'];
    const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
    return [
      { label: 'WORLD', value: () => (s.theme === 'random' ? 'RANDOM' : THEMES[s.theme].name), change: (d) => {
        s.theme = cyc(themes, s.theme, d);
        this.setTheme(s.theme === 'random' ? rng.pick(THEME_ORDER) : s.theme);
      } },
      { label: 'MODE', value: () => ({ cpu: 'VS CPU', hotseat: 'HOTSEAT (2 PLAYERS)', watch: 'CPU VS CPU (WATCH)' })[s.mode], change: (d) => (s.mode = cyc(modes, s.mode, d)) },
      { label: 'CPU BRAIN', value: () => ({ easy: 'EASY', normal: 'NORMAL', hard: 'HARD', troll: 'TROLL (MAXIMUM DISRESPECT)' })[s.brain], change: (d) => (s.brain = cyc(brains, s.brain, d)) },
      { label: 'YOUR TEAM NAME', value: () => (s.teamName || this.theme.teams[0].name) + (this.rowIs('YOUR TEAM NAME') && this.t % 40 < 20 ? '_' : ''), text: true },
      { label: 'SNAKES PER TEAM', value: () => String(s.snakesPerTeam), change: (d) => (s.snakesPerTeam = cyc([1, 2, 3, 4], s.snakesPerTeam, d)) },
      { label: 'TURN TIME', value: () => `${s.turnSeconds} SEC`, change: (d) => (s.turnSeconds = cyc([30, 45, 60, 90], s.turnSeconds, d)) },
      { label: 'STARTING HEALTH', value: () => String(s.startHp), change: (d) => (s.startHp = cyc([100, 150, 200], s.startHp, d)) },
      { label: 'CRATES', value: () => onOff(s.crates), change: () => (s.crates = !s.crates) },
      { label: 'MINES + BARRELS', value: () => onOff(s.hazards), change: () => (s.hazards = !s.hazards) },
      { label: 'AIM GUIDE', value: () => s.aimGuide.toUpperCase(), change: (d) => (s.aimGuide = cyc<'off' | 'short' | 'long'>(['off', 'short', 'long'], s.aimGuide, d)) },
      { label: 'BANTER BUBBLES', value: () => onOff(s.banter), change: () => (s.banter = !s.banter) },
      { label: 'SUDDEN DEATH', value: () => (s.suddenDeath ? `AFTER ROUND ${s.suddenDeath}` : 'OFF'), change: (d) => (s.suddenDeath = cyc([0, 8, 12, 16], s.suddenDeath, d)) },
      { label: 'EDGE SCROLL', value: () => onOff(s.edgeScroll), change: () => (s.edgeScroll = !s.edgeScroll) },
      { label: 'START!', value: () => '', start: true },
    ];
  }

  private rowIs(label: string): boolean {
    return this.screen === 'setup' && this.rows()[this.sel]?.label === label;
  }

  /** True while the team-name field has focus, so letter hotkeys are ignored. */
  get typing(): boolean {
    return this.screen === 'setup' && !!this.rows()[this.sel]?.text;
  }

  private mainItems(): string[] {
    return ['PLAY VS CPU', 'MATCH SETUP', 'HOTSEAT (2 PLAYERS)', 'WATCH CPU VS CPU', 'HOW TO PLAY'];
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.sel = 0;
    sfx.blip();
  }

  private start(mode?: Mode): FrontResult {
    if (mode) this.settings.mode = mode;
    saveSettings(this.settings);
    sfx.blip();
    return { start: { ...this.settings } };
  }

  click(sx: number, sy: number): FrontResult {
    for (const r of this.rects) {
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
        this.sel = r.i;
        return this.activate(1);
      }
    }
    if (this.screen === 'title' || this.screen === 'howto') return this.activate(1);
    return null;
  }

  private activate(dir: number): FrontResult {
    if (this.screen === 'title') {
      this.go('main');
      return null;
    }
    if (this.screen === 'howto') {
      this.go('main');
      return null;
    }
    if (this.screen === 'main') {
      switch (this.sel) {
        case 0:
          return this.start('cpu');
        case 1:
          this.go('setup');
          return null;
        case 2:
          return this.start('hotseat');
        case 3:
          return this.start('watch');
        case 4:
          this.go('howto');
          return null;
      }
      return null;
    }
    const row = this.rows()[this.sel]!;
    if (row.start) return this.start();
    if (row.change) {
      row.change(dir);
      sfx.blip();
      saveSettings(this.settings);
    }
    return null;
  }

  update(): FrontResult {
    const inp = this.input;
    this.t++;
    this.backdrop.update(0.3);
    if (sfx.ctx?.state === 'running') sfx.startMusic(this.theme.music);
    const lookX = VIEW_W / 2 + Math.sin(this.t * 0.02) * 200;
    for (const s of this.snakes) {
      s.lookX = lookX;
      s.lookY = 80 + Math.cos(this.t * 0.03) * 40;
      s.update(this.world);
    }
    if (this.t % 200 === 100) {
      const s = rng.pick(this.snakes);
      s.celebrate = 40;
      s.say(rng.pick(['turn', 'taunt', 'victory'] as const));
      this.bubbles = [{ s, text: line(rng.pick(['turn', 'hit', 'kill', 'miss'] as const), this.theme), life: 150 }];
    }
    for (const b of this.bubbles) b.life--;
    this.bubbles = this.bubbles.filter((b) => b.life > 0);
    if (!this.typing && inp.pressed('mute')) sfx.toggleMute();

    if (this.screen === 'setup' && this.rows()[this.sel]?.text) {
      const typed = inp.takeText();
      if (typed) this.settings.teamName = (this.settings.teamName + typed).slice(0, 14);
      if (inp.pressed('backflip')) this.settings.teamName = this.settings.teamName.slice(0, -1);
    } else inp.takeText();

    if (this.screen === 'title') {
      if (inp.pressed('confirm') || inp.pressed('fire') || inp.pressed('jump')) return this.activate(1);
      return null;
    }
    if (inp.pressed('back')) {
      if (this.screen === 'main') this.go('title');
      else {
        saveSettings(this.settings);
        this.go('main');
      }
      return null;
    }
    if (this.screen === 'howto') {
      if (inp.pressed('confirm') || inp.pressed('jump')) this.go('main');
      return null;
    }
    const n = this.screen === 'main' ? this.mainItems().length : this.rows().length;
    if (inp.pressed('up')) {
      this.sel = (this.sel + n - 1) % n;
      sfx.countTick();
    }
    if (inp.pressed('down')) {
      this.sel = (this.sel + 1) % n;
      sfx.countTick();
    }
    if (this.screen === 'setup') {
      if (inp.pressed('left')) return this.activate(-1);
      if (inp.pressed('right')) return this.activate(1);
      const row = this.rows()[this.sel]!;
      if (row.text) {
        if (inp.pressed('jump')) this.sel = (this.sel + 1) % n;
        return null;
      }
    }
    if (inp.pressed('confirm') || inp.pressed('jump')) return this.activate(1);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.rects = [];
    const bd = this.backdrop;
    bd.drawBack(ctx, WORLD_W / 2, 540, this.t);
    bd.drawWaterBack(ctx, WORLD_W / 2, 540, this.t);
    bd.drawWaterFront(ctx, WORLD_W / 2, 540, this.t);
    const cx = this.screen === 'setup' ? VIEW_W - 150 : VIEW_W / 2;
    this.drawIsland(ctx, cx);
    bd.drawWaterFrontLow(ctx, WORLD_W / 2, 540, this.t);
    this.snakes[0]!.x = cx - 34;
    this.snakes[1]!.x = cx + 34;
    for (const s of this.snakes) {
      ctx.save();
      ctx.translate(s.x, GROUND);
      ctx.scale(3, 3);
      ctx.translate(-s.x, -GROUND);
      s.draw(ctx, 0, 0);
      ctx.restore();
    }
    for (const b of this.bubbles) {
      const w = b.text.length * 6 + 8;
      const x = Math.round(Math.min(VIEW_W - w - 4, Math.max(4, b.s.x - w / 2)));
      const y = GROUND - 92;
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 1, y - 1, w + 2, 14);
      ctx.fillStyle = '#fffdf2';
      ctx.fillRect(x, y, w, 12);
      drawText(ctx, b.text, x + 4, y + 2, { color: '#1a1a1a', outline: null });
    }
    if (this.screen === 'title') this.drawTitle(ctx);
    else if (this.screen === 'main') this.drawMain(ctx);
    else if (this.screen === 'setup') this.drawSetup(ctx);
    else this.drawHowTo(ctx);
    bd.drawMotes(ctx);
    drawText(ctx, VERSION, VIEW_W - 6, VIEW_H - 12, { align: 'right', color: '#8888aa' });
  }

  private drawIsland(ctx: CanvasRenderingContext2D, cx: number): void {
    const th = this.theme;
    ctx.fillStyle = th.edge;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 34, 128, 36, 0, Math.PI, TAU);
    ctx.fill();
    ctx.fillStyle = th.soilDark;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 34, 126, 34, 0, Math.PI, TAU);
    ctx.fill();
    ctx.fillStyle = th.soilLight;
    ctx.beginPath();
    ctx.ellipse(cx - 10, GROUND + 30, 90, 22, 0, Math.PI, TAU);
    ctx.fill();
    ctx.fillStyle = th.grassDark;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 3, 112, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = th.grassLight;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 1, 108, 4, 0, 0, TAU);
    ctx.fill();
  }

  private drawTitle(ctx: CanvasRenderingContext2D): void {
    const letters = GAME_TITLE.split('');
    const scale = 7;
    const total = letters.length * 6 * scale;
    letters.forEach((ch, i) => {
      const bob = Math.sin(this.t * 0.06 + i * 0.7) * 4;
      const x = VIEW_W / 2 - total / 2 + i * 6 * scale + (6 * scale) / 2;
      drawText(ctx, ch, x + 4, 34 + bob, { scale, align: 'center', color: '#1a0d05', outline: null });
      drawText(ctx, ch, x, 30 + bob, { scale, align: 'center', color: i % 2 ? this.theme.grassLight : this.theme.teams[0].pattern, outline: null });
    });
    drawText(ctx, this.theme.blurb, VIEW_W / 2, 100, { align: 'center', color: '#ffd9c0' });
    if (this.t % 70 < 48) drawText(ctx, 'PRESS ENTER OR START', VIEW_W / 2, 124, { scale: 2, align: 'center' });
    if (sfx.ctx?.state !== 'running') drawText(ctx, 'CLICK OR PRESS ANY KEY FOR SOUND', VIEW_W / 2, 148, { align: 'center', color: '#9fd0ff' });
  }

  private drawMain(ctx: CanvasRenderingContext2D): void {
    drawText(ctx, GAME_TITLE, VIEW_W / 2, 18, { scale: 4, align: 'center', color: this.theme.grassLight });
    this.mainItems().forEach((item, i) => {
      const y = 70 + i * 22;
      const sel = i === this.sel;
      drawText(ctx, sel ? `> ${item} <` : item, VIEW_W / 2, y, { scale: 2, align: 'center', color: sel ? '#ffe14d' : '#ffffff' });
      this.rects.push({ x: VIEW_W / 2 - 140, y: y - 3, w: 280, h: 20, i });
    });
    const s = this.settings;
    drawText(ctx, `WORLD: ${s.theme === 'random' ? 'RANDOM' : THEMES[s.theme].name}   CPU: ${s.brain.toUpperCase()}   ${s.snakesPerTeam} SNAKES EACH`, VIEW_W / 2, 186, { align: 'center', color: '#c8c8e8' });
    drawText(ctx, 'ARROWS + ENTER OR CLICK.  ESC BACK.  M MUTE.  F FULLSCREEN', VIEW_W / 2, VIEW_H - 26, { align: 'center', color: '#9fa8c8' });
  }

  private drawSetup(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(6,8,24,0.72)';
    ctx.fillRect(10, 8, 360, VIEW_H - 16);
    drawText(ctx, 'MATCH SETUP', 190, 14, { scale: 2, align: 'center', color: '#ffe14d' });
    this.rows().forEach((row, i) => {
      const y = 38 + i * 21;
      const sel = i === this.sel;
      if (sel) {
        ctx.fillStyle = 'rgba(255,225,77,0.18)';
        ctx.fillRect(14, y - 4, 352, 17);
      }
      if (row.start) {
        drawText(ctx, sel ? '> START! <' : 'START!', 190, y - 1, { scale: 2, align: 'center', color: sel ? '#7dff7d' : '#ffffff' });
      } else {
        drawText(ctx, row.label, 20, y, { color: sel ? '#ffe14d' : '#9fb0d8' });
        const v = row.value();
        drawText(ctx, row.text ? v : `< ${v} >`, 360, y, { align: 'right', color: '#ffffff' });
      }
      this.rects.push({ x: 14, y: y - 4, w: 352, h: 17, i });
    });
    const row = this.rows()[this.sel]!;
    const tip = row.text ? 'TYPE A NAME. BACKSPACE DELETES. ENTER = NEXT.' : row.start ? 'ENTER TO PLAY' : 'LEFT/RIGHT OR CLICK TO CHANGE.  ESC BACK.';
    drawText(ctx, tip, 190, VIEW_H - 22, { align: 'center', color: '#c8c8e8' });
    drawText(ctx, this.theme.name, VIEW_W - 150, 40, { scale: 2, align: 'center', color: this.theme.grassLight });
    drawText(ctx, this.theme.teams[0].name, VIEW_W - 150, 66, { align: 'center', color: this.theme.teams[0].light });
    drawText(ctx, 'VS', VIEW_W - 150, 78, { align: 'center' });
    drawText(ctx, this.theme.teams[1].name, VIEW_W - 150, 90, { align: 'center', color: this.theme.teams[1].light });
  }

  private drawHowTo(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(6,8,24,0.82)';
    ctx.fillRect(20, 10, VIEW_W - 40, VIEW_H - 20);
    drawText(ctx, 'HOW TO PLAY', VIEW_W / 2, 18, { scale: 2, align: 'center', color: '#ffe14d' });
    const lines = [
      'TEAMS TAKE TURNS. ON YOUR TURN: MOVE, THEN ATTACK ONCE.',
      'AFTER YOU ATTACK YOU GET A FEW SECONDS TO RUN AWAY.',
      'THE WATER KILLS INSTANTLY. FALLS HURT. WIND PUSHES ROCKETS.',
      'LAST TEAM WITH SNAKES STANDING WINS.',
      '',
      'ARROWS: SLITHER + AIM     HOLD SPACE: POWER, RELEASE: FIRE',
      'ENTER: JUMP    BACKSPACE: BACKFLIP    1-5: GRENADE FUSE',
      'TAB OR RIGHT-CLICK: WEAPON MENU    Q/E: QUICK SWITCH',
      'TARGET WEAPONS: CLICK THE MAP (OR SPACE + ARROWS)',
      'MOUSE WHEEL / Z: ZOOM    WASD / DRAG / EDGES: LOOK AROUND',
      'C: CAMERA BACK    CLICK MINIMAP: JUMP THERE',
      'CPU TURN: HOLD SPACE TO FAST FORWARD    K: SCREENSHOT',
      '',
      'CRATES DROP FROM THE SKY. TOUCH THEM FOR LOOT OR HEALTH.',
      'SUPER WEAPONS UNLOCK AFTER A FEW ROUNDS (R3 = ROUND 3).',
      'SUDDEN DEATH: THE SEA RISES EVERY TURN. GET HIGH.',
    ];
    lines.forEach((l, i) => drawText(ctx, l, 36, 46 + i * 15, { color: l.startsWith('ARROWS') || l.includes(':') ? '#d8e8ff' : '#ffffff' }));
    drawText(ctx, 'ENTER OR ESC TO GO BACK', VIEW_W / 2, VIEW_H - 26, { align: 'center', color: '#ffe14d' });
  }
}
