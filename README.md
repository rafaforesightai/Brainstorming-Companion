# Brainstorm Companion

Visual brainstorming tool for AI coding sessions. Opens a browser window where agents push HTML content (mockups, diagrams, comparisons) and users interact visually. Selections flow back as structured events.

Zero dependencies. Node.js >= 18 only.

## Install

```bash
npm install -g brainstorm-companion
```

Or run directly:

```bash
npx brainstorm-companion start
```

## Quick Start

### CLI

```bash
# 1. Start server (opens browser automatically)
brainstorm-companion start --project-dir .
# → Server started: http://127.0.0.1:54321
# → Session ID: 1234-1700000000000

# 2. Push content — browser updates instantly
brainstorm-companion push --html '<h2>Dashboard Layout</h2><div class="options"><div class="option" data-choice="grid" onclick="toggleSelect(this)"><div class="letter">A</div><div class="content"><h3>Grid Layout</h3><p>Cards in a responsive grid</p></div></div><div class="option" data-choice="list" onclick="toggleSelect(this)"><div class="letter">B</div><div class="content"><h3>List Layout</h3><p>Vertical scrolling list</p></div></div></div>'

# 3. Update content — same browser, no restart needed
brainstorm-companion push --html '<h2>Updated Layout</h2><p>Refined version based on feedback</p>'

# 4. Read user's selection
brainstorm-companion events
# → [{"type":"click","choice":"grid","text":"A Grid Layout Cards in a responsive grid","timestamp":1700000001234}]

# 5. Stop when done
brainstorm-companion stop
```

**Key behavior:** Calling `start` when a session is already running reuses it — no duplicate browsers. Just keep calling `push` to update the same window. The browser auto-reloads on every push.

### Side-by-Side Comparison

Push to named slots for comparison mode with tabs and preference selection:

```bash
brainstorm-companion push --html '<h2>Minimal Navigation</h2><p>Top bar only, clean and simple</p>' --slot a --label "Minimal"
brainstorm-companion push --html '<h2>Full Sidebar</h2><p>Persistent sidebar with icons</p>' --slot b --label "Sidebar"
brainstorm-companion push --html '<h2>Hybrid</h2><p>Collapsible sidebar + top bar</p>' --slot c --label "Hybrid"
```

Browser shows all three side-by-side with tabs, keyboard shortcuts (1/2/3), and a preference bar.

### Updating Content In-Place

The browser auto-reloads whenever content is pushed. No need to restart the session or manually refresh:

```bash
# Initial mockup
brainstorm-companion push --html '<h2>v1</h2><p>First draft</p>'
# → Browser shows v1

# Refined mockup — same browser window updates automatically
brainstorm-companion push --html '<h2>v2</h2><p>Improved based on feedback</p>'
# → Browser shows v2

# Update a single slot in comparison mode
brainstorm-companion push --html '<h2>Updated Option A</h2>' --slot a --label "Revised"
# → Only slot A updates, others stay
```

### From Files or Stdin

```bash
brainstorm-companion push mockup.html
brainstorm-companion push mockup.html --slot a --label "v1"
cat design.html | brainstorm-companion push -
```

### Parallel Instances

Multiple agents can run simultaneously on the same project. Use `--new` to force a separate session:

```bash
# Agent A
brainstorm-companion start --project-dir . --new
# → Session ID: 1111-000

# Agent B
brainstorm-companion start --project-dir . --new
# → Session ID: 2222-000

# Each targets its own session
brainstorm-companion push --html '<h2>A</h2>' --session 1111-000
brainstorm-companion push --html '<h2>B</h2>' --session 2222-000
brainstorm-companion events --session 1111-000
brainstorm-companion stop --session 1111-000
```

Without `--new`, `start` reuses the existing session (the default for single-agent use).

## MCP Server

