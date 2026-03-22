'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { startServer } = require('./server');

class McpServer {
  constructor() {
    this.sessionDir = null;     // absolute path once session is started
    this.serverInstance = null; // startServer() result
    this.buffer = '';           // stdin buffer
    this._pending = null;       // Promise of the in-flight tool call (for serialization)
    this._cancelWait = null;    // Cancel function for pending read_events wait
  }

  start() {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop(); // keep incomplete last line in buffer
      for (const line of lines) {
        if (line.trim()) this.handleMessage(line.trim());
      }
    });
    process.stdin.on('end', () => this.cleanup());
  }

  respond(id, result) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(msg + '\n');
  }

  respondError(id, code, message) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(msg + '\n');
  }

  handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch {
      // Invalid JSON — ignore
      return;
    }

    const { id, method, params } = msg;

    switch (method) {
      case 'initialize':
        this.respond(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'brainstorm-companion', version: '2.0.1' }
        });
        break;

      case 'notifications/initialized':
        // Notification — no response
        break;

      case 'tools/list':
        this.respond(id, { tools: this.getToolDefinitions() });
        break;

      case 'tools/call':
        this.handleToolCall(id, params);
        break;

      default:
        if (id !== undefined) {
          this.respondError(id, -32601, `Method not found: ${method}`);
        }
        break;
    }
  }

  handleToolCall(id, params) {
    const { name, arguments: args = {} } = params || {};

    // Cancel any pending read_events wait so it doesn't block new calls
    if (name !== 'brainstorm_read_events' && this._cancelWait) {
      this._cancelWait();
      this._cancelWait = null;
    }

    const sendResult = (result) => {
      this.respond(id, {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
      });
    };
    const sendError = (err) => {
      this.respond(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      });
    };

    // Start session is async (waits for 'listening') — serialize it
    if (name === 'brainstorm_start_session') {
      const prev = this._pending || Promise.resolve();
      const next = prev.then(() => {
        try {
          const result = this.toolStartSession(args);
          if (result && typeof result.then === 'function') {
            return result.then(sendResult).catch(sendError);
          }
          sendResult(result);
        } catch (err) { sendError(err); }
      });
      this._pending = next.catch(() => {});
      return;
    }

    // All other tools run immediately (no serialization)
    try {
      let result;
      switch (name) {
        case 'brainstorm_push_screen':  result = this.toolPushScreen(args);  break;
        case 'brainstorm_read_events':  result = this.toolReadEvents(args);  break;
        case 'brainstorm_clear_screen': result = this.toolClearScreen(args); break;
        case 'brainstorm_stop_session': result = this.toolStopSession(args); break;
        default:
          this.respondError(id, -32602, `Unknown tool: ${name}`);
          return;
      }
      if (result && typeof result.then === 'function') {
        result.then(sendResult).catch(sendError);
      } else {
        sendResult(result);
      }
    } catch (err) { sendError(err); }
  }

  getToolDefinitions() {
    return [
      {
        name: 'brainstorm_start_session',
        description: `Start a visual brainstorming session. Opens a browser window where you push HTML and users interact visually.

QUICKSTART — show content and get user's choice:
  brainstorm_start_session()
  brainstorm_push_screen({ html: "<h2>Pick one</h2>..." })
  brainstorm_read_events({ wait_seconds: 120 })    → blocks until user clicks, returns choice
  brainstorm_stop_session()

FULL WORKFLOW:
1. brainstorm_start_session() — no args needed. Returns { url, session_dir }.
2. brainstorm_push_screen({ html }) — browser auto-reloads. Call as many times as needed.
3. brainstorm_read_events({ wait_seconds: 120 }) — BLOCKS until user interacts, then returns events automatically. No polling needed.
4. brainstorm_stop_session() — clean up.

KEY: Use wait_seconds in read_events so the user's click comes back to you automatically. No need to ask the user "what did you pick?" — the event arrives on its own.

Each start is a clean slate — no leftover content. Within one MCP connection, subsequent calls return the existing session. Sessions persist until stopped.

COMPARISON MODE: Push to slots a/b/c with labels for side-by-side view:
  brainstorm_push_screen({ html: "...", slot: "a", label: "Option A" })
  brainstorm_push_screen({ html: "...", slot: "b", label: "Option B" })

CSS CLASSES (themed light/dark, push fragments not full docs):
  .options + .option — Selectable cards with .letter (A/B/C) and .content
  .cards + .card — Grid cards with .card-image and .card-body
  .mockup — Browser-window container (.mockup-header + .mockup-body)
  .split — Two-column layout | .pros-cons — Tradeoff grid (.pros/.cons)
  .mock-nav, .mock-sidebar, .mock-content, .mock-button, .mock-input

INTERACTIVE ELEMENTS:
  Add data-choice="value" onclick="toggleSelect(this)" to capture clicks.
  Example: <div class="option" data-choice="grid" onclick="toggleSelect(this)"><div class="letter">A</div><div class="content"><h3>Grid</h3></div></div>

AUTO-DETECTED (CDN injected): class="mermaid" (diagrams), class="language-*" (syntax), $$...$$ (math)

EVENTS: click (choice,text), preference (choice), tab-switch (slot), view-change (mode)

RULES:
  - Use wait_seconds in read_events — the user's choice comes back automatically
  - NEVER restart to update — just push_screen again
  - Push HTML fragments, not full <html> documents
  - Tell user the browser is ready after pushing
  - Always stop_session when done`,
        inputSchema: {
          type: 'object',
          properties: {
            project_dir: { type: 'string', description: 'Optional. Stores session files under <dir>/.superpowers/brainstorm/. If omitted, auto-isolates by working directory.' },
            port: { type: 'number', description: 'Port to bind to (default: random ephemeral)' },
            open_browser: { type: 'boolean', description: 'Open browser automatically (default: true)' },
            idle_timeout_minutes: { type: 'number', description: 'Auto-stop after N minutes idle (default: 0 = no timeout)' }
          }
        }
      },
      {
        name: 'brainstorm_push_screen',
        description: `Push HTML content to the brainstorm browser window. The browser auto-reloads instantly — call repeatedly to update content without restarting the session.

SINGLE SCREEN: Pass html only. Previous content is replaced.
COMPARISON MODE: Pass html + slot (a/b/c) + label. Browser shows tabs, side-by-side view, and preference buttons.

Push HTML fragments (not full <html> documents). The frame template adds theming, fonts, and scroll handling.

Built-in CSS classes: .options/.option (selectable cards), .cards/.card (grid), .mockup (browser frame), .split (two-column), .pros-cons (tradeoffs).
Interactive: Add data-choice="value" onclick="toggleSelect(this)" to capture clicks as events.
Auto-detected: class="mermaid" (diagrams), class="language-*" (syntax highlighting), $$...$$ (math).`,
        inputSchema: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'HTML fragment to display (not a full document — the frame template wraps it)' },
            slot: { type: 'string', description: 'Slot for comparison mode: a, b, or c. When used, browser shows tabbed comparison view.' },
            label: { type: 'string', description: 'Display label for the slot tab (e.g., "Option A", "Minimal", "Dark Theme")' }
          },
          required: ['html']
        }
      },
      {
        name: 'brainstorm_read_events',
        description: `Read user interaction events from the brainstorm browser. Returns { events: [...], count: N }.

RECOMMENDED: Use wait_seconds (e.g. 120) to block until the user clicks something. This way you get the result automatically — no need to poll or ask the user to confirm.

Event types: click (data-choice element clicked — fields: choice, text, id), preference (slot comparison pick — fields: choice), tab-switch (tab changed — fields: slot), view-change (view toggled — fields: mode). All events include timestamp.

Use clear_after_read: true between brainstorming rounds to avoid stale events.`,
        inputSchema: {
          type: 'object',
          properties: {
            wait_seconds: { type: 'number', description: 'Wait up to N seconds for an event to arrive before returning. Recommended: 120. If 0 or omitted, returns immediately.' },
            clear_after_read: { type: 'boolean', description: 'Clear events after reading (default: false)' }
          }
        }
      },
      {
        name: 'brainstorm_clear_screen',
        description: 'Clear content from the brainstorm browser. Pass slot to clear a specific comparison slot, or omit to clear all content (all slots and screens). Useful between multi-round brainstorming to reset the view before pushing new content.',
        inputSchema: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Clear specific slot (a, b, or c). Omit to clear all content.' }
          }
        }
      },
      {
        name: 'brainstorm_stop_session',
        description: 'Stop the brainstorm companion server and clean up all session files. Always call this when done brainstorming to free the port and remove temp files. Safe to call multiple times.',
        inputSchema: { type: 'object', properties: {} }
      }
    ];
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  toolStartSession(args) {
    // If THIS instance already started a session, return it
    if (this.sessionDir && this.serverInstance && this.serverInstance.url) {
      return { url: this.serverInstance.url, session_dir: this.sessionDir };
    }

    const { project_dir, port = 0, open_browser = true, idle_timeout_minutes = 0 } = args;

    // Clean up any orphaned sessions from previous runs
    const baseDir = project_dir
      ? path.join(project_dir, '.superpowers', 'brainstorm')
      : path.join('/tmp', 'brainstorm-companion');
    try {
      if (fs.existsSync(baseDir)) {
        for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dir = path.join(baseDir, entry.name);
          const infoPath = path.join(dir, '.server-info');
          let alive = false;
          if (fs.existsSync(infoPath)) {
            try {
              const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
              const pid = info.pid || info.serverPid;
              if (pid) { process.kill(pid, 0); alive = true; }
            } catch { /* dead */ }
          }
          if (!alive) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    // Create fresh session dir
    const sessionId = `${process.pid}-${Date.now()}`;
    const sessionDir = path.join(baseDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    this.sessionDir = sessionDir;

    const instance = startServer({
      screenDir: sessionDir,
      host: '127.0.0.1',
      port: port || 0,
      ownerPid: process.pid,
      idleTimeoutMs: idle_timeout_minutes > 0 ? idle_timeout_minutes * 60 * 1000 : 0,
      logFn: (...a) => console.error(...a),
    });

    this.serverInstance = instance;

    // The HTTP server starts asynchronously; return a Promise resolved once
    // the 'listening' event fires and the URL is available.
    return new Promise((resolve, reject) => {
      instance.server.once('listening', () => {
        const url = instance.url;
        if (open_browser) {
          const platform = process.platform;
          let cmd;
          if (platform === 'darwin') cmd = `open "${url}"`;
          else if (platform === 'linux') cmd = `xdg-open "${url}"`;
          else cmd = `start "${url}"`;
          exec(cmd, (err) => {
            if (err) console.error(`Warning: could not open browser: ${err.message}`);
          });
        }
        resolve({ url, session_dir: sessionDir });
      });
      instance.server.once('error', (err) => {
        reject(err);
      });
    });
  }

  toolPushScreen(args) {
    if (!this.sessionDir) {
      throw new Error('No active session. Call brainstorm_start_session first.');
    }
    const { html, slot, label } = args;
    if (!html) throw new Error('html is required');

    let filePath;
    if (slot !== undefined) {
      const slotDir = path.join(this.sessionDir, `slot-${slot.toLowerCase()}`);
      fs.mkdirSync(slotDir, { recursive: true });
      filePath = path.join(slotDir, 'current.html');
      if (label !== undefined) {
        fs.writeFileSync(path.join(slotDir, '.label'), String(label), 'utf8');
      }
    } else {
      // Single-screen mode: clear any existing slot dirs so server doesn't stay in comparison mode
      try {
        const entries = fs.readdirSync(this.sessionDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('slot-')) {
            fs.rmSync(path.join(this.sessionDir, entry.name), { recursive: true, force: true });
          }
        }
      } catch { /* ignore */ }
      filePath = path.join(this.sessionDir, `screen-${Date.now()}.html`);
    }

    fs.writeFileSync(filePath, html, 'utf8');
    return { path: filePath, slot: slot || null, label: label || null };
  }

  toolReadEvents(args) {
    if (!this.sessionDir) {
      return { events: [], count: 0 };
    }
    const { wait_seconds = 0, clear_after_read = false } = args;
    const eventsPath = path.join(this.sessionDir, '.events');

    const readEvents = () => {
      if (!fs.existsSync(eventsPath)) return [];
      try {
        const raw = fs.readFileSync(eventsPath, 'utf8');
        return raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      } catch {
        return [];
      }
    };

    const finish = (events) => {
      if (clear_after_read) {
        try { fs.writeFileSync(eventsPath, '', 'utf8'); } catch { /* ignore */ }
      }
      return { events, count: events.length };
    };

    // Immediate mode
    if (!wait_seconds || wait_seconds <= 0) {
      return finish(readEvents());
    }

    // Wait mode — poll every 500ms until events arrive, cancelled, or timeout
    const deadlineMs = wait_seconds * 1000;
    const pollMs = 500;
    return new Promise((resolve) => {
      let cancelled = false;
      let timer = null;

      // Register cancel so other tool calls can interrupt this wait
      this._cancelWait = () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        resolve(finish(readEvents())); // return whatever we have so far
      };

      const startTime = Date.now();
      const check = () => {
        if (cancelled) return;
        const events = readEvents();
        if (events.length > 0) {
          this._cancelWait = null;
          resolve(finish(events));
          return;
        }
        if (Date.now() - startTime >= deadlineMs) {
          this._cancelWait = null;
          resolve(finish([]));
          return;
        }
        timer = setTimeout(check, pollMs);
      };
      check();
    });
  }

  toolClearScreen(args) {
    if (!this.sessionDir) {
      throw new Error('No active session. Call brainstorm_start_session first.');
    }
    const { slot } = args;
    if (slot) {
      const slotFile = path.join(this.sessionDir, `slot-${slot.toLowerCase()}`, 'current.html');
      try { fs.rmSync(slotFile); } catch { /* ignore if not found */ }
    } else {
      // Clear all top-level html files and slot current.html files
      try {
        const entries = fs.readdirSync(this.sessionDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.html')) {
            fs.rmSync(path.join(this.sessionDir, entry.name));
          }
          if (entry.isDirectory() && entry.name.startsWith('slot-')) {
            const slotCurrent = path.join(this.sessionDir, entry.name, 'current.html');
            try { fs.rmSync(slotCurrent); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    return { cleared: true };
  }

  toolStopSession() {
    if (this.serverInstance) {
      this.serverInstance.shutdown('mcp-stop');
      this.serverInstance = null;
    }
    if (this.sessionDir) {
      try { fs.rmSync(this.sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
      this.sessionDir = null;
    }
    return { stopped: true };
  }

  cleanup() {
    if (this.serverInstance) {
      this.serverInstance.shutdown('stdin-end');
      this.serverInstance = null;
    }
    if (this.sessionDir) {
      try { fs.rmSync(this.sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
      this.sessionDir = null;
    }
  }
}

module.exports = { McpServer };
