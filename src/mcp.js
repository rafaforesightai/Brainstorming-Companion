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
          serverInfo: { name: 'brainstorm-companion', version: '1.1.0' }
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
        description: 'Start a brainstorm companion server and open a browser window for visual brainstorming. Returns the URL.',
        inputSchema: {
          type: 'object',
          properties: {
            project_dir: { type: 'string', description: 'Project directory for session storage' },
            port: { type: 'number', description: 'Port to bind to (default: random)' },
            open_browser: { type: 'boolean', description: 'Whether to open the browser (default: true)' }
          }
        }
      },
      {
        name: 'brainstorm_push_screen',
        description: 'Push HTML content to the brainstorm browser window. Supports comparison mode via slots.',
        inputSchema: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'HTML content to display' },
            slot: { type: 'string', description: 'Slot for comparison mode: a, b, or c' },
            label: { type: 'string', description: 'Label for the slot' }
          },
          required: ['html']
        }
      },
      {
        name: 'brainstorm_read_events',
        description: 'Read user interaction events (clicks, preferences) from the brainstorm browser.',
        inputSchema: {
          type: 'object',
          properties: {
            clear_after_read: { type: 'boolean', description: 'Clear events after reading (default: false)' }
          }
        }
      },
      {
        name: 'brainstorm_clear_screen',
        description: 'Clear content from the brainstorm browser window.',
        inputSchema: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Clear specific slot (a, b, or c). Omit to clear all.' }
          }
        }
      },
      {
        name: 'brainstorm_stop_session',
        description: 'Stop the brainstorm companion server and clean up.',
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

    const { project_dir, port = 0, open_browser = true } = args;

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
