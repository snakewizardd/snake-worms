// Turns match.jsonl into a human-readable, turn-by-turn report of how each model played.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Entry = Record<string, unknown> & { type: string };

const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
const fmtMs = (ms: number): string => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const clip = (s: unknown, max = 400): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const esc = (s: string): string => s.replace(/\|/g, '\\|');

function argsShort(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  return Object.entries(a as Record<string, unknown>)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : typeof v === 'number' ? Math.round(v * 100) / 100 : v}`)
    .join(' ');
}

function resultShort(name: string, r: unknown): string {
  if (!r || typeof r !== 'object') return clip(r, 160);
  const o = r as Record<string, unknown>;
  if (o.error) return `ERROR: ${clip(o.error, 160)}`;
  const eff = (x: unknown): string =>
    Array.isArray(x) && x.length
      ? (x as Array<Record<string, unknown>>).map((e) => `${e.snake}${e.side === 'enemy' ? '' : `(${e.side})`} ${e.drowns ? 'DROWNS' : `-${e.damage}`}${e.kills && !e.drowns ? ' KILL' : ''}`).join(', ')
      : 'no damage';
  if (name === 'find_shots') {
    const c = (o.candidates as Array<Record<string, unknown>>) ?? [];
    if (!c.length) return clip(o.note ?? 'no candidates', 160);
    return c.slice(0, 3).map((x, i) => `#${i + 1} ${x.weapon} ${x.facing} ${x.elevation_deg ?? ''}${x.elevation_deg !== undefined ? '°' : ''} ${x.power !== undefined ? `${Math.round(n(x.power) * 100)}%` : ''} → ${eff((x.predicted as Record<string, unknown>)?.effects)}`).join('; ');
  }
  if (name === 'simulate') return `${eff(o.effects)}${o.note ? ` (${clip(o.note, 80)})` : ''}`;
  if (name === 'aim_guide') return `guide ${clip(o.guide_ends, 140)}`;
  if (name === 'move' || name === 'jump') return o.ok ? `now at (${o.x}, ${o.y})${o.note ? `, ${o.note}` : ''}` : clip(o.error, 160);
  if (name === 'attack' || name === 'skip_turn') return `committed: ${o.committed}`;
  if (name === 'taunt') return `"${o.shown}"`;
  if (name === 'get_state') return 'full state returned';
  return clip(JSON.stringify(o), 160);
}

