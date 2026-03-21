'use strict';

const { parseArgs } = require('node:util');
const { exec, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SessionManager } = require('./session');


// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const HELP = {
  main: `Usage: brainstorm-companion <command> [options]

Opens a browser window for visual brainstorming alongside AI coding sessions.
Agents push HTML content and users interact visually.

Commands:
  start    Start the brainstorm server and open browser
  push     Push HTML content to the browser
  events   Read user interaction events
  clear    Clear content or events
  stop     Stop the server
  status   Show server status

Global Options:
  --project-dir <path>  Session storage location (default: /tmp/brainstorm-companion/)
  --session <id>        Target a specific session (required for parallel instances)
  --mcp                 Run as MCP server (stdio JSON-RPC)
  --help, -h            Show help (use "<command> --help" for command details)

Examples:
  brainstorm-companion start
  brainstorm-companion push --html '<h2>Hello</h2>'
  brainstorm-companion push mockup.html --slot a --label "Option A"
  echo '<h2>World</h2>' | brainstorm-companion push -
  brainstorm-companion events --format json
  brainstorm-companion stop`,

  start: `Usage: brainstorm-companion start [options]

Start the brainstorm server and open a browser window.
Each start creates a new isolated session with its own port and data directory.

Options:
  --project-dir <path>  Session storage location (default: /tmp/brainstorm-companion/)
  --port <number>       Bind to specific port (default: random ephemeral)
  --host <address>      Bind address (default: 127.0.0.1)
  --foreground          Run server in foreground (don't background)
  --no-open             Don't auto-open browser

Output:
  Server started: http://127.0.0.1:<port>
  Session ID: <id>

  Save the Session ID to target this instance with other commands when
  running multiple sessions in parallel.

Examples:
  brainstorm-companion start
  brainstorm-companion start --project-dir ./my-project --no-open
  brainstorm-companion start --port 8080 --foreground`,

  push: `Usage: brainstorm-companion push [<file|->] [options]

Push HTML content to the active brainstorm browser window.
Content auto-reloads in the browser. Supports three input methods:
  - File path:    brainstorm-companion push mockup.html
  - Stdin:        echo '<h2>Hi</h2>' | brainstorm-companion push -
  - Inline:       brainstorm-companion push --html '<h2>Hi</h2>'

For side-by-side comparison, push to named slots (a, b, c):
  brainstorm-companion push --html '<h2>A</h2>' --slot a --label "Design A"
  brainstorm-companion push --html '<h2>B</h2>' --slot b --label "Design B"

Options:
  --html <content>      Inline HTML content
  --slot <a|b|c>        Target slot for comparison mode
  --label <name>        Display label for the slot
  --project-dir <path>  Session storage location
  --session <id>        Target a specific session

CSS Classes Available:
  .options, .option     Selectable option cards (vertical)
  .cards, .card         Grid cards with images
  .mockup               Container with .mockup-header and .mockup-body
  .split                Side-by-side columns
  .pros-cons            Pros/cons comparison grid

Interactive Elements:
  Add data-choice="value" and onclick="toggleSelect(this)" to make
  elements clickable. Clicks are captured as events.

Auto-detected Libraries (CDN injected automatically):
  class="mermaid"       → Mermaid diagram rendering
  class="language-*"    → Prism.js syntax highlighting
  $$ math $$            → KaTeX math rendering`,

  events: `Usage: brainstorm-companion events [options]

Read user interaction events from the active brainstorm session.
Events are generated when users click interactive elements in the browser.

Options:
  --format <json|text>  Output format (default: json)
  --clear               Clear events after reading
  --project-dir <path>  Session storage location
  --session <id>        Target a specific session

Event Types:
  click       User clicked a [data-choice] element
  preference  User selected a preferred option in comparison mode
  tab-switch  User switched tabs in comparison mode
  view-change User toggled view mode in comparison mode

Examples:
  brainstorm-companion events
  brainstorm-companion events --format text --clear
  brainstorm-companion events --session 1234-567890`,

  clear: `Usage: brainstorm-companion clear [options]

Clear content or events from the active session.

Options:
  --slot <a|b|c>        Clear a specific comparison slot
  --all                 Clear all content (all slots and screens)
  --events              Clear events only
  --project-dir <path>  Session storage location
  --session <id>        Target a specific session

Examples:
  brainstorm-companion clear --events
  brainstorm-companion clear --slot a
  brainstorm-companion clear --all`,

  stop: `Usage: brainstorm-companion stop [options]

Stop the brainstorm server and end the session.

Options:
  --project-dir <path>  Session storage location
  --session <id>        Target a specific session

Examples:
  brainstorm-companion stop
  brainstorm-companion stop --session 1234-567890`,

  status: `Usage: brainstorm-companion status [options]

Show information about the active brainstorm session.

Options:
  --project-dir <path>  Session storage location
  --session <id>        Target a specific session

Output includes: Session ID, URL, uptime, event count, and active slots.`,
};

function printHelp(command) {
  console.log(HELP[command] || HELP.main);
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

function getActiveOrExit(projectDir, sessionId) {
  const session = new SessionManager(projectDir, sessionId);
  const active = session.getActive(sessionId);
  if (!active) {
    console.error(sessionId
      ? `Session not found: ${sessionId}`
      : 'No active session found. Use --session <id> if running multiple instances.');
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
      console.log(`Session ID: ${path.basename(sessionDir)}`);
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
        // No BRAINSTORM_OWNER_PID in background mode — the CLI process
        // exits immediately, so the server must live independently.
        // Server still has 30-minute idle timeout for cleanup.
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
    console.log(`Session ID: ${path.basename(sessionDir)}`);

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
      'session':     { type: 'string' },
      'slot':        { type: 'string' },
      'label':       { type: 'string' },
      'html':        { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const sessionId = values['session'] || null;
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
      html = fs.readFileSync('/dev/stdin', 'utf8');
    } else {
      if (!fs.existsSync(fileArg)) {
        console.error(`File not found: ${fileArg}`);
        process.exit(1);
      }
      html = fs.readFileSync(fileArg, 'utf8');
    }
  }

  const { session } = getActiveOrExit(projectDir, sessionId);

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
      'session':     { type: 'string' },
      'format':      { type: 'string', default: 'json' },
      'clear':       { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const sessionId = values['session'] || null;
  const format = values['format'];
  const doClear = values['clear'];

  const { session } = getActiveOrExit(projectDir, sessionId);
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
      'session':     { type: 'string' },
      'slot':        { type: 'string' },
      'all':         { type: 'boolean', default: false },
      'events':      { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const sessionId = values['session'] || null;
  const slot = values['slot'];
  const all = values['all'];
  const eventsOnly = values['events'];

  const { session } = getActiveOrExit(projectDir, sessionId);

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
      'session':     { type: 'string' },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const sessionId = values['session'] || null;
  const { active } = getActiveOrExit(projectDir, sessionId);

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
      'session':     { type: 'string' },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const targetSession = values['session'] || null;
  const session = new SessionManager(projectDir, targetSession);
  const statusInfo = session.getStatus();

  if (!statusInfo) {
    console.error(targetSession
      ? `Session not found: ${targetSession}`
      : 'No active session found.');
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
    printHelp('main');
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}\n`);
    printHelp('main');
    process.exitCode = 1;
    return;
  }

  // Per-command help
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(command);
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

if (!process.argv.includes('--mcp')) {
  main();
} else {
  const { McpServer } = require('./mcp');
  new McpServer().start();
}
