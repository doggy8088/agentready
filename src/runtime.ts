/**
 * AgentReady — runtime adapter.
 * Registers tools with the browser's WebMCP surface (document.modelContext)
 * when available, and always maintains an in-page registry with an identical
 * getTools/executeTool shape so in-page agents (e.g. AskPage) and non-WebMCP
 * browsers get the same capabilities.
 */

import { clampOutput, MAX_DESC_CHARS } from './policy.js';
import type { Activity } from './env.js';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  title?: string;
  execute(args: Record<string, unknown>, ctx: { signal?: AbortSignal }): unknown | Promise<unknown>;
}

export interface RegisterOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

interface NativeModelContext {
  registerTool(tool: unknown, opts?: RegisterOptions): Promise<void> | void;
  getTools(opts?: { fromOrigins?: string[] }): Promise<unknown[]>;
}

declare global {
  interface Document {
    modelContext?: NativeModelContext;
  }
}

interface Registration {
  def: ToolDefinition;
  opts: RegisterOptions;
}

interface PublicTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | { type: 'object'; properties: Record<string, never> };
  annotations: ToolAnnotations;
  origin: string;
}

const toolchangeListeners: Array<(event: { type: 'toolchange' }) => void> = [];

export class Runtime {
  private readonly native: NativeModelContext | null;
  private readonly registry = new Map<string, Registration>();
  private readonly activitySink: (a: Activity) => void;

  constructor({ onActivity }: { onActivity?: (a: Activity) => void } = {}) {
    this.native = typeof document !== 'undefined' && document.modelContext ? document.modelContext : null;
    this.activitySink = onActivity ?? (() => {});
  }

  get hasNative(): boolean {
    return !!this.native;
  }

  get size(): number {
    return this.registry.size;
  }

  /** Register a tool. Wraps execute with activity + budget + error handling. */
  async register(def: ToolDefinition, opts: RegisterOptions = {}): Promise<string> {
    const wrapped = this.wrap(def);
    this.registry.set(def.name, { def: wrapped, opts });
    if (this.native) {
      try {
        await this.native.registerTool(wrapped, { signal: opts.signal, exposedTo: opts.exposedTo });
      } catch (err) {
        this.registry.delete(def.name);
        throw err;
      }
    }
    this.emitToolchange();
    return def.name;
  }

  wrap(def: ToolDefinition): ToolDefinition {
    const userExecute = def.execute;
    const self = this;
    const wrapped: ToolDefinition = {
      name: def.name,
      description: def.description.slice(0, MAX_DESC_CHARS),
      inputSchema: def.inputSchema ?? { type: 'object', properties: {} },
      annotations: def.annotations ?? { readOnlyHint: true, untrustedContentHint: true },
      async execute(args, ctx = {}) {
        const started = Date.now();
        self.activitySink({ tool: def.name, args, phase: 'start' });
        try {
          const result = await userExecute(args, ctx);
          self.activitySink({ tool: def.name, args, phase: 'done', ms: Date.now() - started, result });
          return clampResult(result);
        } catch (err) {
          self.activitySink({
            tool: def.name,
            args,
            phase: 'error',
            ms: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
    };
    if (def.title) wrapped.title = def.title;
    return wrapped;
  }

  /** Same shape as document.modelContext.getTools(). */
  async getTools(): Promise<unknown[]> {
    if (this.native) {
      try {
        return await this.native.getTools();
      } catch {
        // fall through to in-page registry
      }
    }
    return Array.from(this.registry.values()).map(({ def }) => publicTool(def));
  }

  /** Same shape as document.modelContext.executeTool(): args must be a JSON string. */
  async executeTool(
    nameOrTool: string | { name?: string },
    argsJson: string | Record<string, unknown>,
    opts: { signal?: AbortSignal } = {}
  ): Promise<unknown> {
    const name = typeof nameOrTool === 'string' ? nameOrTool : nameOrTool?.name;
    if (!name) throw new Error('AgentReady: tool name required');
    const entry = this.registry.get(name);
    if (!entry) throw new Error(`AgentReady: unknown tool "${name}"`);
    const args: Record<string, unknown> =
      typeof argsJson === 'string' ? (JSON.parse(argsJson || '{}') as Record<string, unknown>) : (argsJson ?? {});
    return entry.def.execute(args, opts);
  }

  emitToolchange(): void {
    for (const fn of toolchangeListeners) {
      try {
        fn({ type: 'toolchange' });
      } catch {
        // listener errors must not break registration
      }
    }
  }

  on(event: 'toolchange', fn: (event: { type: 'toolchange' }) => void): () => void {
    if (event !== 'toolchange') return () => undefined;
    toolchangeListeners.push(fn);
    return () => {
      const i = toolchangeListeners.indexOf(fn);
      if (i >= 0) toolchangeListeners.splice(i, 1);
    };
  }
}

function publicTool(def: ToolDefinition): PublicTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema ?? { type: 'object', properties: {} },
    annotations: def.annotations ?? { readOnlyHint: true, untrustedContentHint: true },
    origin: typeof location !== 'undefined' ? location.origin : '',
  };
}

/** Enforce output budget on whatever the tool returned. */
function clampResult(result: unknown): string | unknown[] {
  if (result == null) return 'OK';
  if (typeof result === 'string') return clampOutput(result);
  if (Array.isArray(result) && result.length > 0 && (result[0] as { content?: unknown } | undefined)?.content !== undefined) {
    return result;
  }
  return clampOutput(JSON.stringify(result) ?? 'null');
}