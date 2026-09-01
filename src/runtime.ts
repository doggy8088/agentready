/**
 * AgentReady — runtime adapter.
 * Registers tools with the browser's WebMCP surface (document.modelContext —
 * with a navigator.modelContext fallback for engines that still ship there)
 * when available, and always maintains an in-page registry with an identical
 * getTools/executeTool shape so in-page agents (e.g. AskPage) and non-WebMCP
 * browsers get the same capabilities.
 */

import type { Activity } from './env.js';
import { clampOutput, MAX_DESC_CHARS } from './policy.js';

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
  getTools?(opts?: { fromOrigins?: string[] }): Promise<unknown[]>;
  addEventListener?(type: 'toolchange', fn: () => void): void;
}

interface NativeRecord {
  context: NativeModelContext;
  kind: 'document' | 'navigator';
}

/** Some engines (Firefox) still expose modelContext on navigator only. */
function detectNative(): NativeRecord | null {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & { modelContext?: NativeModelContext };
  if (doc.modelContext) return { context: doc.modelContext, kind: 'document' };
  const nav =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { modelContext?: NativeModelContext }) : null;
  if (nav?.modelContext) return { context: nav.modelContext, kind: 'navigator' };
  return null;
}

declare global {
  interface Document {
    modelContext?: NativeModelContext;
  }
  interface Navigator {
    modelContext?: NativeModelContext;
  }
}

interface Registration {
  def: ToolDefinition;
}

interface PublicTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> | { type: 'object'; properties: Record<string, never> };
  annotations: ToolAnnotations;
  origin: string;
  window: unknown;
}

const toolchangeListeners: Array<(event: { type: 'toolchange' }) => void> = [];

export class Runtime {
  private readonly native: NativeModelContext | null;
  private readonly nativeKind: 'document' | 'navigator' | null;
  private readonly registry = new Map<string, Registration>();
  private readonly activitySink: (a: Activity) => void;
  private readonly onUnregisterAll: () => void;

  constructor({
    onActivity,
    onNativeToolchange,
    onUnregisterAll,
  }: {
    onActivity?: (a: Activity) => void;
    onNativeToolchange?: () => void;
    onUnregisterAll?: () => void;
  } = {}) {
    this.activitySink = onActivity ?? (() => {});
    this.onUnregisterAll = onUnregisterAll ?? (() => undefined);
    const detected = detectNative();
    this.nativeKind = detected?.kind ?? null;
    const context = detected?.context ?? null;
    // ChatGPT-like clients expose a frozen object with only registerTool.
    const usable = context && typeof context.registerTool === 'function' ? context : null;
    this.native = usable;
    if (usable && typeof usable.addEventListener === 'function') {
      // Native `toolchange` (no payload) — forward into our shim listeners.
      usable.addEventListener('toolchange', () => {
        try {
          onNativeToolchange?.();
        } catch {
          // listener errors must not break the event path
        }
        this.emitToolchange();
      });
    }
  }

  get hasNative(): boolean {
    return !!this.native;
  }

  get nativeTransport(): 'document' | 'navigator' | 'shim' {
    return this.native ? (this.nativeKind ?? 'shim') : 'shim';
  }

  get size(): number {
    return this.registry.size;
  }

  /** Register a tool. Wraps execute with activity + budget + error handling. */
  async register(def: ToolDefinition, opts: RegisterOptions = {}): Promise<string> {
    const wrapped = this.wrap(def);
    this.registry.set(def.name, { def: wrapped });
    if (opts.signal) {
      if (opts.signal.aborted) {
        this.registry.delete(def.name);
        throw new Error(`AgentReady: signal already aborted, skipping registration of "${def.name}"`);
      }
    }
    if (this.native) {
      try {
        await this.native.registerTool(wrapped, { signal: opts.signal, exposedTo: opts.exposedTo });
      } catch (err) {
        this.registry.delete(def.name);
        throw err;
      }
    }
    if (!this.native) {
      // Native registers fire their own toolchange; the shim must emit its own.
      this.emitToolchange();
    }
    return def.name;
  }

