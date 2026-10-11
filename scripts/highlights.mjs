// Makes a highlight cut of a recorded arena match: thinking/aiming/waiting stretches play fast with an
// on-screen label; every shot, explosion and taunt stays at normal speed.
// Usage: node scripts/highlights.mjs arena-logs/<match-folder>   (needs ffmpeg on PATH)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/highlights.mjs arena-logs/<match-folder>');
  process.exit(1);
}
const log = readFileSync(`${dir}/match.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/broadcast.mp4`], { encoding: 'utf8' });
const total = parseFloat(probe.stdout);
const starts = log.filter((e) => e.type === 'turn_start');
const endMs = (log.find((e) => e.type === 'match_end') ?? { ms: total * 1000 }).ms;
const label = (e) => (e.human ? 'YOU' : String(e.model ?? '').toUpperCase());

/** [from, to, speed, text] in seconds of the recording. */
const fast = [];
const add = (a, b, f, text) => {
  if (b - a >= 6) fast.push([a, b, f, text]);
};
starts.forEach((s, i) => {
  const t0 = s.ms / 1000;
  const next = (i + 1 < starts.length ? starts[i + 1].ms : endMs) / 1000;
  if (s.human) {
    // The human's aiming/walking speeds up; the last 15 s (shot + aftermath) stays real time.
    add(t0 + 2, next - 15, 3, 'YOU, AIMING  3X');
    return;
  }
  const end = log.find((e) => (e.type === 'commit' || e.type === 'turn_lost' || e.type === 'forfeit') && e.turn === s.turn && e.team === s.team);
  if (!end) return;
  add(t0 + 3, end.ms / 1000 - 1.5, 8, `${label(s)} THINKING  8X`);
  add(end.ms / 1000 + 10, next - 2, 4, 'FAST FORWARD  4X');
});
fast.sort((x, y) => x[0] - y[0]);

const segs = [];
let t = 0;
for (const [a, b, f, text] of fast) {
  if (a < t) continue;
  if (a > t) segs.push({ a: t, b: a, f: 1 });
  segs.push({ a, b, f, text });
  t = b;
}
if (t < total) segs.push({ a: t, b: total, f: 1 });

const tempo = (f) => {
  const parts = [];
  let r = f;
  while (r > 2.0001) {
    parts.push('atempo=2');
    r /= 2;
  }
  if (r > 1.0001) parts.push(`atempo=${r.toFixed(4)}`);
  return parts.join(',');
};
const font = 'C\\:/Windows/Fonts/consolab.ttf';
const parts = [];
segs.forEach((s, i) => {
  const text = s.f > 1 ? `,drawtext=fontfile='${font}':text='>> ${s.text.replace(/[':]/g, '')}':fontsize=40:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=12:x=24:y=88` : '';
  parts.push(`[0:v]trim=${s.a.toFixed(3)}:${s.b.toFixed(3)},setpts=(PTS-STARTPTS)/${s.f}${text}[v${i}]`);
  parts.push(`[0:a]atrim=${s.a.toFixed(3)}:${s.b.toFixed(3)},asetpts=PTS-STARTPTS${s.f > 1 ? `,${tempo(s.f)},volume=0.35` : ''}[a${i}]`);
});
parts.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[v][a]`);
writeFileSync(`${dir}/_filter.txt`, parts.join(';\n'));
const out = `${dir}/highlights.mp4`;
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/broadcast.mp4`, '-filter_complex_script', `${dir}/_filter.txt`, '-map', '[v]', '-map', '[a]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { encoding: 'utf8' });
unlinkSync(`${dir}/_filter.txt`);
const saved = fast.reduce((x, [a, b, f]) => x + (b - a) * (1 - 1 / f), 0);
console.log(`segments ${segs.length}, fast windows ${fast.length}, ffmpeg exit ${r.status} ${r.stderr.slice(0, 400)}`);
console.log(`real-time ${total.toFixed(1)}s -> highlight ~${(total - saved).toFixed(1)}s`);
