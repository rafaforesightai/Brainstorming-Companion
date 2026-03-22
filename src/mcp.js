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
    // Serialize tool calls: each waits for the previous to finish. This ensures
    // that brainstorm_start_session (async) responds before subsequent tools run.
    const prev = this._pending || Promise.resolve();
    const next = prev.then(() => {
      const { name, arguments: args = {} } = params || {};
      let resultOrPromise;
      try {
        switch (name) {
          case 'brainstorm_start_session': resultOrPromise = this.toolStartSession(args); break;
          case 'brainstorm_push_screen':  resultOrPromise = this.toolPushScreen(args);  break;
          case 'brainstorm_read_events':  resultOrPromise = this.toolReadEvents(args);  break;
          case 'brainstorm_clear_screen': resultOrPromise = this.toolClearScreen(args); break;
          case 'brainstorm_stop_session': resultOrPromise = this.toolStopSession(args); break;
          default:
            this.respondError(id, -32602, `Unknown tool: ${name}`);
            return;
        }
      } catch (err) {
        this.respond(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        });
        return;
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

      if (resultOrPromise && typeof resultOrPromise.then === 'function') {
        return resultOrPromise.then(sendResult).catch(sendError);
      } else {
        sendResult(resultOrPromise);
      }
    });
    // Track the tail of the chain; errors in earlier steps shouldn't block later ones
    this._pending = next.catch(() => {});
  }

  getToolDefinitions() {
    return [
      {
        name: 'brainstorm_start_session',
        description: `Start a visual brainstorming session. Opens a browser window where you push HTML and users interact visually.

QUICKSTART — just these 3 calls:
  brainstorm_start_session()                                          → opens browser
  brainstorm_push_screen({ html: "<h2>Hello</h2><p>Content</p>" })   → shows content
  brainstorm_stop_session()                                           → cleans up

FULL WORKFLOW:
1. Call brainstorm_start_session ONCE (no args required — works immediately). Returns { url, session_dir }.
2. Call brainstorm_push_screen with HTML — browser auto-reloads. Call as many times as needed.
3. Call brainstorm_read_events to get user clicks/preferences.
4. Call brainstorm_stop_session when done.

If a session is already running, this returns the existing URL (safe to call repeatedly).
Sessions persist until explicitly stopped — no timeout by default.

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
  - NEVER restart to update — just push_screen again
  - Push HTML fragments, not full <html> documents
  - Tell user the browser is ready after pushing
  - Give user time before reading events
  - Always stop_session when done`,
        inputSchema: {
          type: 'object',
          properties: {
            project_dir: { type: 'string', description: 'Project directory for session storage. Optional — defaults to /tmp/brainstorm-companion/. Pass cwd for project-local storage.' },
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

Event types: click (data-choice element clicked — fields: choice, text, id), preference (slot comparison pick — fields: choice), tab-switch (tab changed — fields: slot), view-change (view toggled — fields: mode). All events include timestamp.

Use clear_after_read: true between brainstorming rounds to avoid reading stale events from the previous round.
Give the user time to interact before reading — don't read immediately after pushing content.`,
        inputSchema: {
          type: 'object',
          properties: {
            clear_after_read: { type: 'boolean', description: 'Clear events after reading to avoid stale data in next round (default: false)' }
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
    // If already started, return existing URL
    if (this.sessionDir && this.serverInstance && this.serverInstance.url) {
      return { url: this.serverInstance.url, session_dir: this.sessionDir };
    }

    const { project_dir, port = 0, open_browser = true, idle_timeout_minutes = 0 } = args;

    // Determine base directory and create session dir
    const baseDir = project_dir
      ? path.join(project_dir, '.superpowers', 'brainstorm')
      : '/tmp/brainstorm-companion';
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
      filePath = path.join(this.sessionDir, `screen-${Date.now()}.html`);
    }

    fs.writeFileSync(filePath, html, 'utf8');
    return { path: filePath, slot: slot || null, label: label || null };
  }

  toolReadEvents(args) {
    if (!this.sessionDir) {
      return { events: [], count: 0 };
    }
    const { clear_after_read = false } = args;
    const eventsPath = path.join(this.sessionDir, '.events');
    let events = [];
    if (fs.existsSync(eventsPath)) {
      try {
        const raw = fs.readFileSync(eventsPath, 'utf8');
        events = raw
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } catch {
        events = [];
      }
    }
    if (clear_after_read) {
      try { fs.writeFileSync(eventsPath, '', 'utf8'); } catch { /* ignore */ }
    }
    return { events, count: events.length };
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
