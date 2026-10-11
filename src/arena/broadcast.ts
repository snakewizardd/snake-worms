// 1920x1080 broadcast layout for live clanker matches: battlefield + one card per model + play-by-play.
// This canvas is what gets recorded, so everything the models do is captured on video.
import { drawText } from '../font.ts';
import type { Game } from '../game.ts';
import type { ArenaController, ClankerStats, FeedLine } from './controller.ts';

export const BW = 1920;
export const BH = 1080;
const GAME = { x: 0, y: 60, w: 1280, h: 720 };
const CARD_X = 1280;
const CARD_W = 640;
const CARD_H = 360;
const FEED_Y = 780;

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fit(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}~` : text;
}

function wrap(text: string, chars: number, max: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > chars) {
      if (cur) out.push(cur);
      cur = w;
      if (out.length >= max) break;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur && out.length < max) out.push(cur);
  return out;
}

function kfmt(v: number): string {
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));
}

const KIND_COLOR: Record<string, string> = {
  oracle: '#9fd0ff',
  commit: '#ffe14d',
  outcome: '#ffffff',
  taunt: '#ffb0e0',
  reasoning: '#b9a6ff',
  message: '#d8e8ff',
  intent: '#b9a6ff',
  move: '#9fffb0',
  forfeit: '#ff6a6a',
  error: '#ff6a6a',
  turn: '#ffe14d',
  system: '#7dff7d',
};

export class Broadcast {
  recording = false;
  savedNote = '';

  draw(ctx: CanvasRenderingContext2D, gameCanvas: HTMLCanvasElement, g: Game, arena: ArenaController): void {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07081a';
    ctx.fillRect(0, 0, BW, BH);
    this.header(ctx, g, arena);
    ctx.drawImage(gameCanvas, 0, 0, gameCanvas.width, gameCanvas.height, GAME.x, GAME.y, GAME.w, GAME.h);
    ctx.fillStyle = '#000';
    ctx.fillRect(GAME.x + GAME.w, GAME.y, 4, GAME.h);
    for (const i of [0, 1] as const) this.card(ctx, g, arena, i, CARD_X + 4, GAME.y + i * CARD_H);
    this.feed(ctx, g, arena);
  }

  private header(ctx: CanvasRenderingContext2D, g: Game, a: ArenaController): void {
    ctx.fillStyle = '#10132e';
    ctx.fillRect(0, 0, BW, 60);
    ctx.fillStyle = '#2a2f66';
    ctx.fillRect(0, 58, BW, 2);
    drawText(ctx, 'SNAKES', 16, 12, { scale: 4, color: g.theme.grassLight });
    drawText(ctx, 'LIVE CLANKER ARENA', 190, 22, { scale: 2, color: '#ffe14d' });
    const [ta, tb] = g.teams;
    const left = a.stats[0].label;
    const right = a.stats[1].label;
    const mid = BW / 2 - 80;
    drawText(ctx, left, mid - 30, 16, { scale: 3, color: ta!.def.light, align: 'right' });
    drawText(ctx, 'VS', mid, 16, { scale: 3, color: '#ffffff', align: 'center' });
    drawText(ctx, right, mid + 30, 16, { scale: 3, color: tb!.def.light });
    const wind = g.wind === 0 ? 'CALM' : `${g.wind < 0 ? '<' : '>'}${Math.abs(g.wind).toFixed(2)}`;
    const credits = (a.stats[0].usage.nanoAiu + a.stats[1].usage.nanoAiu) / 1e9;
    const cap = a.setup.costCap ? `/${a.setup.costCap}` : '';
    drawText(ctx, `TURN ${g.turnCount}  ROUND ${g.round}  WIND ${wind}  CREDITS ${credits.toFixed(1)}${cap}  ${clock(a.elapsedMs)}`, BW - 16, 10, { scale: 2, align: 'right', color: '#c8d0ff' });
    if (this.recording) {
      const on = Math.floor(a.elapsedMs / 600) % 2 === 0;
      ctx.fillStyle = on ? '#ff3030' : '#661010';
      ctx.beginPath();
      ctx.arc(BW - 120, 42, 7, 0, Math.PI * 2);
      ctx.fill();
      drawText(ctx, 'REC', BW - 106, 34, { scale: 2, color: '#ff8080' });
    }
    if (this.savedNote) drawText(ctx, fit(this.savedNote, 70), BW - 140, 34, { scale: 2, align: 'right', color: '#7dff7d' });
    else drawText(ctx, `${g.theme.name}  SEED ${g.seed}`, BW - 140, 34, { scale: 2, align: 'right', color: '#7f86b8' });
  }

  private card(ctx: CanvasRenderingContext2D, g: Game, a: ArenaController, i: 0 | 1, x: number, y: number): void {
    const team = g.teams[i]!;
    const st: ClankerStats = a.stats[i];
    const active = g.active?.team === team && g.phase !== 'over';
    ctx.fillStyle = active ? '#161a3d' : '#0d1030';
    ctx.fillRect(x, y, CARD_W - 4, CARD_H - 4);
    ctx.fillStyle = team.def.color;
    ctx.fillRect(x, y, CARD_W - 4, 6);
    if (active) {
      ctx.strokeStyle = team.def.light;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, CARD_W - 6, CARD_H - 6);
    }
    let yy = y + 14;
    drawText(ctx, fit(st.label, 30), x + 14, yy, { scale: 3, color: team.def.light });
    drawText(ctx, st.provider === 'mock' ? 'MOCK' : st.model.toUpperCase(), x + CARD_W - 18, yy + 4, { scale: 2, color: '#7f86b8', align: 'right' });
    yy += 30;
    drawText(ctx, team.def.name === st.label ? `TEAM ${i === 0 ? 'A' : 'B'}` : team.def.name, x + 14, yy, { scale: 2, color: team.def.color });
    yy += 22;

    let status = st.status;
    let statusColor = '#9aa0c8';
    if (active && g.thinking && g.thinking.team === team) {
      const secs = Math.floor((g.tick - g.thinking.since) / 60);
      const dots = '.'.repeat(1 + (Math.floor(g.tick / 15) % 3));
      status = `${g.thinking.status} ${secs}S${dots}`;
      statusColor = '#ffe14d';
    } else if (active && st.status === 'EXECUTING') statusColor = '#7dff7d';
    if (g.phase === 'over') {
      const won = g.winner === team;
      status = won ? 'WINNER' : g.winner ? 'DEFEATED' : 'DRAW';
      statusColor = won ? '#7dff7d' : '#ff8080';
    }
    drawText(ctx, status, x + 14, yy, { scale: 3, color: statusColor });
    yy += 30;

    for (const s of team.snakes) {
      const w = 220;
      const hp = s.alive ? s.displayHp : 0;
      const frac = Math.max(0, Math.min(1, hp / Math.max(1, g.settings.startHp)));
      drawText(ctx, fit(s.name, 16), x + 14, yy, { scale: 2, color: s.alive ? '#ffffff' : '#666a88' });
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 220, yy - 1, w + 2, 16);
      ctx.fillStyle = s.alive ? team.def.color : '#333';
      ctx.fillRect(x + 221, yy, Math.round(w * frac), 14);
      drawText(ctx, s.alive ? String(hp) : s.drownT > 0 ? 'DROWNED' : 'DEAD', x + 452, yy, { scale: 2, color: s.alive ? '#ffffff' : '#ff8080' });
      if (s === g.active) drawText(ctx, '<', x + 540, yy, { scale: 2, color: '#ffe14d' });
      yy += 20;
    }
    yy += 4;
    const avg = st.turns ? st.thinkMs / Math.max(1, st.turns - (active && g.thinking ? 1 : 0)) : 0;
    drawText(ctx, `TURNS ${st.turns}  ${a.style === 'player' ? 'AIM CHECKS' : 'ORACLE'} ${st.oracleCalls}  MOVES ${st.moves}  FORFEITS ${st.forfeits}`, x + 14, yy, { scale: 2, color: '#c8d0ff' });
    yy += 20;
    drawText(ctx, `AVG THINK ${(avg / 1000).toFixed(1)}S  TOKENS ${kfmt(st.usage.inputTokens)} IN ${kfmt(st.usage.outputTokens)} OUT`, x + 14, yy, { scale: 2, color: '#c8d0ff' });
    yy += 20;
    drawText(ctx, `MODEL CALLS ${st.usage.calls}  AI CREDITS ${(st.usage.nanoAiu / 1e9).toFixed(2)}`, x + 14, yy, { scale: 2, color: '#c8d0ff' });
    yy += 24;
    if (st.lastDecision) {
      drawText(ctx, fit(`LAST: ${st.lastDecision}`, 50), x + 14, yy, { scale: 2, color: '#ffe14d' });
      yy += 20;
    }
    if (st.lastTaunt) {
      drawText(ctx, fit(`"${st.lastTaunt}"`, 50), x + 14, yy, { scale: 2, color: '#ffb0e0' });
      yy += 20;
    }
    const room = Math.max(0, Math.floor((y + CARD_H - 12 - yy) / 18));
    const lines = st.lastThought ? wrap(st.lastThought, 52, room) : [];
    lines.forEach((l, k) => drawText(ctx, l, x + 14, yy + k * 18, { scale: 2, color: '#a8a0e0' }));
  }

  private feed(ctx: CanvasRenderingContext2D, g: Game, a: ArenaController): void {
    ctx.fillStyle = '#0a0c24';
    ctx.fillRect(0, FEED_Y, BW, BH - FEED_Y);
    ctx.fillStyle = '#2a2f66';
    ctx.fillRect(0, FEED_Y, BW, 2);
    drawText(ctx, 'PLAY-BY-PLAY', 16, FEED_Y + 10, { scale: 2, color: '#ffe14d' });
    drawText(ctx, a.style === 'player' ? 'REAL PLAYER MODE: NO AUTO-AIM. EVERY AIM CHECK, MOVE, SHOT AND RESULT' : 'EVERY TOOL CALL, PREDICTION, DECISION AND RESULT', 200, FEED_Y + 10, { scale: 2, color: '#59609a' });
    const lines: FeedLine[] = a.feed.slice(-11);
    lines.forEach((l, k) => {
      const yy = FEED_Y + 38 + k * 23;
      const team = l.team === null ? null : g.teams[l.team]!;
      drawText(ctx, clock(l.ms), 16, yy, { scale: 2, color: '#59609a' });
      const who = team ? (l.team === 0 ? a.stats[0].label : a.stats[1].label) : 'ARENA';
      drawText(ctx, fit(who, 18), 100, yy, { scale: 2, color: team ? team.def.light : '#7dff7d' });
      drawText(ctx, fit(l.text, 132), 330, yy, { scale: 2, color: KIND_COLOR[l.kind] ?? '#ffffff' });
    });
  }
}
