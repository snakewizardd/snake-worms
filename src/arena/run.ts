// Live-arena runtime for the browser (broadcast canvas, recorder, controller wiring).
// Loaded only under `npm run arena`; the static build never contains it.
import type { Game } from '../game.ts';
import type { Settings } from '../settings.ts';
import { sfx } from '../audio.ts';
import { ArenaController } from './controller.ts';
import { Broadcast, BH, BW } from './broadcast.ts';
import { Recorder } from './recorder.ts';
import { WsLink } from './wsLink.ts';

interface ArenaRun {
  ctl: ArenaController;
  link: WsLink;
  cast: Broadcast;
  rec: Recorder | null;
  overAt: number;
  closing: boolean;
}

let run: ArenaRun | null = null;
let gameCanvas: HTMLCanvasElement | null = null;
const bcanvas = document.createElement('canvas');
bcanvas.width = BW;
bcanvas.height = BH;
bcanvas.style.display = 'none';
bcanvas.style.imageRendering = 'pixelated';
document.body.appendChild(bcanvas);
const bctx = bcanvas.getContext('2d')!;

export function resizeBroadcast(): void {
  const bf = Math.min(window.innerWidth / BW, window.innerHeight / BH);
  bcanvas.style.width = `${Math.floor(BW * bf)}px`;
  bcanvas.style.height = `${Math.floor(BH * bf)}px`;
}

function show(on: boolean): void {
  bcanvas.style.display = on ? 'block' : 'none';
  if (gameCanvas) gameCanvas.style.display = on ? 'none' : 'block';
  resizeBroadcast();
}

function matchId(s: Settings): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${slug(s.arena!.a.label)}-vs-${slug(s.arena!.b.label)}`;
}

export function active(): boolean {
  return !!run;
}

/** True while a match is running (exit is blocked until it is saved). */
export function blocking(): boolean {
  return !!run && !run.ctl.ended;
}

export function leave(): void {
  show(false);
  run = null;
}

export function begin(g: Game, s: Settings, canvas: HTMLCanvasElement): void {
  gameCanvas = canvas;
  const link = new WsLink();
  const ctl = new ArenaController(g, link, s.arena!, matchId(s));
  const cast = new Broadcast();
  const r: ArenaRun = { ctl, link, cast, rec: null, overAt: 0, closing: false };
  run = r;
  (window as unknown as { arena: ArenaRun }).arena = r;
  window.addEventListener('beforeunload', (e) => {
    if (run === r && !r.closing) e.preventDefault();
  });
  show(true);
  g.holdClock = true;
  ctl
    .start()
    .then(() => {
      if (s.arena!.record) {
        const rec = new Recorder();
        if (rec.start(bcanvas, sfx.captureStream(), (b, done) => link.sendVideo(b, done))) {
          r.rec = rec;
          cast.recording = true;
        }
      }
      g.holdClock = false;
    })
    .catch((e: unknown) => {
      ctl.fail(String((e as Error).message ?? e));
      cast.savedNote = 'COULD NOT START: SEE PLAY-BY-PLAY';
    });
}

export function tick(g: Game): void {
  const r = run;
  if (!r) return;
  r.ctl.update();
  if (g.phase !== 'over' || !r.ctl.ended || r.closing) return;
  if (!r.overAt) r.overAt = performance.now();
  // Keep recording the victory screen for a few seconds, then finalize the video.
  if (performance.now() - r.overAt < 7000) return;
  r.closing = true;
  r.cast.savedNote = 'SAVING VIDEO...';
  const done = (): void => {
    r.cast.recording = false;
    r.cast.savedNote = r.ctl.savedDir ? `SAVED: ARENA-LOGS/${r.ctl.matchId.toUpperCase()}` : 'MATCH LOG SAVED';
  };
  if (r.rec) void r.rec.stop().then(done, done);
  else done();
}

export function draw(g: Game, canvas: HTMLCanvasElement): void {
  if (run) run.cast.draw(bctx, canvas, g, run.ctl);
}
