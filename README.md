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

# 2. Push content
brainstorm-companion push --html '<h2>Dashboard Layout</h2><div class="options"><div class="option" data-choice="grid" onclick="toggleSelect(this)"><div class="letter">A</div><div class="content"><h3>Grid Layout</h3><p>Cards in a responsive grid</p></div></div><div class="option" data-choice="list" onclick="toggleSelect(this)"><div class="letter">B</div><div class="content"><h3>List Layout</h3><p>Vertical scrolling list</p></div></div></div>'

# 3. Read user's selection
brainstorm-companion events
# → [{"type":"click","choice":"grid","text":"A Grid Layout Cards in a responsive grid","timestamp":1700000001234}]

# 4. Stop when done
brainstorm-companion stop
```

### Side-by-Side Comparison

Push to named slots for comparison mode with tabs and preference selection:

```bash
brainstorm-companion push --html '<h2>Minimal Navigation</h2><p>Top bar only, clean and simple</p>' --slot a --label "Minimal"
brainstorm-companion push --html '<h2>Full Sidebar</h2><p>Persistent sidebar with icons</p>' --slot b --label "Sidebar"
brainstorm-companion push --html '<h2>Hybrid</h2><p>Collapsible sidebar + top bar</p>' --slot c --label "Hybrid"
```

Browser shows all three side-by-side with tabs, keyboard shortcuts (1/2/3), and a preference bar.

### From Files or Stdin

```bash
brainstorm-companion push mockup.html
brainstorm-companion push mockup.html --slot a --label "v1"
cat design.html | brainstorm-companion push -
```

### Parallel Instances

Multiple agents can run simultaneously on the same project without interference:

```bash
# Agent A
brainstorm-companion start --project-dir .
# → Session ID: 1111-000

# Agent B
brainstorm-companion start --project-dir .
# → Session ID: 2222-000

# Each targets its own session
brainstorm-companion push --html '<h2>A</h2>' --session 1111-000
brainstorm-companion push --html '<h2>B</h2>' --session 2222-000
brainstorm-companion events --session 1111-000
brainstorm-companion stop --session 1111-000
```

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
| `brainstorm_start_session` | Start server and open browser. Returns URL and session directory. |
| `brainstorm_push_screen` | Push HTML content. Use `slot` + `label` for comparison mode. |
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

4. brainstorm_stop_session({})
```

## CLI Reference

```
brainstorm-companion <command> [options]

Commands:
  start    Start the brainstorm server and open browser
  push     Push HTML content to the browser
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
brainstorm-companion start [--project-dir <path>] [--port <N>] [--host <H>] [--foreground] [--no-open]
```

Creates a new session, starts the HTTP+WebSocket server on a random port, and opens the default browser. Prints the URL and Session ID.

### `push`

```
brainstorm-companion push [<file|->] [--html <content>] [--slot a|b|c] [--label <name>]
```

Three input methods: file path, stdin (`-`), or inline (`--html`). Use `--slot` for comparison mode.

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

1. `start` creates an isolated session directory and spawns an HTTP+WebSocket server on a random port
2. `push` writes HTML files to the session directory; the file watcher detects changes and broadcasts reload to connected browsers via WebSocket
3. The browser renders content in a themed frame with click capture on `[data-choice]` elements
4. Click events are sent over WebSocket to the server and appended to a `.events` JSONL file
5. `events` reads the JSONL file and returns structured JSON
6. Each session is fully isolated: own port, own directory, own event log

## License

MIT
