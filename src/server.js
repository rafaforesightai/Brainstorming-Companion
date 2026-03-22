'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { OPCODES, computeAcceptKey, encodeFrame, decodeFrame } = require('./ws-protocol');
const { detectLibraries, buildInjections } = require('./content-detect');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Idle timeout is DISABLED by default (0 = no timeout).  Sessions stay alive
// until explicitly stopped via `stop` / `brainstorm_stop_session`, or the
// owner process exits.  Pass a positive `idleTimeoutMs` to override.
const DEFAULT_IDLE_TIMEOUT_MS = 0;
const OWNER_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------------------
// Templates (loaded once at module load time)
// ---------------------------------------------------------------------------

const frameTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'frame.html'), 'utf-8');
const helperScript = fs.readFileSync(path.join(__dirname, 'templates', 'helper.js'), 'utf-8');
const waitingPage = fs.readFileSync(path.join(__dirname, 'templates', 'waiting.html'), 'utf-8');
const helperInjection = '<script>\n' + helperScript + '\n</script>';

const comparisonTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'comparison.html'), 'utf-8');
const comparisonHelperScript = fs.readFileSync(path.join(__dirname, 'templates', 'comparison-helper.js'), 'utf-8');
const comparisonHelperInjection = '<script>\n' + comparisonHelperScript + '\n</script>';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function isFullDocument(html) {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function wrapInFrame(content) {
  return frameTemplate.replace('<!-- CONTENT -->', content);
}

// Like wrapInFrame but strips the header and indicator bar (for iframes in comparison mode)
function wrapInEmbed(content) {
  let html = frameTemplate.replace('<!-- CONTENT -->', content);
  // Remove header
  html = html.replace(/<div class="header">[\s\S]*?<\/div>\s*<div class="main">/, '<div class="main">');
  // Remove indicator bar (the actual HTML element, not the CSS)
  html = html.replace(/\s*<div class="indicator-bar" id="indicator-bar">[\s\S]*?<\/div>\s*(?=<\/body>)/, '\n');
  return html;
}

function getNewestScreen(screenDir) {
  let files;
  try {
    files = fs.readdirSync(screenDir);
  } catch {
    return null;
  }

  const htmlFiles = files.filter(f => f.endsWith('.html') && !f.startsWith('.'));
  if (htmlFiles.length === 0) return null;

  let newestFile = null;
  let newestMtime = -1;

  for (const file of htmlFiles) {
    const filePath = path.join(screenDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestFile = filePath;
      }
    } catch {
      // skip unreadable files
    }
  }

  return newestFile;
}

function injectHelper(html) {
  if (html.includes('</body>')) {
    return html.replace('</body>', helperInjection + '\n</body>');
  }
  return html + helperInjection;
}

function getActiveSlots(screenDir) {
  try {
    return fs.readdirSync(screenDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('slot-'))
      .map(e => e.name.replace(/^slot-/, ''))
      .filter(id => fs.existsSync(path.join(screenDir, `slot-${id}`, 'current.html')))
      .map(id => id.toLowerCase());
  } catch { return []; }
}

function getSlotInfo(screenDir) {
  return getActiveSlots(screenDir).map(id => {
    const labelPath = path.join(screenDir, `slot-${id}`, '.label');
    let label = null;
    try { label = fs.readFileSync(labelPath, 'utf8').trim(); } catch {}
    return { id, label };
  });
}

// ---------------------------------------------------------------------------
// startServer — returns synchronously with { server, url, port, broadcast, shutdown }
// url and port are populated once 'listening' fires (server.address()).
// ---------------------------------------------------------------------------