  wrap(def: ToolDefinition): ToolDefinition {
    const userExecute = def.execute;
    const self = this;
    const wrapped: ToolDefinition = {
      name: def.name,
      description: def.description.slice(0, MAX_DESC_CHARS),
      inputSchema: def.inputSchema ? { ...def.inputSchema } : { type: 'object', properties: {} },
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
    if (this.native && typeof this.native.getTools === 'function') {
      try {
        const tools = await this.native.getTools();
        return tools.map(normalizeRegisteredTool);
      } catch {
        // Some native builds wedge or reject getTools — fall through to the
        // in-page registry, which always has the authoritative AgentReady set.
      }
    }
    return Array.from(this.registry.values()).map(({ def }) => publicTool(def));
  }

  /**
   * In-page shim mirroring document.modelContext.executeTool(). Accepts the
   * caller's args as a JSON string (current Chrome/WPT shape) OR a plain
   * object (current CG-DRAFT shape, webmcp#246); the tool callback always
   * receives a parsed object.
   */
  async executeTool(
    nameOrTool: string | { name?: string },
    args: string | Record<string, unknown>,
    opts: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const name = typeof nameOrTool === 'string' ? nameOrTool : nameOrTool?.name;
    if (!name) throw new Error(`AgentReady: tool name required`);
    const entry = this.registry.get(name);
    if (!entry) throw new Error(`AgentReady: unknown tool "${name}"`);
    let input: Record<string, unknown>;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args || '{}') as unknown;
        if (parsed === null || typeof parsed !== 'object') {
          throw new TypeError('Input must be an object');
        }
        input = parsed as Record<string, unknown>;
      } catch (err) {
        throw new Error(
          `AgentReady: invalid JSON input for "${name}" — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      input = args ?? {};
    }
    return entry.def.execute(input, opts);
  }

  /**
   * Clear every tool. The owner-side controllers are aborted via the
   * onUnregisterAll callback supplied at construction (aborting a foreign
   * signal is engine-dependent), then the shim registry is cleared.
   */
  unregisterAll(): void {
    this.onUnregisterAll();
    this.registry.clear();
    this.emitToolchange();
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

/** Chrome ≤153 returns inputSchema as a JSON string, 154+ as an object (#241). */
function normalizeRegisteredTool(tool: unknown): unknown {
  if (!tool || typeof tool !== 'object') return tool;
  const t = tool as { inputSchema?: unknown; title?: string };
  let schema = t.inputSchema;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema) as Record<string, unknown>;
    } catch {
      schema = undefined; // omit rather than leak an unparseable string
    }
  }
  return { ...t, title: t.title ?? '', ...(schema !== undefined ? { inputSchema: schema } : {}) };
}

function publicTool(def: ToolDefinition): PublicTool {
  return {
    name: def.name,
    title: def.title ?? '',
    description: def.description,
    inputSchema: def.inputSchema ? { ...def.inputSchema } : { type: 'object', properties: {} },
    annotations: def.annotations ?? { readOnlyHint: true, untrustedContentHint: true },
    origin: typeof location !== 'undefined' ? location.origin : '',
    window: typeof window !== 'undefined' ? window : undefined,
  };
}

/** Enforce output budget on whatever the tool returned. */
function clampResult(result: unknown): unknown {
  if (result == null) return 'OK';
  if (typeof result === 'string') return clampOutput(result);
  // MCP-style response { content: [{ type: 'text', text }] }: clamp each text.
  if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
    const response = result as { content: Array<{ type?: string; text?: string }>; isError?: boolean };
    return {
      ...response,
      content: response.content.map((part) =>
        part?.type === 'text' && typeof part.text === 'string' ? { ...part, text: clampOutput(part.text) } : part,
      ),
    };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(result) ?? 'null';
  } catch {
    serialized = String(result); // circular/BigInt results degrade to a summary, not an error
  }
  return clampOutput(serialized);
}