export function writeReport(dir: string): string {
  const entries: Entry[] = readFileSync(join(dir, 'match.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Entry);
  const start = entries.find((e) => e.type === 'match_start') as Entry | undefined;
  const end = entries.find((e) => e.type === 'match_end') as Entry | undefined;
  const players = ((end?.players as Array<Record<string, unknown>>) ?? []).length
    ? (end!.players as Array<Record<string, unknown>>)
    : (((start?.setup as Record<string, unknown>) ? [(start!.setup as Record<string, Record<string, unknown>>).a, (start!.setup as Record<string, Record<string, unknown>>).b] : []) as Array<Record<string, unknown>>);
  const label = (t: unknown): string => String(players[n(t)]?.label ?? `TEAM ${n(t)}`);
  const player = start?.style === 'player';
  const worlds: Record<string, string> = { island: 'Tropical Island', medieval: 'Medieval Times', acc: 'Accelerationist' };
  const out: string[] = [];
  out.push(`# SNAKES · Live Clanker Arena`);
  out.push(`## ${label(0)} vs ${label(1)}`);
  out.push('');
  if (player) out.push('> **Real Player Mode.** Both models played like human players: they saw the map, positions, wind and the in-game aim-guide arc, knew the game\'s physics rules, and chose every angle and power themselves. No auto-aim, no damage previews, no solver.', '');
  if (end) {
    out.push(`**Result:** ${end.winner ? `🏆 **${end.winner}** wins` : 'No winner'} — ${end.reason}`);
    out.push(`**Length:** ${end.turns} turns · ${fmtMs(n(end.durationMs))} real time`);
    const surv = (end.survivors as Array<Record<string, unknown>>) ?? [];
    if (surv.length) out.push(`**Survivors:** ${surv.map((s) => `${s.name} (${s.team}, ${s.hp} HP)`).join(', ')}`);
  } else out.push('**Result:** match did not finish (log ends early).');
  if (start) out.push(`**World:** ${worlds[String(start.theme)] ?? start.theme} · seed ${start.seed}`);
  out.push('');
  if (players.length) {
    out.push('### Scoreboard');
    out.push('');
    out.push('| | ' + players.map((p) => `**${p.label}**`).join(' | ') + ' |');
    out.push('|---|' + players.map(() => '---').join('|') + '|');
    const row = (name: string, f: (p: Record<string, unknown>) => string): void => {
      out.push(`| ${name} | ${players.map((p) => esc(f(p))).join(' | ')} |`);
    };
    row('Model id', (p) => `\`${p.model}\``);
    row('Turns played', (p) => String(p.turns ?? '-'));
    row(player ? 'Aim-guide checks' : 'Oracle calls (find_shots + simulate)', (p) => String(p.oracleCalls ?? '-'));
    row('Moves / jumps', (p) => String(p.moves ?? '-'));
    row('Forfeited turns', (p) => String(p.forfeits ?? '-'));
    row('Runtime errors', (p) => String(p.errors ?? '-'));
    row('Avg think time / turn', (p) => (p.avgThinkMs ? fmtMs(n(p.avgThinkMs)) : '-'));
    const u = (p: Record<string, unknown>): Record<string, unknown> => (p.usage as Record<string, unknown>) ?? {};
    row('Model API calls', (p) => String(u(p).calls ?? '-'));
    row('Input / output tokens', (p) => `${n(u(p).inputTokens).toLocaleString()} / ${n(u(p).outputTokens).toLocaleString()}`);
    row('Cached input tokens', (p) => n(u(p).cacheReadTokens).toLocaleString());
    row('Premium-request units', (p) => (Math.round(n(u(p).cost) * 100) / 100).toString());
    row('**AI credits used**', (p) => `**${(n(u(p).nanoAiu) / 1e9).toFixed(2)}**`);
    out.push('');
    const total = players.reduce((a, p) => a + n(u(p).nanoAiu), 0) / 1e9;
    out.push(`**Total AI credits for the match:** ${total.toFixed(2)}`);
    out.push('');
  }

  out.push('### Turn by turn');
  out.push('');
  let cur: { team: number; lines: string[] } | null = null;
  const flush = (): void => {
    if (cur) out.push(...cur.lines, '');
    cur = null;
  };
  for (const e of entries) {
    switch (e.type) {
      case 'turn_start': {
        flush();
        cur = { team: n(e.team), lines: [] };
        cur.lines.push(`#### Turn ${e.turn} — ${label(e.team)} plays ${e.snake}`);
        const p = String(e.prompt ?? '');
        const since = p.split('OBSERVATION:')[0]!.split('\n').filter((l) => l.startsWith('- Turn'));
        if (since.length) cur.lines.push(`*It was told:* ${since.map((l) => clip(l.slice(2), 220)).join(' / ')}`);
        break;
      }
      case 'activity': {
        if (!cur || n(e.team) !== cur.team) break;
        if (e.kind === 'reasoning') cur.lines.push(`> 🧠 *reasoning summary:* ${clip(e.text, 600)}`);
        else if (e.kind === 'message') cur.lines.push(`> 💬 ${clip(e.text, 600)}`);
        else if (e.kind === 'intent') cur.lines.push(`> 🎯 *intent:* ${clip(e.text, 200)}`);
        else if (e.kind === 'error') cur.lines.push(`> ⚠️ runtime error: ${clip(e.text, 300)}`);
        break;
      }
      case 'tool': {
        if (!cur) break;
        const icon = e.name === 'attack' ? '🎯' : e.name === 'find_shots' ? '🔭' : e.name === 'simulate' ? '🧪' : e.name === 'aim_guide' ? '📐' : e.name === 'move' || e.name === 'jump' ? '🐍' : e.name === 'taunt' ? '🗯️' : e.name === 'skip_turn' ? '⏭️' : '📋';
        cur.lines.push(`- ${icon} \`${e.name}\` ${esc(argsShort(e.args))} → ${resultShort(String(e.name), e.result)}`);
        break;
      }
      case 'commit':
        if (cur) cur.lines.push(`- **Decision:** ${e.decision} *(after ${fmtMs(n(e.thinkMsSoFar))})*`);
        break;
      case 'turn_lost':
        if (cur) cur.lines.push(`- **Turn lost:** ${e.decision}`);
        break;
      case 'forfeit':
        if (cur) cur.lines.push(`- **Forfeited:** ${e.why}`);
        break;
      case 'turn_end': {
        if (!cur) break;
        const u = (e.usage as Record<string, unknown>) ?? {};
        cur.lines.push(`- *Think time ${fmtMs(n(e.ms))} · ${n(u.calls)} model calls · ${n(u.inputTokens).toLocaleString()} in / ${n(u.outputTokens).toLocaleString()} out tokens · cost ${Math.round(n(u.cost) * 100) / 100}${e.ok ? '' : ` · ${e.timedOut ? 'TIMED OUT' : `error: ${clip(e.error, 120)}`}`}*`);
        break;
      }
      case 'outcome': {
        const line = `- **Result:** ${e.outcome}${e.landed ? ` · *${e.landed}*` : ''}`;
        if (cur && cur.team === n(e.team)) cur.lines.push(line);
        else out.push(`*(result of turn ${e.turnOf}: ${e.outcome})*`, '');
        break;
      }
    }
  }
  flush();
  if (start) {
    out.push('### Rules and prompts both models received');
    out.push('');
    const sp = (start.systemPrompts as string[]) ?? [];
    sp.forEach((p, i) => {
      out.push(`<details><summary>System prompt for ${label(i)}</summary>`, '', '```text', p, '```', '', '</details>', '');
    });
  }
  out.push('---');
  out.push('*Generated from `match.jsonl`, which contains every observation, tool call, tool result, decision, outcome and usage event in full.*');
  const md = out.join('\n');
  const file = join(dir, 'report.md');
  writeFileSync(file, md);
  return file;
}
