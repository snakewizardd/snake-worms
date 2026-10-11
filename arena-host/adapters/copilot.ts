// Live model player through the GitHub Copilot SDK (same runtime as Copilot CLI, using the signed-in account).
import { mkdirSync } from 'node:fs';
import { CopilotClient, ToolSet, defineTool } from '@github/copilot-sdk';
import type { CopilotSession, ModelInfo, PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';
import type { PlayerSpec, ToolExec, TurnResult, Usage } from '../../src/arena/link.ts';
import { addUsage, emptyUsage } from '../../src/arena/link.ts';
import { ARENA_TOOL_NAMES } from '../../src/arena/schema.ts';
import type { ToolSchema } from '../../src/arena/schema.ts';
import type { Adapter, ActivitySink } from './types.ts';

let shared: Promise<CopilotClient> | null = null;

/** One runtime process for all arena sessions. */
export function copilotClient(): Promise<CopilotClient> {
  if (!shared) {
    shared = (async () => {
      const c = new CopilotClient({ logLevel: 'error' });
      await c.start();
      return c;
    })();
    shared.catch(() => (shared = null));
  }
  return shared;
}

export async function stopCopilot(): Promise<void> {
  if (!shared) return;
  const c = await shared.catch(() => null);
  shared = null;
  if (c) await c.stop().catch(() => []);
}

export async function listCopilotModels(): Promise<ModelInfo[]> {
  const c = await copilotClient();
  return c.listModels();
}

export class CopilotAdapter implements Adapter {
  private session: CopilotSession | null = null;
  private exec: ToolExec | null = null;
  private act: ActivitySink | null = null;
  private turnUsage: Usage = emptyUsage();
  private lastReasoning = '';
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  async start(p: PlayerSpec, tools: ToolSchema[]): Promise<void> {
    mkdirSync(this.stateDir, { recursive: true });
    const client = await copilotClient();
    const gameTools = tools.map((t) =>
      defineTool(t.name, {
        description: t.description,
        parameters: t.parameters,
        skipPermission: true,
        handler: async (args: unknown) => (this.exec ? await this.exec(t.name, (args ?? {}) as Record<string, unknown>) : { error: 'It is not your turn.' }),
      }),
    );
    this.session = await client.createSession({
      model: p.model,
      ...(p.effort ? { reasoningEffort: p.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      systemMessage: { mode: 'replace', content: p.system },
      tools: gameTools,
      // Hard membrane: only our custom SNAKES tools exist in this session.
      availableTools: new ToolSet().addCustom('*'),
      enableConfigDiscovery: false,
      enableSessionStore: false,
      enableSkills: false,
      workingDirectory: this.stateDir,
      onPermissionRequest: (req: PermissionRequest): PermissionRequestResult => {
        const r = req as unknown as { kind: string; toolName?: string };
        if (r.kind === 'custom-tool' && r.toolName && ARENA_TOOL_NAMES.has(r.toolName)) return { kind: 'approve-once' };
        return { kind: 'reject', feedback: 'Only SNAKES game tools exist in this arena.' };
      },
    });
    this.session.on((ev) => {
      const act = this.act;
      const e = ev as unknown as { type: string; data: Record<string, unknown> };
      const reasoning = (text: string): void => {
        const t = text.trim();
        if (!t || t === this.lastReasoning) return;
        this.lastReasoning = t;
        act?.({ kind: 'reasoning', text: t });
      };
      switch (e.type) {
        case 'assistant.message': {
          const text = String(e.data.content ?? '');
          if (typeof e.data.reasoningText === 'string') reasoning(e.data.reasoningText);
          if (text.trim()) act?.({ kind: 'message', text });
          break;
        }
        case 'assistant.reasoning':
          reasoning(String(e.data.content ?? ''));
          break;
        case 'assistant.intent':
          act?.({ kind: 'intent', text: String(e.data.intent ?? '') });
          break;
        case 'assistant.usage': {
          const d = e.data as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cost?: number; copilotUsage?: { totalNanoAiu?: number } };
          const u: Usage = { calls: 1, inputTokens: d.inputTokens ?? 0, outputTokens: d.outputTokens ?? 0, cacheReadTokens: d.cacheReadTokens ?? 0, cost: d.cost ?? 0, nanoAiu: d.copilotUsage?.totalNanoAiu ?? 0 };
          this.turnUsage = addUsage(this.turnUsage, u);
          act?.({ kind: 'usage', text: '', usage: u });
          break;
        }
        case 'session.error':
          act?.({ kind: 'error', text: JSON.stringify(e.data).slice(0, 300) });
          break;
      }
    });
  }

  async turn(prompt: string, exec: ToolExec, timeoutMs: number, onActivity: ActivitySink): Promise<TurnResult> {
    const s = this.session;
    const t0 = Date.now();
    if (!s) return { ok: false, error: 'session not started', usage: emptyUsage(), ms: 0 };
    this.exec = exec;
    this.act = onActivity;
    this.turnUsage = emptyUsage();
    this.aborted = false;
    try {
      const msg = await s.sendAndWait({ prompt }, timeoutMs);
      const text = (msg as unknown as { data?: { content?: string } } | undefined)?.data?.content ?? '';
      return { ok: true, text, usage: this.turnUsage, ms: Date.now() - t0 };
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (this.aborted) return { ok: true, text: '(stopped: turn already over)', usage: this.turnUsage, ms: Date.now() - t0 };
      const timedOut = /time ?out|timed out/i.test(m) || Date.now() - t0 >= timeoutMs - 50;
      if (timedOut) await s.abort().catch(() => {});
      return { ok: false, timedOut, error: m.slice(0, 300), usage: this.turnUsage, ms: Date.now() - t0 };
    } finally {
      this.exec = null;
      this.act = null;
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
    if (this.session) await this.session.abort().catch(() => {});
  }

  private aborted = false;

  async stop(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (!s) return;
    const id = s.sessionId;
    await s.disconnect().catch(() => {});
    const c = await copilotClient().catch(() => null);
    // Arena sessions are throwaway; remove them from the user's Copilot session list.
    if (c) await c.deleteSession(id).catch(() => {});
  }
}
