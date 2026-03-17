'use strict';

const { parseArgs } = require('node:util');
const { exec, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SessionManager } = require('./session');

// MCP mode check (early exit)
if (process.argv.includes('--mcp')) {
  console.error('MCP mode not yet implemented');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: brainstorm-companion <command> [options]

Commands:
  start    Start the brainstorm server
  push     Push HTML content to the browser
  events   Read user interaction events
  clear    Clear content or events
  stop     Stop the server
  status   Show server status

Options:
  --mcp    Run as MCP server
  --help   Show this help`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollForServerInfo(sessionDir, timeoutMs = 5000, intervalMs = 100) {
  const serverInfoPath = path.join(sessionDir, '.server-info');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(serverInfoPath)) {
      try {
        const raw = fs.readFileSync(serverInfoPath, 'utf8');
        const info = JSON.parse(raw);
        if (info.url) return info;
      } catch {
        // file may be partially written, retry
      }
    }
    await sleep(intervalMs);
  }
  return null;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'linux') {
    cmd = `xdg-open "${url}"`;
  } else {
    cmd = `start "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.error(`Warning: could not open browser: ${err.message}`);
    }
  });
}

function getActiveOrExit(projectDir) {
  const session = new SessionManager(projectDir);
  const active = session.getActive();
  if (!active) {
    console.error('No active session found.');
    process.exit(1);
  }
  return { session, active };
}

// ---------------------------------------------------------------------------
// Command: start
// ---------------------------------------------------------------------------

async function start(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
      'port':        { type: 'string', default: '0' },
      'host':        { type: 'string', default: '127.0.0.1' },
      'foreground':  { type: 'boolean', default: false },
      'no-open':     { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const host = values['host'];
  const port = parseInt(values['port'], 10) || 0;
  const foreground = values['foreground'];
  const noOpen = values['no-open'];

  const session = new SessionManager(projectDir);
  const { sessionDir } = session.create();

  if (foreground) {
    // Run server in-process
    const { startServer } = require('./server');
    const instance = startServer({
      screenDir: sessionDir,
      host,
      port,
      ownerPid: process.pid,
    });

    instance.server.once('listening', () => {
      console.log(`Server started: ${instance.url}`);
      if (!noOpen) {
        openBrowser(instance.url);
      }
    });

    instance.server.once('error', (err) => {
      console.error(`Server error: ${err.message}`);
      process.exit(1);
    });

    // Keep process alive
    process.on('SIGINT', () => {
      instance.shutdown('sigint');
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      instance.shutdown('sigterm');
      process.exit(0);
    });
  } else {
    // Background the server
    const serverScript = path.join(__dirname, 'server.js');
    const child = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        BRAINSTORM_DIR: sessionDir,
        BRAINSTORM_HOST: host,
        BRAINSTORM_PORT: String(port),
        BRAINSTORM_OWNER_PID: String(process.pid),
      },
    });
    child.unref();

    // Poll for .server-info
    const serverInfo = await pollForServerInfo(sessionDir, 5000, 100);
    if (!serverInfo) {
      console.error('Timed out waiting for server to start.');
      process.exit(1);
    }

    console.log(`Server started: ${serverInfo.url}`);

    if (!noOpen) {
      openBrowser(serverInfo.url);
    }
  }
}

// ---------------------------------------------------------------------------
// Command: push
// ---------------------------------------------------------------------------