function startServer(config = {}) {
  const {
    screenDir,
    host = '127.0.0.1',
    port: requestedPort = 0,
    ownerPid = null,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    logFn = console.log,
  } = config;

  if (!screenDir) throw new Error('startServer: screenDir is required');

  // Ensure screenDir exists
  fs.mkdirSync(screenDir, { recursive: true });

  // Per-instance state
  const clients = new Set();
  const debounceTimers = new Map();
  let lastActivity = Date.now(); // eslint-disable-line no-unused-vars
  let idleTimer = null;
  let ownerCheckTimer = null;
  let watcher = null;
  let isShuttingDown = false;

  // Mutable result fields populated on 'listening'
  const result = { server: null, url: null, port: null, broadcast, shutdown };

  // -------------------------------------------------------------------------
  // Activity tracking
  // -------------------------------------------------------------------------

  function touchActivity() {
    lastActivity = Date.now();
    resetIdleTimer();
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    // 0 or falsy = no idle timeout — session stays alive until explicitly stopped
    if (!idleTimeoutMs) return;
    idleTimer = setTimeout(() => {
      shutdown('idle-timeout');
    }, idleTimeoutMs);
    // Don't block the event loop
    if (idleTimer.unref) idleTimer.unref();
  }

  // -------------------------------------------------------------------------
  // Broadcast
  // -------------------------------------------------------------------------

  function broadcast(message) {
    const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(message)));
    for (const socket of clients) {
      try {
        socket.write(frame);
      } catch {
        clients.delete(socket);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Message handler (WebSocket TEXT messages)
  // -------------------------------------------------------------------------

  function handleMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    logFn(JSON.stringify({ type: 'ws-event', event }));

    // Append to .events JSONL file if the event has a choice field
    if (event.choice !== undefined) {
      const eventsFile = path.join(screenDir, '.events');
      try {
        fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n', 'utf-8');
      } catch {
        // ignore write errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // HTTP handler
  // -------------------------------------------------------------------------

  function handleRequest(req, res) {
    touchActivity();

    // Strip query string for routing
    const urlPath = req.url.split('?')[0];

    if (req.method === 'GET' && urlPath === '/') {
      const slots = getActiveSlots(screenDir);
      if (slots.length > 0) {
        // Comparison mode
        let html = comparisonTemplate;
        if (html.includes('</body>')) {
          html = html.replace('</body>', comparisonHelperInjection + '\n</body>');
        } else {
          html = html + comparisonHelperInjection;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      } else {
        // Single screen mode
        const screenFile = getNewestScreen(screenDir);
        let html;
        if (screenFile) {
          const raw = fs.readFileSync(screenFile, 'utf-8');
          html = isFullDocument(raw) ? raw : wrapInFrame(raw);
        } else {
          html = waitingPage;
        }
        const needs = detectLibraries(html);
        const cdnTags = buildInjections(needs);
        if (cdnTags && html.includes('</head>')) {
          html = html.replace('</head>', cdnTags + '\n</head>');
        }
        html = injectHelper(html);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      }
      return;
    }

    if (req.method === 'GET' && urlPath.match(/^\/slot\/[a-zA-Z0-9]+$/)) {
      const slotId = urlPath.split('/')[2].toLowerCase();
      const slotFile = path.join(screenDir, `slot-${slotId}`, 'current.html');
      if (!fs.existsSync(slotFile)) {
        res.writeHead(404);
        res.end('Slot not found');
        return;
      }
      const raw = fs.readFileSync(slotFile, 'utf-8');
      // Slots are shown in iframes inside comparison page — skip the header/indicator
      let html = isFullDocument(raw) ? raw : wrapInEmbed(raw);
      const slotNeeds = detectLibraries(html);
      const slotCdnTags = buildInjections(slotNeeds);
      if (slotCdnTags && html.includes('</head>')) {
        html = html.replace('</head>', slotCdnTags + '\n</head>');
      }
      html = injectHelper(html);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/status') {
      const slotInfo = getSlotInfo(screenDir);
      const eventsFile = path.join(screenDir, '.events');
      let eventCount = 0;
      try {
        const raw = fs.readFileSync(eventsFile, 'utf8');
        eventCount = raw.split('\n').filter(l => l.trim()).length;
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mode: slotInfo.length > 0 ? 'comparison' : 'single',
        slots: slotInfo,
        eventCount,
      }));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/files/')) {
      const fileName = req.url.slice(7).split('?')[0];
      const filePath = path.join(screenDir, path.basename(fileName));
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade handler
  // -------------------------------------------------------------------------

  function handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = computeAcceptKey(key);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );

    let buffer = Buffer.alloc(0);
    clients.add(socket);

    socket.on('data', (chunk) => {
      touchActivity();
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length > 0) {
        let result;
        try {
          result = decodeFrame(buffer);
        } catch {
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          clients.delete(socket);
          return;
        }

        if (!result) break;
        buffer = buffer.slice(result.bytesConsumed);

        switch (result.opcode) {
          case OPCODES.TEXT:
            handleMessage(result.payload.toString());
            break;
          case OPCODES.CLOSE:
            socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
            clients.delete(socket);
            return;
          case OPCODES.PING:
            socket.write(encodeFrame(OPCODES.PONG, result.payload));
            break;
          case OPCODES.PONG:
            break;
          default: {
            const closeBuf = Buffer.alloc(2);
            closeBuf.writeUInt16BE(1003);
            socket.end(encodeFrame(OPCODES.CLOSE, closeBuf));
            clients.delete(socket);
            return;
          }
        }
      }
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  function shutdown(reason) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logFn(JSON.stringify({ type: 'server-shutdown', reason }));

    // Remove .server-info
    const serverInfoPath = path.join(screenDir, '.server-info');
    try {
      if (fs.existsSync(serverInfoPath)) fs.unlinkSync(serverInfoPath);
    } catch {
      // ignore
    }

    // Write .server-stopped
    const serverStoppedPath = path.join(screenDir, '.server-stopped');
    try {
      fs.writeFileSync(
        serverStoppedPath,
        JSON.stringify({ type: 'server-stopped', reason, stoppedAt: Date.now(), pid: process.pid }),
        'utf-8'
      );
    } catch {
      // ignore
    }

    // Clear timers
    if (idleTimer) clearTimeout(idleTimer);
    if (ownerCheckTimer) clearInterval(ownerCheckTimer);
    if (slotPollTimer) clearInterval(slotPollTimer);

    // Close watcher
    if (watcher) {
      try { watcher.close(); } catch { /* ignore */ }
    }

    // Close slot watchers
    for (const sw of slotWatchers.values()) {
      try { sw.close(); } catch { /* ignore */ }
    }

    // Close all client sockets
    for (const socket of clients) {
      try {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
      } catch { /* ignore */ }
    }
    clients.clear();

    // Close HTTP server (do not call process.exit — caller decides)
    server.close();
  }

  // -------------------------------------------------------------------------
  // File watcher
  // -------------------------------------------------------------------------

  const knownFiles = new Set(
    fs.readdirSync(screenDir)
      .filter(f => f.endsWith('.html') && !f.startsWith('.'))
  );

  // Track per-slot watchers so we don't double-watch
  const slotWatchers = new Map();

  function watchSlotDir(slotId) {
    if (slotWatchers.has(slotId)) return;
    const slotDir = path.join(screenDir, `slot-${slotId}`);
    try {
      const sw = fs.watch(slotDir, (eventType, filename) => {
        if (!filename) return;
        const key = `slot-${slotId}-${filename}`;
        if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
        debounceTimers.set(key, setTimeout(() => {
          debounceTimers.delete(key);
          touchActivity();
          logFn(JSON.stringify({ type: 'slot-updated', slot: slotId, file: filename }));
          broadcast({ type: 'slot-content', slot: slotId });
        }, 100));
      });
      sw.on('error', () => { slotWatchers.delete(slotId); });
      slotWatchers.set(slotId, sw);
      logFn(JSON.stringify({ type: 'slot-watcher-started', slot: slotId }));
    } catch {
      // slot dir may not exist yet; polling will catch it
    }
  }

  // Start watchers for any slots that already exist
  getActiveSlots(screenDir).forEach(id => watchSlotDir(id));

  try {
    watcher = fs.watch(screenDir, (eventType, filename) => {
      if (!filename) return;

      // Detect new slot-* directories
      if (filename.startsWith('slot-')) {
        const slotId = filename.replace(/^slot-/, '');
        if (!slotWatchers.has(slotId)) {
          // Give it a moment to settle before starting the watcher
          setTimeout(() => {
            const slotDir = path.join(screenDir, filename);
            if (fs.existsSync(slotDir)) {
              watchSlotDir(slotId);
              broadcast({ type: 'slots-update', slots: getSlotInfo(screenDir) });
            }
          }, 200);
        }
        return;
      }

      if (!filename.endsWith('.html') || filename.startsWith('.')) return;

      if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));

      debounceTimers.set(filename, setTimeout(() => {
        debounceTimers.delete(filename);
        const filePath = path.join(screenDir, filename);
        if (!fs.existsSync(filePath)) return;

        touchActivity();

        if (!knownFiles.has(filename)) {
          knownFiles.add(filename);
          // Clear .events on new screen
          const eventsFile = path.join(screenDir, '.events');
          try {
            if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
          } catch { /* ignore */ }
          logFn(JSON.stringify({ type: 'screen-added', file: filePath }));
        } else {
          logFn(JSON.stringify({ type: 'screen-updated', file: filePath }));
        }

        broadcast({ type: 'reload' });
      }, 100));
    });

    watcher.on('error', (err) => {
      logFn(JSON.stringify({ type: 'watcher-error', error: String(err) }));
    });
  } catch (err) {
    logFn(JSON.stringify({ type: 'watcher-start-error', error: String(err) }));
  }

  // Fallback: poll root directory every 2s for new slot-* dirs (macOS fs.watch quirk)
  const knownSlotIds = new Set(getActiveSlots(screenDir));
  const slotPollTimer = setInterval(() => {
    const currentSlots = getActiveSlots(screenDir);
    let changed = false;
    currentSlots.forEach(id => {
      if (!knownSlotIds.has(id)) {
        knownSlotIds.add(id);
        watchSlotDir(id);
        changed = true;
        logFn(JSON.stringify({ type: 'slot-detected-poll', slot: id }));
      }
    });
    if (changed) {
      broadcast({ type: 'slots-update', slots: getSlotInfo(screenDir) });
    }
  }, 2000);
  if (slotPollTimer.unref) slotPollTimer.unref();

  // -------------------------------------------------------------------------
  // Owner PID monitoring
  // -------------------------------------------------------------------------

  if (ownerPid) {
    ownerCheckTimer = setInterval(() => {
      try {
        process.kill(ownerPid, 0);
      } catch {
        shutdown('owner-pid-died');
      }
    }, OWNER_CHECK_INTERVAL_MS);
    if (ownerCheckTimer.unref) ownerCheckTimer.unref();
  }

  // -------------------------------------------------------------------------
  // HTTP server — start listening
  // -------------------------------------------------------------------------

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  // Write .server-info once we know the actual port
  server.once('listening', () => {
    const addr = server.address();
    const port = addr.port;
    const url = `http://${host}:${port}`;

    result.url = url;
    result.port = port;

    const serverInfo = {
      type: 'server-started',
      port,
      host,
      url,
      screen_dir: screenDir,
      pid: process.pid,
      startedAt: Date.now(),
    };
    try {
      fs.writeFileSync(
        path.join(screenDir, '.server-info'),
        JSON.stringify(serverInfo),
        'utf-8'
      );
    } catch {
      // ignore
    }

    logFn(JSON.stringify({ type: 'server-started', port, host, url }));
  });

  resetIdleTimer();

  // Use port 0 when requestedPort is 0 to get a random ephemeral port;
  // otherwise use the requested port or generate a random one in the
  // ephemeral range (49152-65535).
  const listenPort = requestedPort === 0
    ? 0
    : (requestedPort || Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152);

  server.listen(listenPort, host);

  // Assign server reference to result before returning
  result.server = server;

  return result;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { startServer };

// Standalone entry point
if (require.main === module) {
  const screenDir = process.env.BRAINSTORM_DIR || '/tmp/brainstorm';
  const instance = startServer({
    screenDir,
    host: process.env.BRAINSTORM_HOST || '127.0.0.1',
    port: process.env.BRAINSTORM_PORT ? parseInt(process.env.BRAINSTORM_PORT, 10) : 0,
    idleTimeoutMs: process.env.BRAINSTORM_IDLE_TIMEOUT ? parseInt(process.env.BRAINSTORM_IDLE_TIMEOUT, 10) : 0,
  });
  instance.server.on('listening', () => {
    console.log(JSON.stringify({ type: 'server-ready', url: instance.url }));
  });
  instance.server.on('error', (err) => {
    console.error(JSON.stringify({ type: 'server-error', error: String(err) }));
    process.exit(1);
  });
}
