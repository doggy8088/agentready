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

declare global {
  interface Window {
    AgentReady?: AgentReadyApi;
    AgentReadyConfig?: Partial<AgentReadyConfig>;
    __agentready?: boolean;
  }
}

const coreAbort = new AbortController();

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
    console.warn('[AgentReady] Not a secure context: document.modelContext requires HTTPS. Tools are still exposed in-page.');
  }

  const inspector = config.inspector ? new Inspector({ siteLabel: config.siteName }) : null;
  const env = createEnv(config, inspector);
  const runtime = new Runtime({
    onActivity: (a) => {
      inspector?.logActivity(a);
      inspector?.setBusy(a.phase === 'start');
    },
  });

  await registerCoreTools(runtime, envAwake(env));
  const resynth = await registerFormTools(runtime, env);
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
    attributeFilter: ['hidden', 'style', 'class'],
  });

  exposePublicApi(runtime, env, config);

  console.info(
    `[AgentReady] v${VERSION} — ${runtime.size} tools registered. Native WebMCP: ${runtime.hasNative ? 'yes' : 'in-page shim (document.modelContext unavailable)'}`
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

/** Lazy snapshot: tools re-read state at call time, not at registration. */
function envAwake(env: AgentEnv): AgentEnv {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'snapshot') return target.discover();
      return Reflect.get(target, prop);
    },
  }) as AgentEnv;
}

async function registerCoreTools(runtime: Runtime, env: AgentEnv): Promise<void> {
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
    try {
      await runtime.register(tool, { signal: coreAbort.signal });
    } catch (err) {
      console.warn(`[AgentReady] Could not register core tool ${tool.name}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function registerFormTools(runtime: Runtime, env: AgentEnv): Promise<() => Promise<void>> {
  const controller = new AbortController();
  let previous = controller;
  const registerBatch = async (): Promise<void> => {
    try {
      const tools = synthesizeFormTools(env);
      for (const t of tools) {
        try {
          await runtime.register(t, { signal: controller.signal });
        } catch (err) {
          console.warn(`[AgentReady] Skipped form tool ${t.name}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[AgentReady] Form synthesis failed:', err instanceof Error ? err.message : err);
    }
  };
  await registerBatch();
  return async function resynth(): Promise<void> {
    previous.abort();
    const next = new AbortController();
    const tools = synthesizeFormTools(env);
    for (const t of tools) {
      try {
        await runtime.register(t, { signal: next.signal });
      } catch {
        // duplicate or invalid — skip
      }
    }
    previous = next;
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
    unregisterAll: () => coreAbort.abort(),
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