/**
 * AgentReady — boot entry.
 * Loads as a normal <script src="agentready.js"> (bundled IIFE), discovers the
 * page, and exposes core + synthesized tools through WebMCP. Falls back to an
 * in-page registry with the same getTools/executeTool shape so agents like
 * AskPage work on any browser.
 */

import { Runtime } from './runtime.js';
import { Inspector } from './inspector.js';
import { discover, describeNode, resolveRef, isVisible, cleanText } from './semantic.js';
import type { Discovery } from './semantic.js';
import { classifyField, MAX_OUTPUT_CHARS } from './policy.js';
import { fieldLabel } from './tools/interact.js';
import { pageContextTool, findTool, readTargetTool } from './tools/page.js';
import { activateTargetTool, setFieldTool, fillFormTool, submitFormTool } from './tools/interact.js';
import { synthesizeFormTools } from './tools/forms.js';
import type { ToolDefinition } from './runtime.js';
import type { AgentEnv, AgentReadyApi, AgentReadyConfig } from './env.js';

const VERSION = '0.1.0';

/** Controllers for every tool registration (core per-tool + form batches). */
const trackedControllers = new Set<AbortController>();
const track = (c: AbortController): AbortController => {
  trackedControllers.add(c);
  return c;
};

declare global {
  interface Window {
    AgentReady?: AgentReadyApi;
    AgentReadyConfig?: Partial<AgentReadyConfig>;
    __agentready?: boolean;
  }
}

async function boot(): Promise<void> {
  if (window.__agentready) return;
  window.__agentready = true;
  const config: AgentReadyConfig = {
    inspector: true,
    siteName: (document.title ?? '').slice(0, 24) || 'AgentReady',
    maxResults: 8,
    ...(window.AgentReadyConfig ?? {}),
  } as AgentReadyConfig;
  if (!window.isSecureContext) {
    console.warn('[AgentReady] Not a secure context: WebMCP requires HTTPS (or localhost). Tools are still exposed in-page.');
  }

  const inspector = config.inspector ? new Inspector({ siteLabel: config.siteName }) : null;
  const env = createEnv(config, inspector);
  const runtime = new Runtime({
    onActivity: (a) => {
      inspector?.logActivity(a);
      inspector?.setBusy(a.phase === 'start');
    },
    onUnregisterAll: () => {
      for (const c of trackedControllers) if (!c.signal.aborted) c.abort();
      trackedControllers.clear();
    },
  });

  const coreNames = await registerCoreTools(runtime, env);
  const resynth = await registerFormTools(runtime, env, coreNames);
  inspector?.setToolCount(runtime.size);

  // Re-discover on DOM mutations; re-synthesize form tools when forms change.
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      env.discover();
      await resynth();
      inspector?.setToolCount(runtime.size);
    }, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'hidden', 'style', 'class',
      'data-agent-name', 'data-agent-tool', 'data-agent-description',
      'data-agent-submit', 'data-agent-priority', 'data-agent-hide',
    ],
  });

  exposePublicApi(runtime, env, config);

  console.info(
    `[AgentReady] v${VERSION} — ${runtime.size} tools registered. Native WebMCP: ${
      runtime.hasNative ? `yes (${runtime.nativeTransport})` : 'in-page shim (no transport on this engine)'
    }`
  );
}

function createEnv(config: AgentReadyConfig, inspector: Inspector | null): AgentEnv {
  let snapshotCache: Discovery | null = null;
  const env: AgentEnv = {
    doc: document,
    config,
    formInfo: new Map(),
    discover(): Discovery {
      snapshotCache = discover(document);
      return snapshotCache;
    },
    get snapshot(): Discovery {
      return snapshotCache ?? this.discover();
    },
    describe: (el) => describeNode(el, document),
    resolveRef,
    isVisible,
    classifyField,
    labelOf: (el) => fieldLabel(el) || cleanText(el).slice(0, 60),
    redact: (el, value) => (el && classifyField(el).level === 'never' ? '•••••••• (redacted: sensitive field)' : value),
    highlight: (el, opts) => inspector?.highlight(el, opts),
    confirmGate: (req) =>
      inspector ? inspector.confirmGate(req) : Promise.resolve(false),
    onActivity: () => undefined,
  };
  return env;
}

async function registerCoreTools(runtime: Runtime, env: AgentEnv): Promise<ReadonlySet<string>> {
  const core = [
    pageContextTool(env),
    findTool(env),
    readTargetTool(env),
    activateTargetTool(env),
    setFieldTool(env),
    fillFormTool(env),
    submitFormTool(env),
  ];
  for (const tool of core) {
    // One controller per tool: a rejected registration must never be followed
    // by an abort of the same signal (webmcp PR #240 stale-unregister guard).
    try {
      await runtime.register(tool, { signal: track(new AbortController()).signal });
    } catch (err) {
      console.warn(`[AgentReady] Could not register core tool ${tool.name}:`, err instanceof Error ? err.message : err);
    }
  }
  // Reserved names: synthesized tools must never shadow a core tool.
  return new Set(core.map((t) => t.name));
}

async function registerFormTools(
  runtime: Runtime,
  env: AgentEnv,
  reserved: ReadonlySet<string>
): Promise<() => Promise<void>> {
  let previousControllers: AbortController[] = [];

  const registerBatch = async (): Promise<AbortController[]> => {
    const controllers: AbortController[] = [];
    try {
      const tools = synthesizeFormTools(env, reserved);
      for (const t of tools) {
        const controller = track(new AbortController());
        try {
          await runtime.register(t, { signal: controller.signal });
          controllers.push(controller);
        } catch (err) {
          // PR webmcp#240: never abort a signal whose registration failed —
          // drop it from tracking so unregisterAll() will not touch it either.
          trackedControllers.delete(controller);
          console.warn(`[AgentReady] Skipped form tool ${t.name}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[AgentReady] Form synthesis failed:', err instanceof Error ? err.message : err);
    }
    return controllers;
  };

  previousControllers = await registerBatch();
  let queue: Promise<void> = Promise.resolve();
  return async function resynth(): Promise<void> {
    // Serialized: at most one retire/register cycle runs at a time, so
    // interleaved observer callbacks cannot double-retire or orphan a batch.
    queue = queue.then(async () => {
      // Read + clear the previous batch synchronously, before any await —
      // a queued peer must never see the same controllers twice.
      const retiring = previousControllers;
      previousControllers = [];
      for (const controller of retiring) {
        trackedControllers.delete(controller);
        if (!controller.signal.aborted) controller.abort();
      }
      // Register the fresh batch under brand-new signals.
      previousControllers = await registerBatch();
    });
    return queue;
  };
}

/** Level 2 + agent-facing API: window.AgentReady */
function exposePublicApi(runtime: Runtime, env: AgentEnv, config: AgentReadyConfig): void {
  const api: AgentReadyApi = {
    version: VERSION,
    hasNativeWebMCP: runtime.hasNative,
    getTools: () => runtime.getTools(),
    executeTool: (name, argsJson, opts) => runtime.executeTool(name, argsJson, opts),
    register: async (def: unknown) => {
      const d = def as ToolDefinition;
      if (!d?.name || !d?.description || typeof d.execute !== 'function') {
        throw new Error('AgentReady.register requires { name, description, inputSchema, execute }');
      }
      await runtime.register(d);
      return d.name;
    },
    unregisterAll: () => runtime.unregisterAll(),
    inspect: (): Discovery => env.discover(),
    maxOutputChars: MAX_OUTPUT_CHARS,
  };
  window.AgentReady = api;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
} else {
  void boot();
}