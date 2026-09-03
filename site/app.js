/* AgentReady.js site — thin DOM wiring.
   Sections: theme, copy buttons, tabs, hero highlight sweep, live tool panel, Level 2 tools. */
(function () {
  'use strict';

  var STORAGE_KEY = 'agentready-theme';
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Theme ---------------- */
  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function applyTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      toggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { console.warn('[site] Theme not persisted: storage unavailable.'); }
    }
  }
  applyTheme(currentTheme(), false);
  var toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
    });
  }
  // Follow the OS while the user has not chosen explicitly.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (ev) {
      var stored = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      if (stored !== 'light' && stored !== 'dark') applyTheme(ev.matches ? 'light' : 'dark', false);
    });
  }

  /* ---------------- Copy buttons ---------------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts (file://, plain http on a LAN host).
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('Clipboard unavailable in this context'));
    });
  }
  function flash(btn, state, label) {
    var original = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', original);
    btn.setAttribute('data-state', state);
    btn.textContent = label;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () {
      btn.removeAttribute('data-state');
      btn.textContent = original;
    }, 1800);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-copy'));
      if (!target) return;
      copyText(target.textContent.trim()).then(
        function () { flash(btn, 'done', 'Copied'); },
        function (err) {
          console.warn('[site] Copy failed:', err && err.message ? err.message : err);
          flash(btn, 'fail', 'Select & copy');
          // Make the code selectable at least.
          var range = document.createRange();
          range.selectNodeContents(target);
          var sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }
      );
    });
  });

  /* ---------------- Tabs ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-tabs]'), function (widget) {
    var tabs = Array.prototype.slice.call(widget.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (ev) {
        var next = null;
        if (ev.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (ev.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (ev.key === 'Home') next = tabs[0];
        else if (ev.key === 'End') next = tabs[tabs.length - 1];
        if (next) { ev.preventDefault(); select(next, true); }
      });
    });
  });

  /* ---------------- Hero: highlight sweep ----------------
     Pairs the form field lines on the left with schema lines on the right and
     walks through them, so the derivation reads as cause → effect. */
  (function heroSweep() {
    var fig = document.querySelector('.synth');
    if (!fig || reduceMotion) return;
    var html = fig.querySelector('.pane-html code');
    var json = fig.querySelector('.pane-json code');
    if (!html || !json) return;

    // Wrap each line in a span we can highlight, per pane.
    function wrapLines(codeEl) {
      var parts = codeEl.innerHTML.split('\n');
      codeEl.innerHTML = parts.map(function (line) { return '<span class="ln">' + line + '</span>'; }).join('\n');
      return Array.prototype.slice.call(codeEl.querySelectorAll('.ln'));
    }
    var L = wrapLines(html);
    var R = wrapLines(json);
    // [left line indexes], [right line indexes]
    var pairs = [
      [[0], [1, 2]],               // <form aria-label>  → name / title
      [[1, 2], [6]],               // q                  → "q"
      [[3, 4, 5, 6, 7], [7, 8]],   // select + options   → category enum
      [[8, 9, 10], [9, 10]],       // number min/max     → minimum / maximum
    ];
    var step = 0;
    var timer = null;
    function paint() {
      L.concat(R).forEach(function (el) { el.classList.remove('hl'); });
      var p = pairs[step % pairs.length];
      p[0].forEach(function (i) { if (L[i]) L[i].classList.add('hl'); });
      p[1].forEach(function (i) { if (R[i]) R[i].classList.add('hl'); });
      step++;
    }
    function start() { if (timer) return; paint(); timer = setInterval(paint, 2200); }
    function stop() { clearInterval(timer); timer = null; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { e.isIntersecting ? start() : stop(); });
      }, { threshold: 0.3 }).observe(fig);
    } else {
      start();
    }
  })();

  /* ---------------- Live panel + Level 2 tools ----------------
     Waits for the real agentready.min.js boot, registers two site tools, and
     renders the tool registry from window.AgentReady.getTools(). */
  var SITE_TOOLS = ['get_install_snippet', 'go_to_section'];
  var toolsEl = document.getElementById('live-tools');
  var transportEl = document.getElementById('live-transport');
  var outEl = document.getElementById('live-out');

  function setOut(text, isResult) {
    if (!outEl) return;
    outEl.textContent = text;
    outEl.classList.toggle('is-result', !!isResult);
  }

  function renderTools(api) {
    return api.getTools().then(function (tools) {
      if (!toolsEl) return;
      toolsEl.innerHTML = '';
      tools.forEach(function (t) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = t.name;
        var desc = document.createElement('span');
        desc.className = 'desc';
        desc.textContent = (t.description || '').split(/\.\s|\n/)[0];
        var tag = document.createElement('span');
        tag.className = 'tag';
        var ro = t.annotations && t.annotations.readOnlyHint;
        if (SITE_TOOLS.indexOf(t.name) >= 0) { tag.textContent = 'level 2'; tag.classList.add('site'); }
        else tag.textContent = ro ? 'read' : 'write';
        li.appendChild(name);
        li.appendChild(desc);
        li.appendChild(tag);
        toolsEl.appendChild(li);
      });
      if (transportEl) {
        transportEl.textContent = tools.length + ' tools · ' + (api.hasNativeWebMCP ? 'native WebMCP' : 'in-page shim');
      }
    });
  }

  function registerSiteTools(api) {
    var snippet = document.getElementById('hero-snippet');
    var sections = Array.prototype.slice.call(document.querySelectorAll('main section[id]')).map(function (s) { return s.id; });
    var defs = [
      {
        name: 'get_install_snippet',
        description: 'Return the exact <script> tag that adds AgentReady.js to a website, plus the npm install command.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: function () {
          return JSON.stringify({
            script_tag: snippet ? snippet.textContent.trim() : '',
            npm: 'npm install @willh/agentready',
            docs: 'https://github.com/doggy8088/agentready#readme',
          });
        },
      },
      {
        name: 'go_to_section',
        description: 'Scroll this page to a named section. Sections: ' + sections.join(', ') + '.',
        inputSchema: {
          type: 'object',
          properties: { section: { type: 'string', enum: sections, description: 'Section id to scroll to' } },
          required: ['section'],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: function (args) {
          var el = document.getElementById(String(args.section || ''));
          if (!el) return 'Refused: unknown section "' + args.section + '"';
          el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
          return 'Scrolled to #' + el.id;
        },
      },
    ];
    return Promise.all(defs.map(function (d) {
      return api.register(d).catch(function (err) {
        console.warn('[site] Could not register ' + d.name + ':', err && err.message ? err.message : err);
      });
    }));
  }

  function wireRunButtons(api) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-run]'), function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-run');
        var args = btn.getAttribute('data-args') || '{}';
        btn.setAttribute('aria-busy', 'true');
        setOut('› executeTool("' + name + '", ' + args + ')\n…', false);
        var t0 = performance.now();
        Promise.resolve()
          .then(function () { return api.executeTool(name, args); })
          .then(function (res) {
            var text = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
            var ms = Math.round(performance.now() - t0);
            setOut('› executeTool("' + name + '", ' + args + ')   ' + ms + ' ms · ' + text.length + ' chars\n\n' + pretty(text), true);
          })
          .catch(function (err) {
            setOut('› executeTool("' + name + '") failed\n\n' + (err && err.message ? err.message : String(err)), false);
          })
          .then(function () { btn.removeAttribute('aria-busy'); });
      });
    });
  }
  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }

  (function waitForAgentReady(attempt) {
    var api = window.AgentReady;
    if (api && typeof api.getTools === 'function') {
      registerSiteTools(api)
        .then(function () { return renderTools(api); })
        .then(function () {
          wireRunButtons(api);
          // Show real output right away: a read-only call, exactly what an agent would get.
          var first = document.querySelector('[data-run="get_page_context"]');
          if (first) first.click();
        })
        .catch(function (err) {
          console.warn('[site] Live panel failed:', err && err.message ? err.message : err);
          if (toolsEl) toolsEl.innerHTML = '<li class="live-error">Could not read the tool registry. See the console.</li>';
        });
      return;
    }
    if (attempt > 100) { // ~10 s
      if (toolsEl) toolsEl.innerHTML = '<li class="live-error">agentready.min.js did not load from the CDN. The rest of the page still works; the live panel needs it.</li>';
      if (transportEl) transportEl.textContent = 'not loaded';
      return;
    }
    setTimeout(function () { waitForAgentReady(attempt + 1); }, 100);
  })(0);
})();
