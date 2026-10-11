// Makes a highlight cut of a recorded arena match: thinking periods play at 8x with an on-screen label.
// Usage: node scripts/highlights.mjs arena-logs/<match-folder>   (needs ffmpeg on PATH)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = process.argv[2];
const log = readFileSync(`${dir}/match.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/broadcast.mp4`], { encoding: 'utf8' });
const total = parseFloat(probe.stdout);
const starts = log.filter((e) => e.type === 'turn_start');
const fast = [];
for (const s of starts) {
  const end = log.find((e) => (e.type === 'commit' || e.type === 'turn_lost' || e.type === 'forfeit') && e.turn === s.turn && e.team === s.team);
  if (!end) continue;
  const a = s.ms / 1000 + 3, b = end.ms / 1000 - 1.5;
  if (b - a >= 6) fast.push([a, b]);
}
const segs = [];
let t = 0;
for (const [a, b] of fast) {
  if (a > t) segs.push({ a: t, b: a, f: 1 });
  segs.push({ a, b, f: 8 });
  t = b;
}
if (t < total) segs.push({ a: t, b: total, f: 1 });
const font = 'C\\:/Windows/Fonts/consolab.ttf';
const parts = [];
segs.forEach((s, i) => {
  const label = s.f > 1 ? `,drawtext=fontfile='${font}':text='>> THINKING  8X':fontsize=40:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=12:x=24:y=88` : '';
  parts.push(`[0:v]trim=${s.a.toFixed(3)}:${s.b.toFixed(3)},setpts=(PTS-STARTPTS)/${s.f}${label}[v${i}]`);
  const at = s.f > 1 ? ',atempo=2,atempo=2,atempo=2,volume=0.35' : '';
  parts.push(`[0:a]atrim=${s.a.toFixed(3)}:${s.b.toFixed(3)},asetpts=PTS-STARTPTS${at}[a${i}]`);
});
parts.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[v][a]`);
writeFileSync(`${dir}/_filter.txt`, parts.join(';\n'));
const out = `${dir}/highlights.mp4`;
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/broadcast.mp4`, '-filter_complex_script', `${dir}/_filter.txt`, '-map', '[v]', '-map', '[a]', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { encoding: 'utf8' });
unlinkSync(`${dir}/_filter.txt`);
console.log('segments', segs.length, 'fast windows', fast.length, 'exit', r.status, r.stderr.slice(0, 600));
const fastTime = fast.reduce((x, [a, b]) => x + (b - a), 0);
console.log(`real-time ${total.toFixed(1)}s -> highlight ~${(total - fastTime + fastTime / 8).toFixed(1)}s`);