Brainstorm Companion runs as an [MCP](https://modelcontextprotocol.io) server for direct integration with AI coding tools.

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["brainstorm-companion", "--mcp"]
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `brainstorm_start_session` | Start server (or reuse existing). Returns URL. Always pass `project_dir`. |
| `brainstorm_push_screen` | Push HTML content. Browser auto-reloads. Use `slot` + `label` for comparison. |
| `brainstorm_read_events` | Read user interaction events. Option to clear after reading. |
| `brainstorm_clear_screen` | Clear a specific slot or all content. |
| `brainstorm_stop_session` | Stop server and clean up session files. |

### MCP Workflow Example

```
1. brainstorm_start_session({ project_dir: "/path/to/project" })
   → { url: "http://127.0.0.1:54321", session_dir: "..." }

2. brainstorm_push_screen({ html: "<h2>Option A</h2>...", slot: "a", label: "Minimal" })
   brainstorm_push_screen({ html: "<h2>Option B</h2>...", slot: "b", label: "Sidebar" })

3. brainstorm_read_events({})
   → { events: [{ type: "preference", choice: "a" }], count: 1 }

   // Update content — same browser, no restart
4. brainstorm_push_screen({ html: "<h2>Revised A</h2>...", slot: "a", label: "Minimal v2" })

5. brainstorm_stop_session({})
```

**Important:** Call `brainstorm_start_session` once. It returns the existing session if already running. Update content by calling `brainstorm_push_screen` repeatedly — the browser auto-reloads each time.

## CLI Reference

```
brainstorm-companion <command> [options]

Commands:
  start    Start the brainstorm server (reuses existing session by default)
  push     Push HTML content to the browser (auto-reloads)
  events   Read user interaction events
  clear    Clear content or events
  stop     Stop the server
  status   Show server status

Global Options:
  --project-dir <path>  Session storage location (default: /tmp/brainstorm-companion/)
  --session <id>        Target a specific session (for parallel instances)
  --mcp                 Run as MCP server (stdio JSON-RPC)
  --help, -h            Show help (use "<command> --help" for command details)
```

### `start`

```
brainstorm-companion start [--project-dir <path>] [--port <N>] [--host <H>] [--foreground] [--no-open] [--new]
```

If a session is already running, prints its URL and reuses it. Use `--new` to force a separate parallel session.

### `push`

```
brainstorm-companion push [<file|->] [--html <content>] [--slot a|b|c] [--label <name>]
```

Three input methods: file path, stdin (`-`), or inline (`--html`). Use `--slot` for comparison mode. The browser auto-reloads on every push — no restart needed.

### `events`

```
brainstorm-companion events [--format json|text] [--clear]
```

Returns JSON array of user interaction events. Event types: `click`, `preference`, `tab-switch`, `view-change`.

### `clear`

```
brainstorm-companion clear [--slot a|b|c | --all | --events]
```

### `stop`

```
brainstorm-companion stop
```

### `status`

```
brainstorm-companion status
```

Shows Session ID, URL, uptime, event count, and active slots.

## HTML Content Guide

### Built-in CSS Classes

The frame template provides themed styles (auto light/dark mode):

| Class | Purpose |
|-------|---------|
| `.options` + `.option` | Selectable vertical option cards with letter badges |
| `.cards` + `.card` | Grid cards with `.card-image` and `.card-body` |
| `.mockup` | Container with `.mockup-header` and `.mockup-body` |
| `.split` | Side-by-side two-column layout |
| `.pros-cons` | Pros/cons comparison with `.pros` and `.cons` |
| `.placeholder` | Dashed placeholder area |
| `.mock-nav`, `.mock-sidebar`, `.mock-content` | UI mockup building blocks |
| `.mock-button`, `.mock-input` | Styled form elements |

### Making Elements Interactive

Add `data-choice` and `onclick="toggleSelect(this)"` to capture user selections:

```html
<div class="option" data-choice="grid" onclick="toggleSelect(this)">
  <div class="letter">A</div>
  <div class="content"><h3>Grid Layout</h3></div>
</div>
```

For multi-select, add `data-multiselect` to the container:

```html
<div class="options" data-multiselect>...</div>
```

### Auto-detected Libraries

Content is automatically enhanced when these patterns are detected:

| Pattern | Library | What it does |
|---------|---------|-------------|
| `class="mermaid"` | Mermaid | Renders diagrams from text |
| `class="language-*"` | Prism.js | Syntax highlighting |
| `$$...$$` or `class="math"` | KaTeX | Math rendering |

```html
<div class="mermaid">
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[Other]
</div>
```

## How It Works

1. `start` checks for an existing active session — reuses it if found, otherwise creates a new one with its own port and directory
2. `push` writes HTML files to the session directory; the file watcher detects changes and broadcasts reload to the browser via WebSocket
3. The browser auto-reloads and renders content in a themed frame with click capture on `[data-choice]` elements
4. Click events are sent over WebSocket to the server and appended to a `.events` JSONL file
5. `events` reads the JSONL file and returns structured JSON
6. Each session is fully isolated: own port, own directory, own event log
7. Server runs independently with a 30-minute idle timeout; `stop` cleans up immediately

## Author

Created by [Rafael Maya](https://github.com/rafaforesightai) at [Foresight AI Partners](https://github.com/rafaforesightai).

## License

MIT License. See [LICENSE](LICENSE) for details.
