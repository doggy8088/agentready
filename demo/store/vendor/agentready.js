(() => {
  // build/src/policy.js
  var MAX_OUTPUT_CHARS = 1500;
  var MAX_DESC_CHARS = 500;
  var MAX_RESULTS = 10;
  var SENSITIVE_NAME_RE = /pass(word)?|pwd|secret|token|api[-_]?key|auth|credential|ssn|social[-_]?sec|card[-_]?num|cc[-_]?num|cvc|cvv|cid|security[-_]?code|expiry|exp[-_]?date|cv2/i;
  var NEVER_AUTOCOMPLETE = new Set([
    "current-password",
    "new-password",
    "cc-number",
    "cc-cvc",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-name",
    "cc-type"
  ]);
  function classifyField(input) {
    const el = input;
    const type = (el.getAttribute("type") ?? el.tagName.toLowerCase() ?? "").toLowerCase();
    const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase().trim();
    const name = `${el.getAttribute("name") ?? ""} ${el.id}`;
    if (type === "password")
      return { level: "never", reason: "password field" };
    if (type === "file")
      return { level: "never", reason: "file upload" };
    if (type === "hidden")
      return { level: "never", reason: "hidden field (may hold tokens)" };
    if (NEVER_AUTOCOMPLETE.has(autocomplete)) {
      return { level: "never", reason: `sensitive autocomplete (${autocomplete})` };
    }
    if (autocomplete.startsWith("cc-") || autocomplete.includes("password")) {
      return { level: "never", reason: `sensitive autocomplete (${autocomplete})` };
    }
    if (SENSITIVE_NAME_RE.test(name))
      return { level: "never", reason: "sensitive field name" };
    return { level: "allow", reason: "general field" };
  }
  var DESTRUCTIVE_RE = /\b(delete|remove|destroy|purge|erase|drop|checkout|pay(ment)?|purchase|place\s+order|buy\s+now|submit\s+payment|confirm\s+payment|transfer|withdraw|cancel\s+(order|subscription|account|booking|plan)|unsubscribe|deactivate)\b/i;
  function classifyAction(el) {
    const label = accessibleActionLabel(el);
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (DESTRUCTIVE_RE.test(label)) {
      return { level: "confirm", reason: `consequential action "${label}"`, label };
    }
    if (type === "submit" || el.closest("form")) {
      return { level: "confirm", reason: `form submission "${label}"`, label };
    }
    if (type === "submit" || el.closest("form")) {
      return { level: "confirm", reason: `form submission "${label}"`, label };
    }
    return { level: "allow", reason: `action "${label}"`, label };
  }
  function accessibleActionLabel(el) {
    return (el.getAttribute("aria-label") || textOf(el) || el.getAttribute("value") || el.getAttribute("title") || el.getAttribute("name") || "button").trim();
  }
  function textOf(el) {
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function classifyForm(form) {
    const fields = Array.from(form.querySelectorAll("input, select, textarea"));
    const hasPassword = fields.some((f) => (f.getAttribute("type") ?? "").toLowerCase() === "password");
    const hasPayment = fields.some((f) => {
      const ac = (f.getAttribute("autocomplete") ?? "").toLowerCase();
      return ac.startsWith("cc-") || /card[-_]?num|cvv|cvc/i.test(`${f.getAttribute("name") ?? ""} ${f.id}`);
    });
    const method = (form.getAttribute("method") ?? "get").toLowerCase();
    const action = form.getAttribute("action") ?? "";
    const names = Array.from(form.querySelectorAll("input")).map((f) => f.getAttribute("name") ?? "").join(" ");
    const searchText = /search|query|filter|find|q\b/i.test(`${action} ${names}`);
    const hasSubmit = !!form.querySelector("[type=submit], button:not([type]), button[type=submit]");
    let kind = "general";
    let submitPolicy = "fill-only";
    if (hasPassword)
      kind = "auth";
    else if (hasPayment)
      kind = "payment";
    else if (searchText && method === "get") {
      kind = "search";
      submitPolicy = "auto-submit";
    } else if (/newsletter|subscribe|email/i.test(form.getAttribute("aria-label") ?? "") && fields.length <= 2) {
      kind = "newsletter";
    }
    return { kind, submitPolicy, hasSubmit, method, action, fields };
  }
  function clampOutput(text, max = MAX_OUTPUT_CHARS) {
    const s = typeof text === "string" ? text : JSON.stringify(text) ?? "null";
    if (s.length <= max)
      return s;
    return s.slice(0, max) + ` …[truncated, ${s.length - max} chars omitted]`;
  }

  // build/src/runtime.js
  var toolchangeListeners = [];

  class Runtime {
    constructor({ onActivity } = {}) {
      this.registry = new Map;
      this.native = typeof document !== "undefined" && document.modelContext ? document.modelContext : null;
      this.activitySink = onActivity ?? (() => {});
    }
    get hasNative() {
      return !!this.native;
    }
    get size() {
      return this.registry.size;
    }
    async register(def, opts = {}) {
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
    wrap(def) {
      const userExecute = def.execute;
      const self = this;
      const wrapped = {
        name: def.name,
        description: def.description.slice(0, MAX_DESC_CHARS),
        inputSchema: def.inputSchema ?? { type: "object", properties: {} },
        annotations: def.annotations ?? { readOnlyHint: true, untrustedContentHint: true },
        async execute(args, ctx = {}) {
          const started = Date.now();
          self.activitySink({ tool: def.name, args, phase: "start" });
          try {
            const result = await userExecute(args, ctx);
            self.activitySink({ tool: def.name, args, phase: "done", ms: Date.now() - started, result });
            return clampResult(result);
          } catch (err) {
            self.activitySink({
              tool: def.name,
              args,
              phase: "error",
              ms: Date.now() - started,
              error: err instanceof Error ? err.message : String(err)
            });
            throw err;
          }
        }
      };
      if (def.title)
        wrapped.title = def.title;
      return wrapped;
    }
    async getTools() {
      if (this.native) {
        try {
          return await this.native.getTools();
        } catch {}
      }
      return Array.from(this.registry.values()).map(({ def }) => publicTool(def));
    }
    async executeTool(nameOrTool, argsJson, opts = {}) {
      const name = typeof nameOrTool === "string" ? nameOrTool : nameOrTool?.name;
      if (!name)
        throw new Error("AgentReady: tool name required");
      const entry = this.registry.get(name);
      if (!entry)
        throw new Error(`AgentReady: unknown tool "${name}"`);
      const args = typeof argsJson === "string" ? JSON.parse(argsJson || "{}") : argsJson ?? {};
      return entry.def.execute(args, opts);
    }
    emitToolchange() {
      for (const fn of toolchangeListeners) {
        try {
          fn({ type: "toolchange" });
        } catch {}
      }
    }
    on(event, fn) {
      if (event !== "toolchange")
        return () => {
          return;
        };
      toolchangeListeners.push(fn);
      return () => {
        const i = toolchangeListeners.indexOf(fn);
        if (i >= 0)
          toolchangeListeners.splice(i, 1);
      };
    }
  }
  function publicTool(def) {
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema ?? { type: "object", properties: {} },
      annotations: def.annotations ?? { readOnlyHint: true, untrustedContentHint: true },
      origin: typeof location !== "undefined" ? location.origin : ""
    };
  }
  function clampResult(result) {
    if (result == null)
      return "OK";
    if (typeof result === "string")
      return clampOutput(result);
    if (Array.isArray(result) && result.length > 0 && result[0]?.content !== undefined) {
      return result;
    }
    return clampOutput(JSON.stringify(result) ?? "null");
  }

  // build/src/inspector.js
  var STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #101828; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(16,24,40,.25); border: 1px solid #344054; user-select: none; }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #12b76a; }
  .badge .dot.busy { background: #f79009; animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .4; } }
  .panel { width: 300px; max-height: 320px; overflow: auto; background: #fff; color: #101828; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,40,.24); border: 1px solid #eaecf0; font-size: 12px; display: none; }
  .panel.open { display: block; }
  .panel header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #eaecf0; font-weight: 700; }
  .panel header span { font-weight: 400; color: #475467; }
  .feed { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 6px; }
  .item { display: flex; gap: 8px; align-items: baseline; }
  .item .icon { width: 14px; flex: none; text-align: center; }
  .item .name { font-weight: 600; }
  .item .args { color: #475467; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
  .item.err .name { color: #d92d20; }
  .empty { color: #98a2b3; padding: 8px 0; }
  .confirm { width: 320px; background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,40,.35); border: 1px solid #eaecf0; padding: 14px; display: none; }
  .confirm.open { display: block; }
  .confirm h4 { margin: 0 0 4px; font-size: 14px; }
  .confirm p { margin: 0 0 10px; font-size: 12px; color: #475467; }
  .confirm .row { display: flex; gap: 8px; justify-content: flex-end; }
  button.btn { padding: 6px 14px; border-radius: 8px; border: 1px solid #d0d5dd; background: #fff; font-weight: 600; font-size: 12px; cursor: pointer; }
  button.btn.primary { background: #12b76a; border-color: #12b76a; color: #fff; }
  .highlight { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #7f56d9; border-radius: 6px; box-shadow: 0 0 0 4px rgba(127,86,217,.25); transition: all .2s ease; display: none; }
`;

  class Inspector {
    constructor({ siteLabel } = {}) {
      this.host = document.createElement("div");
      this.host.setAttribute("data-agentready-ui", "");
      this.shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.shadow.appendChild(style);
      this.shadow.innerHTML += `
      <div class="root">
        <div class="highlight"></div>
        <div class="confirm" role="alertdialog" aria-modal="false">
          <h4></h4><p></p>
          <div class="row">
            <button class="btn cancel">Decline</button>
            <button class="btn primary">Approve</button>
          </div>
        </div>
        <div class="panel">
          <header>AgentReady <span class="count"></span></header>
          <div class="feed"><div class="empty">Waiting for agent activity…</div></div>
        </div>
        <div class="badge" role="button" tabindex="0">
          <span class="dot"></span><span class="label">AgentReady</span><span class="badge-count"></span>
        </div>
      </div>`;
      document.documentElement.appendChild(this.host);
      this.badge = this.shadow.querySelector(".badge");
      this.dot = this.shadow.querySelector(".dot");
      this.panel = this.shadow.querySelector(".panel");
      this.feed = this.shadow.querySelector(".feed");
      this.countEl = this.shadow.querySelector(".badge-count");
      this.confirmBox = this.shadow.querySelector(".confirm");
      this.highlightBox = this.shadow.querySelector(".highlight");
      this.badge.addEventListener("click", () => this.panel.classList.toggle("open"));
      this.setLabel(siteLabel ?? "AgentReady");
    }
    setLabel(siteLabel) {
      this.shadow.querySelector(".label").textContent = siteLabel;
    }
    setToolCount(n) {
      this.countEl.textContent = `${n} tool${n === 1 ? "" : "s"}`;
      this.badge.title = `${n} WebMCP tools available to agents`;
    }
    setBusy(busy) {
      this.dot.classList.toggle("busy", busy);
    }
    logActivity(a) {
      this.feed.querySelector(".empty")?.remove();
      const icons = { start: "→", done: "✓", error: "✗", submitted: "⏎" };
      const item = document.createElement("div");
      item.className = "item" + (a.phase === "error" ? " err" : "");
      const argStr = summarizeArgs(a.args);
      item.innerHTML = '<span class="icon"></span><span><span class="name"></span> <span class="args"></span></span>';
      item.querySelector(".icon").textContent = icons[a.phase] ?? "·";
      item.querySelector(".name").textContent = a.tool;
      item.querySelector(".args").textContent = a.phase === "error" ? `${argStr} — ${a.error ?? ""}` : `${argStr}${a.ms != null ? ` (${a.ms}ms)` : ""}`;
      this.feed.prepend(item);
      while (this.feed.children.length > 12)
        this.feed.lastChild?.remove();
    }
    highlight(el, { sticky = false } = {}) {
      if (!el?.getBoundingClientRect)
        return;
      const move = () => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0)
          return;
        Object.assign(this.highlightBox.style, {
          display: "block",
          left: `${r.left - 4}px`,
          top: `${r.top - 4}px`,
          width: `${r.width + 8}px`,
          height: `${r.height + 8}px`
        });
      };
      move();
      if (!sticky) {
        clearTimeout(this._hlTimer);
        this._hlTimer = setTimeout(() => {
          this.highlightBox.style.display = "none";
        }, 1600);
      }
    }
    confirmGate({ title, detail, level = "confirm", el, timeoutMs = 30000 }) {
      if (level === "allow")
        return Promise.resolve(true);
      return new Promise((resolve) => {
        this.setBusy(true);
        el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        this.confirmBox.querySelector("h4").textContent = title;
        this.confirmBox.querySelector("p").textContent = detail ?? "";
        this.confirmBox.style.display = "block";
        const btnYes = this.confirmBox.querySelector(".primary");
        const btnNo = this.confirmBox.querySelector(".cancel");
        const done = (ok) => {
          this.confirmBox.style.display = "none";
          this.setBusy(false);
          clearTimeout(timer);
          btnYes.removeEventListener("click", yes);
          btnNo.removeEventListener("click", no);
          resolve(ok);
        };
        const yes = () => done(true);
        const no = () => done(false);
        btnYes.addEventListener("click", yes);
        btnNo.addEventListener("click", no);
        const timer = setTimeout(() => done(false), timeoutMs);
      });
    }
    destroy() {
      this.host.remove();
    }
  }
  function summarizeArgs(args) {
    if (!args || typeof args !== "object")
      return "";
    return Object.entries(args).slice(0, 3).map(([k, v]) => `${k}: ${JSON.stringify(v)?.slice(0, 40)}`).join(", ");
  }

  // build/src/semantic.js
  var refCounter = 0;
  var elToRef = new WeakMap;
  var refToEl = new Map;
  function escapeCss(doc, s) {
    const css = doc.defaultView?.CSS;
    if (css?.escape)
      return css.escape(s);
    return String(s).replace(/([^a-zA-Z0-9_\u00A0-\uFFFF-])/g, "\\$1");
  }
  function cleanText(el) {
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function isVisible(el) {
    if (!el.isConnected)
      return false;
    if (el.closest('[aria-hidden="true"], [hidden], [data-agentready-ignore]'))
      return false;
    if (el.getAttribute("type") === "hidden")
      return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
      return false;
    }
    return true;
  }
  function accessibleName(el, doc = el.ownerDocument) {
    const aria = el.getAttribute("aria-label");
    if (aria)
      return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => doc.getElementById(id)).filter((x) => !!x).map(cleanText).filter(Boolean).join(" ");
      if (t)
        return t;
    }
    if (el.id) {
      const label = doc.querySelector(`label[for="${escapeCss(doc, el.id)}"]`);
      if (label)
        return cleanText(label);
    }
    const wrap = el.closest("label");
    if (wrap)
      return cleanText(wrap).slice(0, 120);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder)
      return placeholder.trim();
    if (el.tagName === "IMG" && el.alt)
      return el.alt.trim();
    const title = el.getAttribute("title");
    if (title)
      return title.trim();
    if (el.tagName === "SELECT") {
      const sel = el;
      return sel.selectedOptions?.[0]?.textContent?.trim() ?? cleanText(el);
    }
    return cleanText(el).slice(0, 80);
  }
  function labelFor(el, doc = el.ownerDocument) {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => doc.getElementById(id)).filter((x) => !!x).map(cleanText).join(" ");
      if (t)
        return t;
    }
    if (el.id) {
      const label = doc.querySelector(`label[for="${escapeCss(doc, el.id)}"]`);
      if (label)
        return cleanText(label);
    }
    const wrap = el.closest("label");
    if (wrap) {
      return (wrap.textContent ?? "").replace(/\s+/g, " ").replace(el.value ?? "", "").trim();
    }
    return el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("name") ?? "";
  }
  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit)
      return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href"))
      return "link";
    if (tag === "button" || tag === "input" && ["button", "submit", "reset"].includes(el.type)) {
      return "button";
    }
    if (tag === "input") {
      const t = el.type;
      if (t === "checkbox")
        return "checkbox";
      if (t === "radio")
        return "radio";
      if (t === "search")
        return "searchbox";
      if (t === "range")
        return "slider";
      return "textbox";
    }
    if (tag === "select")
      return "combobox";
    if (tag === "textarea")
      return "textbox";
    if (tag === "summary")
      return "button";
    if (tag === "option")
      return "option";
    if (el.hasAttribute("onclick") || el.hasAttribute("tabindex"))
      return "button";
    return "generic";
  }
  function contextFor(el, doc = el.ownerDocument) {
    const parts = [];
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend)
      parts.push(cleanText(legend));
    const landmark = el.closest(LANDMARK_SELECTOR);
    if (landmark) {
      const l = landmark.getAttribute("aria-label") ?? landmark.tagName.toLowerCase();
      parts.push(`in ${l}`);
    }
    let anc = el.parentElement;
    while (anc && anc !== doc.body) {
      if (/^H[1-6]$/.test(anc.tagName)) {
        parts.push(`under "${cleanText(anc).slice(0, 80)}"`);
        break;
      }
      anc = anc.parentElement;
    }
    const described = el.getAttribute("aria-describedby");
    if (described) {
      const d = doc.getElementById(described.split(/\s+/)[0] ?? "");
      if (d)
        parts.push(cleanText(d).slice(0, 100));
    }
    const isField = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const label = isField ? labelFor(el, doc) : null;
    if (label && !parts.some((p) => p.includes(label)))
      parts.unshift(`field "${label}"`);
    return parts.join(", ");
  }
  function describeNode(el, doc = el.ownerDocument) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type") ?? "";
    const role = roleOf(el);
    const name = accessibleName(el, doc);
    const node = {
      ref: refFor(el),
      role,
      name: name || `(unlabelled ${tag})`,
      tag,
      context: contextFor(el, doc),
      visible: isVisible(el)
    };
    const isFieldTag = ["input", "select", "textarea"].includes(tag);
    if (isFieldTag && classifyField(el).level === "never") {
      node.hiddenFromAgents = true;
      return node;
    }
    let value = null;
    if (tag === "input" && ["checkbox", "radio"].includes(type)) {
      value = el.checked ? "checked" : "unchecked";
    } else if (tag === "input" || tag === "textarea") {
      value = (el.value || "").slice(0, 120) || null;
    } else if (tag === "select") {
      value = el.selectedOptions?.[0]?.textContent?.trim() ?? null;
    }
    if (value)
      node.value = value.slice(0, 120);
    if (tag === "a" && el.getAttribute("href"))
      node.href = (el.getAttribute("href") ?? "").slice(0, 200);
    if (type && tag === "input")
      node.inputType = type;
    if (tag === "select") {
      node.options = Array.from(el.options).slice(0, 30).map((o) => o.textContent.trim());
    }
    if (tag === "input" && type === "checkbox")
      node.checked = el.checked;
    if (el.hasAttribute("required"))
      node.required = true;
    if (isFieldTag)
      node.field = classifyField(el);
    else if (role === "button" || tag === "button" || tag === "a")
      node.action = classifyAction(el);
    return node;
  }
  var INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=menuitem]",
    "[role=option]",
    "[role=combobox]",
    "[role=searchbox]",
    "[role=textbox]",
    "[onclick]",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  var LANDMARK_SELECTOR = "header, nav, main, aside, footer, section[aria-label], form[aria-label], [role=main], [role=navigation], [role=search], [role=dialog], [role=alertdialog]";
  function refFor(el) {
    let ref = elToRef.get(el);
    if (!ref) {
      ref = `el_${(++refCounter).toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
      elToRef.set(el, ref);
      refToEl.set(ref, new WeakRef(el));
    }
    return ref;
  }
  function resolveRef(ref) {
    const wr = refToEl.get(ref);
    if (!wr)
      return null;
    const el = wr.deref();
    if (!el || !el.isConnected)
      return null;
    return el;
  }
  function pruneRefs() {
    for (const [ref, wr] of refToEl)
      if (!wr.deref())
        refToEl.delete(ref);
  }
  function discover(doc) {
    pruneRefs();
    const root = doc.body ?? doc.documentElement;
    const els = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
    const nodes = els.filter((el) => isVisible(el) && !el.closest("[data-agentready-ignore]")).map((el) => describeNode(el, doc));
    const landmarks = Array.from(root.querySelectorAll(LANDMARK_SELECTOR)).slice(0, 20).map((el) => {
      const heading = el.querySelector("h1, h2, h3");
      return {
        role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label") ?? (heading ? cleanText(heading) : "")
      };
    });
    const headings = Array.from(root.querySelectorAll("h1, h2, h3")).slice(0, 40).filter((h) => isVisible(h)).map((h) => ({ level: Number(h.tagName.slice(1)), text: cleanText(h).slice(0, 120) }));
    const forms = Array.from(root.querySelectorAll("form")).filter((f) => isVisible(f) && !f.closest("[data-agentready-ignore]"));
    return { nodes, landmarks, headings, forms, title: doc.title, url: doc.URL };
  }
  function matchNodes(query, nodes, { kind, limit = 8 } = {}) {
    const q = query.toLowerCase().replace(/[^\w\s$-]/g, " ");
    const terms = q.split(/\s+/).filter((t) => t.length > 1);
    if (!terms.length)
      return [];
    const scored = [];
    for (const n of nodes) {
      if (n.hiddenFromAgents)
        continue;
      if (kind === "action" && !["button", "link", "tab", "menuitem"].includes(n.role))
        continue;
      if (kind === "field" && !["textbox", "searchbox", "checkbox", "radio", "combobox", "slider"].includes(n.role))
        continue;
      let score = 0;
      const nameL = n.name.toLowerCase();
      const ctxL = (n.context ?? "").toLowerCase();
      for (const t of terms) {
        if (nameL.includes(t))
          score += 6;
        if (ctxL.includes(t))
          score += 3;
        if (n.role === "button" && /click|press|tap|activate/.test(t))
          score += 2;
      }
      if (nameL === q)
        score += 10;
      if (nameL.startsWith(q))
        score += 4;
      if (score > 0)
        scored.push({ node: n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.node);
  }

  // build/src/tools/controls.js
  function setControlValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "input" && type === "checkbox") {
      el.checked = /true|yes|on|1/i.test(String(value));
    } else if (tag === "input" && type === "radio") {
      const input = el;
      if (input.value === String(value) || radioLabel(input) === String(value))
        input.checked = true;
      else
        return false;
    } else if (tag === "select") {
      const select = el;
      const norm = String(value).trim().toLowerCase();
      const opt = Array.from(select.options).find((o) => o.value === String(value) || o.textContent.trim().toLowerCase() === norm);
      if (!opt)
        return false;
      select.value = opt.value;
    } else if (tag === "input" && type === "range") {
      el.value = String(Number(value));
    } else {
      el.value = String(value);
    }
    const Ev = el.ownerDocument.defaultView?.Event ?? Event;
    el.dispatchEvent(new Ev("input", { bubbles: true }));
    el.dispatchEvent(new Ev("change", { bubbles: true }));
    return true;
  }
  function radioLabel(el) {
    return el.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  // build/src/tools/interact.js
  function activateTargetTool(env) {
    return {
      name: "activate_target",
      description: "Activate a page element by ref: click buttons, links, tabs, toggles. " + "Consequential actions (submit, pay, delete) require user approval in the on-page panel.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string", description: "Ref from find_on_page" } },
        required: ["ref"]
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: ({ ref }) => activate(env, String(ref ?? ""))
    };
  }
  function setFieldTool(env) {
    return {
      name: "set_field",
      description: "Set one form field by ref: text inputs, textarea, select, checkbox, radio.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref from find_on_page" },
          value: { type: "string", description: 'New value (for checkbox: "true"/"false")' }
        },
        required: ["ref", "value"]
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: ({ ref, value }) => setField(env, String(ref ?? ""), String(value ?? ""))
    };
  }
  function fillFormTool(env) {
    return {
      name: "fill_form",
      description: "Fill a form in one call. Fields are matched by human-readable label or name. " + "Sensitive fields (passwords, payment) are refused. Never submits the form.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref of the form or any field inside it (from find_on_page)" },
          values: {
            type: "object",
            description: 'Map of field name/label to value, e.g. {"Email": "a@b.c", "Quantity": "2"}'
          }
        },
        required: ["ref", "values"]
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: ({ ref, values }) => fillForm(env, String(ref ?? ""), values ?? {})
    };
  }
  function submitFormTool(env) {
    return {
      name: "submit_form",
      description: "Submit a form after review. Always requires explicit human approval via the on-page panel. " + "Use fill_form first, then submit_form with the form ref.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref of the form or any field inside it" },
          summary: { type: "string", description: "Short human-readable summary of what will be submitted" }
        },
        required: ["ref", "summary"]
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: ({ ref, summary }) => submitForm(env, String(ref ?? ""), String(summary ?? ""))
    };
  }
  async function activate(env, ref) {
    const el = env.resolveRef(ref);
    if (!el)
      return `Ref "${ref}" is stale. Run find_on_page again.`;
    if (!env.isVisible(el))
      return "Target is not visible on the page.";
    const cls = classifyAction(el);
    if (cls.level === "never")
      return `Refused: ${cls.reason}.`;
    const ok = await env.confirmGate({ title: `Activate "${cls.label}"`, detail: cls.reason, level: cls.level, el });
    if (!ok)
      return "User declined to activate this target. Nothing happened.";
    env.highlight(el, { sticky: true });
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el.click();
    return `Activated "${cls.label}". If the page navigated, re-orient with get_page_context.`;
  }
  function setField(env, ref, value) {
    const el = env.resolveRef(ref);
    if (!el)
      return `Ref "${ref}" is stale. Run find_on_page again.`;
    const cls = classifyField(el);
    if (cls.level === "never")
      return `Refused: ${cls.reason}. This field is never exposed to agents.`;
    env.highlight(el, { sticky: true });
    const ok = setControlValue(el, value);
    if (!ok)
      return `Could not set "${env.labelOf(el)}" to ${JSON.stringify(value)} (e.g. select option not found).`;
    el.scrollIntoView?.({ block: "center" });
    return `Set "${env.labelOf(el)}" = ${JSON.stringify(env.redact(el, String(value)))}`;
  }
  function fieldLabel(field) {
    const labels = field.labels;
    if (labels?.[0])
      return labels[0].textContent.replace(/\s+/g, " ").trim();
    return field.getAttribute("aria-label") ?? field.getAttribute("placeholder") ?? field.getAttribute("name") ?? field.id ?? "";
  }
  function matchField(field, key) {
    const q = String(key).trim().toLowerCase();
    if (!q)
      return false;
    const candidates = [
      field.getAttribute("name")?.toLowerCase(),
      field.id.toLowerCase(),
      fieldLabel(field).toLowerCase(),
      field.getAttribute("placeholder")?.toLowerCase()
    ].filter((c) => !!c);
    return candidates.some((c) => c === q || c.includes(q) || q.includes(c));
  }
  function fillForm(env, ref, values) {
    const el = env.resolveRef(ref);
    if (!el)
      return `Ref "${ref}" is stale. Run find_on_page again.`;
    const form = el.tagName === "FORM" ? el : el.closest("form");
    if (!form)
      return "Target is not a form and is not inside one.";
    const fields = Array.from(form.querySelectorAll("input, select, textarea")).filter((f) => env.isVisible(f) && !f.disabled && f.getAttribute("type") !== "hidden");
    const results = [];
    const notFound = [];
    for (const [key, raw] of Object.entries(values)) {
      const value = raw == null ? "" : String(raw);
      const field = fields.find((f) => matchField(f, key));
      if (!field) {
        notFound.push(key);
        continue;
      }
      const cls = classifyField(field);
      if (cls.level === "never") {
        results.push({ field: fieldLabel(field) || key, status: "refused", reason: cls.reason });
        continue;
      }
      const ok = setControlValue(field, value);
      env.highlight(field);
      results.push({
        field: fieldLabel(field) || key,
        status: ok ? "set" : "failed",
        value: ok ? env.redact(field, String(value)) : undefined
      });
    }
    const missing = fields.filter((f) => f.hasAttribute("required") && f.value === "" && f.type !== "checkbox" && f.type !== "radio").map((f) => fieldLabel(f) || (f.getAttribute("name") ?? ""));
    const formName = form.getAttribute("aria-label") ?? form.getAttribute("name") ?? ((fields[0] ? fieldLabel(fields[0]) : "") || "form");
    const out = {
      form: formName,
      filled: results,
      ...notFound.length ? { notFound } : {},
      ...missing.length ? { stillRequired: missing } : {},
      note: "Form filled but NOT submitted. Call submit_form when ready (requires user approval)."
    };
    return JSON.stringify(out);
  }
  async function submitForm(env, ref, summary) {
    const el = env.resolveRef(ref);
    if (!el)
      return `Ref "${ref}" is stale. Run find_on_page again.`;
    const form = el.tagName === "FORM" ? el : el.closest("form");
    if (!form)
      return "Target is not inside a form.";
    const submit = form.querySelector("[type=submit], button[type=submit], button:not([type])");
    if (!submit)
      return "Form has no visible submit control.";
    const ok = await env.confirmGate({
      title: "Submit form?",
      detail: summary || "An agent wants to submit this form. Review before approving.",
      level: "confirm",
      el: form
    });
    if (!ok)
      return "User declined to submit. Nothing was sent.";
    env.highlight(submit, { sticky: true });
    if (typeof form.requestSubmit === "function")
      form.requestSubmit(submit);
    else
      submit.click();
    return "Form submitted after user approval.";
  }

  // build/src/tools/page.js
  function pageContextTool(env) {
    return {
      name: "get_page_context",
      description: "Get a semantic summary of the current page: title, headings, regions, " + "available actions overview, and forms. Call this first to orient.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => pageContext(env)
    };
  }
  function findTool(env) {
    return {
      name: "find_on_page",
      description: "Find interactive elements or content on the page by natural-language description. " + "Returns semantic refs usable with read_target / activate_target / set_field. " + 'kind: "any" | "action" (buttons, links, tabs) | "field" (inputs, selects).',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'What to look for, e.g. "Add to cart for MacBook Pro"' },
          kind: { type: "string", enum: ["any", "action", "field"], description: "Limit result kinds" }
        },
        required: ["query"]
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: ({ query, kind }) => findOnPage(env, String(query ?? ""), kind)
    };
  }
  function readTargetTool(env) {
    return {
      name: "read_target",
      description: "Read details of one element by semantic ref: current value, options, link target, " + "or surrounding content.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string", description: "Ref from find_on_page" } },
        required: ["ref"]
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: ({ ref }) => readTarget(env, String(ref ?? ""))
    };
  }
  function pageContext(env) {
    const snapshot = env.discover();
    const out = {
      title: env.doc.title,
      url: env.doc.URL || env.doc.location?.href || "",
      headings: snapshot.headings.slice(0, 12).map((h) => `${"#".repeat(h.level)} ${h.text}`),
      regions: snapshot.landmarks.slice(0, 10).map((l) => `${l.role}: ${l.label}`.trim()),
      counts: {
        buttons: snapshot.nodes.filter((n) => n.role === "button").length,
        links: snapshot.nodes.filter((n) => n.role === "link").length,
        fields: snapshot.nodes.filter((n) => n.field).length,
        forms: snapshot.forms.length
      },
      forms: snapshot.forms.map((f) => {
        const info = env.formInfo.get(f);
        return info ? { form: info.name, fields: info.fields.map((fl) => fl.key).slice(0, 10) } : null;
      }).filter((x) => x !== null),
      note: "Use find_on_page to locate elements, then activate_target / set_field / fill_form to act."
    };
    return clampOutput(out);
  }
  function findOnPage(env, query, kind) {
    const snapshot = env.discover();
    const narrow = kind === "action" || kind === "field" ? kind : undefined;
    const hits = matchNodes(query, snapshot.nodes, { kind: narrow, limit: MAX_RESULTS });
    if (!hits.length)
      return `No match for "${query}". Try get_page_context to see what is available.`;
    const results = hits.map((n) => ({
      ref: n.ref,
      role: n.role,
      name: n.name,
      ...n.value ? { value: n.value } : {},
      context: n.context || undefined,
      actionRisk: n.action?.level ?? n.field?.level ?? undefined
    }));
    return clampOutput({ results });
  }
  function readTarget(env, ref) {
    const el = env.resolveRef(ref);
    if (!el)
      return `Ref "${ref}" is stale (element removed or page re-rendered). Run find_on_page again.`;
    env.highlight(el);
    const node = env.describe(el);
    if (node.hiddenFromAgents) {
      return clampOutput({ ref: node.ref, role: node.role, name: node.name, note: "Sensitive field: values are never exposed to agents." });
    }
    const out = { ...node };
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      out.options = Array.from(el.options).slice(0, 30).map((o) => ({ value: o.value, label: o.textContent.trim() }));
    }
    if (tag === "a")
      out.href = el.href;
    if ((tag === "input" || tag === "textarea") && !["checkbox", "radio", "password"].includes(el.type ?? "")) {
      out.currentValue = env.redact(el, el.value).slice(0, 200);
    }
    if (tag === "textarea" || !["INPUT", "SELECT", "BUTTON", "A", "TEXTAREA"].includes(el.tagName)) {
      out.text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
    }
    return clampOutput(out);
  }

  // build/src/tools/forms.js
  var MAX_SYNTHESIZED = 8;
  var MAX_OPTIONS_IN_SCHEMA = 24;
  function synthesizeFormTools(env) {
    const tools = [];
    const used = new Set;
    const forms = env.snapshot.forms;
    const priority = (f) => f.hasAttribute("data-agent-priority") ? -1 : 0;
    const sorted = [...forms].sort((a, b) => priority(a) - priority(b)).slice(0, MAX_SYNTHESIZED);
    for (const form of sorted) {
      const info = analyzeForm(form);
      if (!info)
        continue;
      let name = info.name;
      let i = 2;
      while (used.has(name))
        name = `${info.name}_${i++}`;
      used.add(name);
      env.formInfo.set(form, info);
      tools.push(buildTool(env, info, name));
    }
    return tools;
  }
  function analyzeForm(form) {
    const cls = classifyForm(form);
    const rawName = form.getAttribute("data-agent-name") ?? form.getAttribute("data-agent-tool") ?? form.getAttribute("aria-label") ?? form.getAttribute("name") ?? headingNear(form) ?? (cls.kind === "search" ? "search" : slug(form.getAttribute("action") ?? "") || `form_${slug(fieldLabel(cls.fields[0] ?? form) || "form")}`);
    const name = slug(rawName) || "form";
    const fields = [];
    const seenRadios = new Set;
    for (const f of cls.fields) {
      const type = (f.getAttribute("type") ?? "").toLowerCase();
      if (type === "hidden" || type === "submit" || f.disabled)
        continue;
      if (f.closest("[data-agent-hide]"))
        continue;
      if (classifyField(f).level === "never")
        continue;
      if (type === "radio") {
        const key = f.getAttribute("name") ?? "";
        if (key && seenRadios.has(key))
          continue;
        if (key)
          seenRadios.add(key);
        fields.push(radioField(form, f));
        continue;
      }
      fields.push(specFor(f));
    }
    if (!fields.length)
      return null;
    const descOverride = form.getAttribute("data-agent-description");
    const description = (descOverride ?? defaultDesc(cls.kind, name, fields)).slice(0, 460);
    return {
      name,
      description,
      fields,
      kind: cls.kind,
      submitPolicy: submitPolicyOf(form, cls),
      formEl: form,
      hasSubmit: cls.hasSubmit
    };
  }
  function specFor(f) {
    const base = {
      key: f.getAttribute("name") ?? f.id ?? slug(fieldLabel(f)) ?? `field_${Date.now() % 1000}`,
      label: fieldLabel(f) || (f.getAttribute("name") ?? (f.getAttribute("type") ?? "field")),
      el: f,
      type: jsonTypeOf(f),
      required: f.hasAttribute("required") || f.getAttribute("aria-required") === "true",
      description: fieldDesc(f)
    };
    if (base.type === "number") {
      const min = f.min;
      const max = f.max;
      if (min !== "" && !Number.isNaN(+min))
        base.minimum = +min;
      if (max !== "" && !Number.isNaN(+max))
        base.maximum = +max;
    }
    if (f.tagName === "SELECT") {
      const e = selectEnum(f);
      if (e)
        base.enum = e;
    }
    return base;
  }
  function buildTool(env, info, name) {
    const properties = {};
    const required = [];
    for (const f of info.fields) {
      properties[f.key] = {
        type: f.type,
        description: f.description,
        ...f.enum ? { enum: f.enum } : {},
        ...f.minimum !== undefined ? { minimum: f.minimum } : {},
        ...f.maximum !== undefined ? { maximum: f.maximum } : {}
      };
      if (f.required)
        required.push(f.key);
    }
    const submitNote = info.submitPolicy === "auto-submit" ? "Runs the search immediately." : "Fills the form but never submits it — call submit_form when ready.";
    return {
      name,
      description: `${info.description} ${submitNote}`.trim(),
      inputSchema: { type: "object", properties, ...required.length ? { required } : {} },
      annotations: {
        readOnlyHint: info.submitPolicy === "auto-submit",
        untrustedContentHint: true
      },
      execute: async (args) => runFormTool(env, info, args)
    };
  }
  async function runFormTool(env, info, args) {
    const form = info.formEl;
    if (!form.isConnected) {
      return "This form is no longer on the page. Re-orient with get_page_context.";
    }
    const filled = [];
    const refused = [];
    const failed = [];
    for (const f of info.fields) {
      if (!(f.key in args))
        continue;
      const raw = args[f.key];
      if (raw === "" || raw == null)
        continue;
      if (classifyField(f.el).level === "never") {
        refused.push(f.key);
        continue;
      }
      const ok = setControlValue(f.el, raw);
      env.highlight(f.el);
      filled.push({ field: f.label, value: env.redact(f.el, String(raw)), ok });
      if (!ok)
        failed.push(f.key);
    }
    const notProvided = info.fields.filter((f) => f.required && !(f.key in args)).map((f) => f.key);
    if (notProvided.length) {
      return JSON.stringify({ status: "missing-required", required: notProvided, filled });
    }
    if (info.submitPolicy === "auto-submit" && !failed.length) {
      const submit = form.querySelector("[type=submit], button[type=submit], button:not([type])");
      env.highlight(submit ?? form, { sticky: true });
      if (form.requestSubmit && submit)
        form.requestSubmit(submit);
      else if (submit)
        submit.click();
      else
        form.submit();
      env.onActivity({ tool: info.name, phase: "submitted", args });
      return JSON.stringify({
        status: "submitted",
        filled,
        note: "Search executed. Re-orient with get_page_context to see results."
      });
    }
    return JSON.stringify({
      status: "filled",
      filled,
      ...refused.length ? { refused } : {},
      note: "Form filled but NOT submitted. Call submit_form when ready (requires user approval)."
    });
  }
  function jsonTypeOf(f) {
    const t = (f.getAttribute("type") ?? "").toLowerCase();
    return t === "number" || t === "range" ? "number" : "string";
  }
  function selectEnum(f) {
    const opts = Array.from(f.options).filter((o) => !o.disabled).map((o) => o.textContent.trim() || o.value).slice(0, MAX_OPTIONS_IN_SCHEMA);
    return opts.length ? [...new Set(opts)] : undefined;
  }
  function radioField(form, radio) {
    const name = radio.getAttribute("name") ?? "";
    const group = name ? Array.from(form.querySelectorAll(`input[type=radio][name="${escapeCss(form.ownerDocument, name)}"]`)) : [radio];
    return {
      key: name || slug(fieldLabel(radio)) || "choice",
      label: fieldLabel(radio) || name,
      el: radio,
      type: "string",
      required: radio.hasAttribute("required") || radio.getAttribute("aria-required") === "true",
      description: fieldDesc(radio),
      enum: [...new Set(group.map((r) => r.value || radioLabelOf(r)))].slice(0, MAX_OPTIONS_IN_SCHEMA),
      group
    };
  }
  function radioLabelOf(r) {
    return r.labels?.[0]?.textContent?.trim() ?? "";
  }
  function fieldDesc(f) {
    const bits = [];
    const label = fieldLabel(f);
    if (label)
      bits.push(label);
    const placeholder = f.getAttribute("placeholder");
    if (placeholder)
      bits.push(`placeholder: ${placeholder}`);
    const described = f.getAttribute("aria-describedby");
    if (described) {
      const d = f.ownerDocument.getElementById(described.split(/\s+/)[0] ?? "");
      if (d)
        bits.push((d.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80));
    }
    if ((f.getAttribute("type") ?? "") === "email")
      bits.push("email address");
    return bits.join(". ") || "value";
  }
  function headingNear(form) {
    const prev = form.previousElementSibling;
    if (prev && /^H[1-6]$/.test(prev.tagName))
      return (prev.textContent ?? "").trim();
    const aria = form.closest("[aria-label], section, fieldset");
    const h = aria?.querySelector("h1, h2, h3, legend");
    return h ? (h.textContent ?? "").trim() : "";
  }
  function defaultDesc(kind, name, fields) {
    const fl = fields.map((f) => f.label).slice(0, 8).join(", ");
    if (kind === "search")
      return `Search: fill the search fields (${fl}) and run the search.`;
    if (kind === "newsletter")
      return "Subscribe with an email address. Fills the form; never submits.";
    return `Fill the "${name}" form. Fields: ${fl}.`;
  }
  function submitPolicyOf(form, cls) {
    const override = (form.getAttribute("data-agent-submit") ?? "").toLowerCase();
    if (["auto", "auto-submit"].includes(override))
      return "auto-submit";
    if (override === "never" || override === "confirm")
      return "fill-only";
    return cls.submitPolicy;
  }
  function slug(s) {
    return String(s ?? "").toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  }

  // build/src/index.js
  var VERSION = "0.1.0";
  var coreAbort = new AbortController;
  async function boot() {
    if (window.__agentready)
      return;
    window.__agentready = true;
    const config = {
      inspector: true,
      siteName: (document.title ?? "").slice(0, 24) || "AgentReady",
      maxResults: 8,
      ...window.AgentReadyConfig ?? {}
    };
    if (!window.isSecureContext) {
      console.warn("[AgentReady] Not a secure context: document.modelContext requires HTTPS. Tools are still exposed in-page.");
    }
    const inspector = config.inspector ? new Inspector({ siteLabel: config.siteName }) : null;
    const env = createEnv(config, inspector);
    const runtime = new Runtime({
      onActivity: (a) => {
        inspector?.logActivity(a);
        inspector?.setBusy(a.phase === "start");
      }
    });
    await registerCoreTools(runtime, envAwake(env));
    const resynth = await registerFormTools(runtime, env);
    inspector?.setToolCount(runtime.size);
    let debounce;
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
      attributeFilter: ["hidden", "style", "class"]
    });
    exposePublicApi(runtime, env, config);
    console.info(`[AgentReady] v${VERSION} — ${runtime.size} tools registered. Native WebMCP: ${runtime.hasNative ? "yes" : "in-page shim (document.modelContext unavailable)"}`);
  }
  function createEnv(config, inspector) {
    let snapshotCache = null;
    const env = {
      doc: document,
      config,
      formInfo: new Map,
      discover() {
        snapshotCache = discover(document);
        return snapshotCache;
      },
      get snapshot() {
        return snapshotCache ?? this.discover();
      },
      describe: (el) => describeNode(el, document),
      resolveRef,
      isVisible,
      classifyField,
      labelOf: (el) => fieldLabel(el) || cleanText(el).slice(0, 60),
      redact: (el, value) => el && classifyField(el).level === "never" ? "•••••••• (redacted: sensitive field)" : value,
      highlight: (el, opts) => inspector?.highlight(el, opts),
      confirmGate: (req) => inspector ? inspector.confirmGate(req) : Promise.resolve(false),
      onActivity: () => {
        return;
      }
    };
    return env;
  }
  function envAwake(env) {
    return new Proxy(env, {
      get(target, prop) {
        if (prop === "snapshot")
          return target.discover();
        return Reflect.get(target, prop);
      }
    });
  }
  async function registerCoreTools(runtime, env) {
    const core = [
      pageContextTool(env),
      findTool(env),
      readTargetTool(env),
      activateTargetTool(env),
      setFieldTool(env),
      fillFormTool(env),
      submitFormTool(env)
    ];
    for (const tool of core) {
      try {
        await runtime.register(tool, { signal: coreAbort.signal });
      } catch (err) {
        console.warn(`[AgentReady] Could not register core tool ${tool.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  async function registerFormTools(runtime, env) {
    const controller = new AbortController;
    let previous = controller;
    const registerBatch = async () => {
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
        console.warn("[AgentReady] Form synthesis failed:", err instanceof Error ? err.message : err);
      }
    };
    await registerBatch();
    return async function resynth() {
      previous.abort();
      const next = new AbortController;
      const tools = synthesizeFormTools(env);
      for (const t of tools) {
        try {
          await runtime.register(t, { signal: next.signal });
        } catch {}
      }
      previous = next;
    };
  }
  function exposePublicApi(runtime, env, config) {
    const api = {
      version: VERSION,
      hasNativeWebMCP: runtime.hasNative,
      getTools: () => runtime.getTools(),
      executeTool: (name, argsJson, opts) => runtime.executeTool(name, argsJson, opts),
      register: async (def) => {
        const d = def;
        if (!d?.name || !d?.description || typeof d.execute !== "function") {
          throw new Error("AgentReady.register requires { name, description, inputSchema, execute }");
        }
        await runtime.register(d);
        return d.name;
      },
      unregisterAll: () => coreAbort.abort(),
      inspect: () => env.discover(),
      maxOutputChars: MAX_OUTPUT_CHARS
    };
    window.AgentReady = api;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    boot();
  }
})();
