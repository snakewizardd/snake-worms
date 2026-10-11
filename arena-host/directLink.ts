// In-process link for headless runs (tests and terminal matches): the game and the host share one Node process.
import type { Activity, ClankerLink, MatchInfo, ToolExec, TurnResult } from '../src/arena/link.ts';
import type { ArenaHost } from './host.ts';

export class DirectLink implements ClankerLink {
  onActivity: ((a: Activity) => void) | null = null;
  private matchId = '';
  dir = '';
  private readonly host: ArenaHost;

  constructor(host: ArenaHost) {
    this.host = host;
  }

  async startMatch(info: MatchInfo): Promise<void> {
    this.matchId = info.matchId;
    this.dir = await this.host.start(info);
  }

  playTurn(team: 0 | 1, prompt: string, exec: ToolExec, timeoutMs: number): Promise<TurnResult> {
    return this.host.turn(this.matchId, team, prompt, timeoutMs, exec, (a) => this.onActivity?.(a));
  }

  log(entry: Record<string, unknown>): void {
    this.host.log(this.matchId, entry);
  }

  abort(team: 0 | 1): void {
    void this.host.abort(this.matchId, team);
  }

  async endMatch(summary: Record<string, unknown>): Promise<{ dir?: string }> {
    return { dir: await this.host.end(this.matchId, summary) };
  }
}