async function push(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
      'slot':        { type: 'string' },
      'label':       { type: 'string' },
      'html':        { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const slot = values['slot'];
  const label = values['label'];
  let html = values['html'];

  if (!html) {
    const fileArg = positionals[0];
    if (!fileArg) {
      console.error('Usage: brainstorm-companion push <file|-> [--slot a|b|c] [--label "name"] [--html "<content>"]');
      process.exit(1);
    }
    if (fileArg === '-') {
      // Read from stdin
      html = fs.readFileSync('/dev/stdin', 'utf8');
    } else {
      if (!fs.existsSync(fileArg)) {
        console.error(`File not found: ${fileArg}`);
        process.exit(1);
      }
      html = fs.readFileSync(fileArg, 'utf8');
    }
  }

  const session = new SessionManager(projectDir);
  const active = session.getActive();
  if (!active) {
    console.error('No active session found.');
    process.exit(1);
  }

  const result = session.pushScreen(html, { slot, label });
  console.log(`Content pushed to ${result.path}`);
  if (slot) {
    console.log(`Slot: ${slot}${label ? ` (${label})` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Command: events
// ---------------------------------------------------------------------------

function events(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
      'format':      { type: 'string', default: 'json' },
      'clear':       { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const format = values['format'];
  const doClear = values['clear'];

  const session = new SessionManager(projectDir);
  const eventList = session.readEvents();

  if (format === 'text') {
    if (eventList.length === 0) {
      console.log('No events.');
    } else {
      for (const ev of eventList) {
        const ts = ev.timestamp ? new Date(ev.timestamp).toISOString() : '';
        console.log(`[${ts}] ${ev.type || 'event'}: ${ev.choice !== undefined ? ev.choice : JSON.stringify(ev)}`);
      }
    }
  } else {
    // Default: json
    console.log(JSON.stringify(eventList, null, 2));
  }

  if (doClear) {
    session.clearEvents();
  }
}

// ---------------------------------------------------------------------------
// Command: clear
// ---------------------------------------------------------------------------

function clear(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
      'slot':        { type: 'string' },
      'all':         { type: 'boolean', default: false },
      'events':      { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const slot = values['slot'];
  const all = values['all'];
  const eventsOnly = values['events'];

  const session = new SessionManager(projectDir);
  const active = session.getActive();
  if (!active) {
    console.error('No active session found.');
    process.exit(1);
  }

  if (eventsOnly) {
    session.clearEvents();
    console.log('Events cleared.');
  } else if (slot) {
    session.clearSlot(slot);
    console.log(`Slot ${slot} cleared.`);
  } else if (all) {
    session.clearAll();
    console.log('All content cleared.');
  } else {
    console.error('Specify --slot <a|b|c>, --all, or --events');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: stop
// ---------------------------------------------------------------------------

function stop(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const session = new SessionManager(projectDir);
  const active = session.getActive();
  if (!active) {
    console.error('No active session found.');
    process.exit(1);
  }

  const { serverInfo } = active;
  const pid = serverInfo.pid || serverInfo.serverPid;
  if (!pid) {
    console.error('No PID found in server info.');
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Server (PID ${pid}) stopped.`);
  } catch (err) {
    console.error(`Failed to stop server: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------

function status(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const session = new SessionManager(projectDir);
  const statusInfo = session.getStatus();

  if (!statusInfo) {
    console.error('No active session found.');
    process.exit(1);
  }

  const { sessionId, sessionDir, slots, eventCount, uptime, url } = statusInfo;

  console.log(`Session ID : ${sessionId}`);
  console.log(`Session Dir: ${sessionDir}`);
  console.log(`URL        : ${url || '(unknown)'}`);

  if (uptime !== null) {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    let uptimeStr;
    if (hours > 0) {
      uptimeStr = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      uptimeStr = `${minutes}m ${seconds % 60}s`;
    } else {
      uptimeStr = `${seconds}s`;
    }
    console.log(`Uptime     : ${uptimeStr}`);
  }

  console.log(`Events     : ${eventCount}`);

  if (slots.length > 0) {
    console.log('Slots:');
    for (const s of slots) {
      const label = s.label ? ` (${s.label})` : '';
      const content = s.hasContent ? 'has content' : 'empty';
      console.log(`  [${s.slot}]${label}: ${content}`);
    }
  } else {
    console.log('Slots      : none');
  }
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

const COMMANDS = { start, push, events, clear, stop, status };

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  // Wrap async handlers
  const result = handler(args.slice(1));
  if (result && typeof result.then === 'function') {
    result.catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    });
  }
}

main();
