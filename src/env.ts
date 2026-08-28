import type { Discovery, SemanticNode } from './semantic.js';
import type { FieldClass, FormKind } from './policy.js';

export type SubmitPolicy = 'auto-submit' | 'fill-only';

export interface FormFieldSpec {
  key: string;
  label: string;
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  type: 'string' | 'number';
  required: boolean;
  description: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  group?: HTMLInputElement[];
}

export interface FormInfo {
  name: string;
  description: string;
  fields: FormFieldSpec[];
  kind: FormKind;
  submitPolicy: SubmitPolicy;
  formEl: HTMLFormElement;
  hasSubmit: boolean;
}

export interface Activity {
  tool: string;
  phase: 'start' | 'done' | 'error' | 'submitted';
  args?: Record<string, unknown>;
  ms?: number;
  result?: unknown;
  error?: string;
}

export interface ConfirmRequest {
  title: string;
  detail: string;
  level?: string;
  el?: Element | null;
}

export interface AgentReadyConfig {
  inspector: boolean;
  siteName: string;
  maxResults: number;
}

export interface AgentReadyApi {
  version: string;
  hasNativeWebMCP: boolean;
  getTools(): Promise<unknown[]>;
  executeTool(name: string, argsJson: string | Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown>;
  register(def: unknown): Promise<string>;
  unregisterAll(): void;
  inspect(): Discovery;
  maxOutputChars: number;
}

/** Shared environment handed to every tool implementation. */
export interface AgentEnv {
  doc: Document;
  config: AgentReadyConfig;
  formInfo: Map<HTMLFormElement, FormInfo>;
  discover(): Discovery;
  readonly snapshot: Discovery;
  describe(el: Element): SemanticNode;
  resolveRef(ref: string): Element | null;
  isVisible(el: Element): boolean;
  classifyField(el: Element): FieldClass;
  labelOf(el: Element): string;
  redact(el: Element, value: string): string;
  highlight(el: Element | null, opts?: { sticky?: boolean }): void;
  confirmGate(req: ConfirmRequest): Promise<boolean>;
  onActivity(a: Activity): void;
}