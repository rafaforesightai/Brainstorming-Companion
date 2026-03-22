'use strict';

const { parseArgs } = require('node:util');
const { exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SessionManager } = require('./session');


// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const HELP = {
  main: `Usage: brainstorm-companion <command> [options]

Visual brainstorming tool. Opens a browser, you push HTML, users interact.

Quickstart (3 commands):
  brainstorm-companion start
  brainstorm-companion push --html '<h2>Hello World</h2>'
  brainstorm-companion stop

How it works:
  1. "start" opens a browser (reuses existing session if one is running)
  2. "push" sends HTML to the browser — auto-reloads instantly, every time
  3. "events" reads what the user clicked (choices, preferences)
  4. "stop" ends the session

Commands:
  start    Start server and open browser (or reuse existing session)
  push     Push HTML content — browser auto-reloads each time
  events   Read user interaction events (clicks, preferences)
  clear    Clear content or events
  stop     Stop the server and clean up
  status   Show session info (URL, uptime, slots, events)

Global Options:
  --project-dir <path>  Session storage (default: /tmp/brainstorm-companion/)
  --session <id>        Target a specific session (for parallel use)
  --mcp                 Run as MCP server (stdio JSON-RPC)
  --help, -h            Show help (use "<command> --help" for details)

Comparison mode (side-by-side with tabs):
  brainstorm-companion push --html '<h2>A</h2>' --slot a --label "Grid"
  brainstorm-companion push --html '<h2>B</h2>' --slot b --label "List"

Key concepts:
  - No setup needed — "start" works with zero arguments
  - Push HTML fragments (not full documents) — theming is automatic
  - Use --slot a/b/c + --label for side-by-side comparison
  - Add data-choice="val" onclick="toggleSelect(this)" for clickable elements
  - class="mermaid", class="language-*", $$math$$ auto-detected
  - Sessions persist until stopped — use --timeout <min> for auto-cleanup`,

  start: `Usage: brainstorm-companion start [options]

Start the brainstorm server and open a browser window.

Always creates a fresh session with a clean slate — no leftover content.
Stops any existing session automatically. Server runs in foreground (stays
alive as long as this process runs).

In Claude Code: run with run_in_background so it stays alive while you push content.
In terminal: run in one tab, push from another. Ctrl+C to stop.

Use --reuse to keep an existing session instead of starting fresh.

Options:
  --project-dir <path>  Session storage location (default: /tmp/brainstorm-companion/)
  --port <number>       Bind to specific port (default: random ephemeral)
  --host <address>      Bind address (default: 127.0.0.1)
  --timeout <minutes>   Auto-stop after N minutes of inactivity (default: none)
  --no-open             Don't auto-open browser
  --reuse               Reuse existing session if one is running (keep its content)

Output:
  Server started: http://127.0.0.1:<port>
  Session ID: <id>

Examples:
  brainstorm-companion start
  brainstorm-companion start --project-dir .
  brainstorm-companion start --timeout 30       # auto-stop after 30min idle
  brainstorm-companion start --reuse             # keep existing session`,

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
  --wait <seconds>      Wait for an event to arrive (returns immediately when one does)
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
  brainstorm-companion events --wait 120           # wait for user click, return it
  brainstorm-companion events                       # return events immediately
  brainstorm-companion events --format text --clear`,

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

function printNextSteps() {
  console.log(`
Next steps:
  brainstorm-companion push --html '<h2>Your content</h2>'   Push content to browser
  brainstorm-companion push file.html --slot a --label "A"   Comparison mode
  brainstorm-companion events                                 Read user interactions
  brainstorm-companion events --wait 120                      Wait for user's click
  brainstorm-companion stop                                   Stop when done

Install skill for AI agents (teaches CSS classes, workflows, best practices):
  Global:  /install-skill $(npm root -g)/brainstorm-companion/skill/SKILL.md
  Local:   /install-skill ./node_modules/brainstorm-companion/skill/SKILL.md

Docs: https://www.npmjs.com/package/brainstorm-companion
Help: brainstorm-companion push --help`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      'timeout':     { type: 'string' },
      'no-open':     { type: 'boolean', default: false },
      'reuse':       { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const host = values['host'];
  const port = parseInt(values['port'], 10) || 0;
  const timeoutMin = values['timeout'] ? parseInt(values['timeout'], 10) : 0;
  const idleTimeoutMs = timeoutMin > 0 ? timeoutMin * 60 * 1000 : 0;
  const noOpen = values['no-open'];
  const reuse = values['reuse'];

  const session = new SessionManager(projectDir);

  // Only reuse existing session if explicitly asked with --reuse
  if (reuse) {
    const existing = session.getActive();
    if (existing) {
      const url = existing.serverInfo.url;
      console.log(`Reusing session: ${url}`);
      console.log(`Session ID: ${existing.sessionId}`);
      printNextSteps();
      if (!noOpen) {
        openBrowser(url);
      }
      return;
    }
  }

  // Stop any existing session before starting fresh (clean slate)
  const stale = session.getActive();
  if (stale) {
    const pid = stale.serverInfo.pid || stale.serverInfo.serverPid;
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }
    try { fs.rmSync(stale.sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const { sessionDir } = session.create();

  // Run server in-process (foreground) — this is the only reliable mode
  // across all environments (Claude Code, Codex, Docker, terminals).
  // The calling process must stay alive (use run_in_background in Claude Code).
  const { startServer } = require('./server');
  const instance = startServer({
    screenDir: sessionDir,
    host,
    port,
    ownerPid: process.pid,
    idleTimeoutMs,
  });

  instance.server.once('listening', () => {
    // Write global pointer so push/events/stop find this session
    SessionManager.writeActivePointer(sessionDir);

    console.log(`Server started: ${instance.url}`);
    console.log(`Session ID: ${path.basename(sessionDir)}`);
    printNextSteps();
    if (!noOpen) {
      openBrowser(instance.url);
    }
  });

  instance.server.once('error', (err) => {
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  // Clean up on exit
  const cleanup = (reason) => {
    SessionManager.clearActivePointer();
    instance.shutdown(reason);
    process.exit(0);
  };
  process.on('SIGINT', () => cleanup('sigint'));
  process.on('SIGTERM', () => cleanup('sigterm'));
  process.on('exit', () => {
    SessionManager.clearActivePointer();
  });
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

async function events(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-dir': { type: 'string' },
      'session':     { type: 'string' },
      'wait':        { type: 'string' },
      'format':      { type: 'string', default: 'json' },
      'clear':       { type: 'boolean', default: false },
    },
    strict: false,
  });

  const projectDir = values['project-dir'] || null;
  const sessionId = values['session'] || null;
  const waitSeconds = values['wait'] ? parseInt(values['wait'], 10) : 0;
  const format = values['format'];
  const doClear = values['clear'];

  const { session, active } = getActiveOrExit(projectDir, sessionId);

  let eventList;
  if (waitSeconds > 0) {
    // Poll until events arrive or timeout
    const eventsPath = path.join(active.sessionDir, '.events');
    const deadlineMs = waitSeconds * 1000;
    const pollMs = 500;
    const startTime = Date.now();
    eventList = [];
    while (Date.now() - startTime < deadlineMs) {
      eventList = session.readEvents();
      if (eventList.length > 0) break;
      await sleep(pollMs);
    }
  } else {
    eventList = session.readEvents();
  }

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
