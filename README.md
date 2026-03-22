# Brainstorm Companion

Visual brainstorming tool for AI coding sessions. Opens a browser window where agents push HTML content (mockups, diagrams, comparisons) and users interact visually. Selections flow back as structured events.

Zero dependencies. Node.js >= 18 only.

**Sessions are persistent** — they stay alive until you explicitly stop them with `stop` or `brainstorm_stop_session`. Use `--timeout <minutes>` if you want auto-cleanup.

## Install

```bash
npm install -g brainstorm-companion
```

### Claude Code MCP Setup

Add to `~/.claude/.mcp.json` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "brainstorm-companion",
      "args": ["--mcp"]
    }
  }
}
```

Then restart Claude Code. The agent gets 5 tools (`brainstorm_start_session`, `brainstorm_push_screen`, `brainstorm_read_events`, `brainstorm_clear_screen`, `brainstorm_stop_session`) with full usage docs embedded — it knows how to use them immediately.

**Alternative (no global install):** Use `npx` instead:
```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["brainstorm-companion@latest", "--mcp"]
    }
  }
}
```

---

## Complete Usage Guide

### Quick Start (CLI) — 3 commands, zero config

```bash
brainstorm-companion start                                    # opens browser
brainstorm-companion push --html '<h2>Hello World</h2>'       # shows content
brainstorm-companion stop                                     # cleans up
```

That's it. No arguments required. Now a fuller example:

```bash
# Start (opens browser, prints URL)
brainstorm-companion start
# → Server started: http://127.0.0.1:54321

# Push content — browser updates instantly
brainstorm-companion push --html '<h2>Dashboard</h2><p>First draft</p>'

# Update — same browser, auto-reloads
brainstorm-companion push --html '<h2>Dashboard v2</h2><p>Refined</p>'

# Read what user clicked
brainstorm-companion events

# Done
brainstorm-companion stop
```

**Key behaviors:**
- `start` with no args works immediately — auto-isolates by working directory
- `start` reuses an existing session — never opens duplicate browsers
- `push` auto-reloads the browser every time — no restart or refresh needed

### Quick Start (MCP / Agent) — 3 calls, zero config

```
1. brainstorm_start_session()
   → { url: "http://127.0.0.1:54321", session_dir: "..." }

2. brainstorm_push_screen({ html: "<h2>Option A</h2>...", slot: "a", label: "Minimal" })
   brainstorm_push_screen({ html: "<h2>Option B</h2>...", slot: "b", label: "Sidebar" })

3. brainstorm_read_events({})
   → { events: [{ type: "preference", choice: "a" }], count: 1 }

4. brainstorm_push_screen({ html: "<h2>Revised A</h2>...", slot: "a", label: "Minimal v2" })

5. brainstorm_stop_session({})
```

**No arguments required.** Sessions auto-isolate by working directory — different projects never collide. Sessions persist until `brainstorm_stop_session()` — use `idle_timeout_minutes` for auto-cleanup.

---

## Side-by-Side Comparison

Push to named slots for comparison mode with tabs and preference selection:

```bash
brainstorm-companion push --html '<h2>Minimal Navigation</h2><p>Top bar only, clean and simple</p>' --slot a --label "Minimal"
brainstorm-companion push --html '<h2>Full Sidebar</h2><p>Persistent sidebar with icons</p>' --slot b --label "Sidebar"
brainstorm-companion push --html '<h2>Hybrid</h2><p>Collapsible sidebar + top bar</p>' --slot c --label "Hybrid"
```

Browser shows all three side-by-side with tabs, keyboard shortcuts (1/2/3), and a preference bar.

## Updating Content In-Place

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

## From Files or Stdin

```bash
brainstorm-companion push mockup.html
brainstorm-companion push mockup.html --slot a --label "v1"
cat design.html | brainstorm-companion push -
```

## Parallel Instances

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

---

## HTML Content Guide

### Built-in CSS Classes

The frame template provides themed styles (auto light/dark mode). Push HTML **fragments**, not full documents — the frame wraps your content with theming, a header, and a selection indicator bar.

| Class | Purpose |
|-------|---------|
| `.options` + `.option` | Selectable vertical option cards with letter badges |
| `.option .letter` | A/B/C badge inside an option |
| `.option .content` | Text content inside an option |
| `.cards` + `.card` | Grid cards with `.card-image` and `.card-body` |
| `.mockup` | Browser-window container with `.mockup-header` and `.mockup-body` |
| `.split` | Side-by-side two-column layout |
| `.pros-cons` | Pros/cons comparison with `.pros` (green) and `.cons` (red) |
| `.placeholder` | Dashed placeholder area |
| `.subtitle` | Muted text below headings |
| `.section` | Block with top margin spacing |
| `.label` | Small uppercase badge |
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

Content is automatically enhanced when these patterns are detected (CDN injected automatically):

| Pattern | Library | What it does |
|---------|---------|-------------|
| `class="mermaid"` | Mermaid | Renders diagrams (flowchart, sequence, class, state, ER, Gantt, pie) |
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

---

## Event Types

| Event | When | Key Fields |
|-------|------|-----------|
| `click` | User clicks a `[data-choice]` element | `choice`, `text`, `id`, `timestamp` |
| `preference` | User picks a preferred slot in comparison mode | `choice` (slot id), `timestamp` |
| `tab-switch` | User switches tabs in comparison mode | `slot`, `timestamp` |
| `view-change` | User toggles side-by-side vs single view | `mode`, `timestamp` |

---

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `brainstorm_start_session` | Start server (or reuse existing). No args needed. Returns URL. |
| `brainstorm_push_screen` | Push HTML content. Browser auto-reloads. Use `slot` + `label` for comparison. |
| `brainstorm_read_events` | Read user interactions. Use `wait_seconds: 120` to get clicks automatically. Never blocks other tools. |
| `brainstorm_clear_screen` | Clear a specific slot or all content. |
| `brainstorm_stop_session` | Stop server and clean up session files. |

---

## Workflow Patterns

### Single Decision

```
1. brainstorm_start_session()
2. brainstorm_push_screen({ html: "...options with data-choice..." })
3. brainstorm_read_events({ wait_seconds: 120 })   // returns when user clicks
4. → User's choice arrives automatically
5. brainstorm_stop_session()
```

### A/B/C Comparison

```
1. brainstorm_start_session()
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Option A" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "Option B" })
4. brainstorm_read_events({ wait_seconds: 120 })   // returns when user picks
5. → { type: "preference", choice: "a"|"b" }
6. brainstorm_stop_session()
```

### Multi-Round Brainstorming

```
1. brainstorm_start_session()

// Round 1: Layout
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Grid" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "List" })
4. brainstorm_read_events({ clear_after_read: true })
5. → User chose "Grid"

// Round 2: Color scheme (clear old slots first)
6. brainstorm_clear_screen({})
7. brainstorm_push_screen({ html: "...", slot: "a", label: "Light" })
8. brainstorm_push_screen({ html: "...", slot: "b", label: "Dark" })
9. brainstorm_read_events({ clear_after_read: true })
10. → User chose "Dark"

// Show final summary
11. brainstorm_push_screen({ html: "<h2>Decisions: Grid + Dark</h2>..." })
12. brainstorm_stop_session({})
```

### Progressive Refinement

```
1. brainstorm_start_session()

// Show initial mockup
2. brainstorm_push_screen({ html: "...v1 mockup..." })
3. → Get feedback from user (text in chat, not events)

// Push refined version — browser auto-reloads
4. brainstorm_push_screen({ html: "...v2 mockup with changes..." })
5. → Iterate until user is satisfied

6. brainstorm_stop_session({})
```

---

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
brainstorm-companion start [--project-dir <path>] [--port <N>] [--host <H>] [--timeout <min>] [--foreground] [--no-open] [--new]
```

If a session is already running, prints its URL and reuses it. Use `--new` to force a separate parallel session. Use `--timeout 30` for auto-cleanup after 30 minutes idle (default: no timeout).

### `push`

```
brainstorm-companion push [<file|->] [--html <content>] [--slot a|b|c] [--label <name>]
```

Three input methods: file path, stdin (`-`), or inline (`--html`). Use `--slot` for comparison mode. The browser auto-reloads on every push — no restart needed.

### `events`

```
brainstorm-companion events [--wait <seconds>] [--format json|text] [--clear]
```

Use `--wait 120` to wait for the user's click and return it automatically. Without `--wait`, returns immediately. Never blocks other operations. Event types: `click`, `preference`, `tab-switch`, `view-change`.

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

---

## How It Works

1. `start` checks for an existing active session — reuses it if found, otherwise creates a new one with its own port and directory
2. `push` writes HTML files to the session directory; the file watcher detects changes and broadcasts reload to the browser via WebSocket
3. The browser auto-reloads and renders content in a themed frame with click capture on `[data-choice]` elements
4. Click events are sent over WebSocket to the server and appended to a `.events` JSONL file
5. `events` reads the JSONL file and returns structured JSON; with `wait_seconds`, it waits for the user's click and returns it automatically (non-blocking — other tools still work)
6. Each session is fully isolated: own port, own directory, own event log
7. Sessions are persistent — they stay alive until explicitly stopped with `stop` or `brainstorm_stop_session`

## Best Practices

1. **Zero config** — `brainstorm_start_session()` and `brainstorm-companion start` work with no arguments; sessions auto-isolate by working directory
3. **Never restart to update content** — just call `push_screen` / `push` again; the browser auto-reloads
4. **One start per workflow** — `start` reuses the existing session automatically
5. **Push fragments, not full documents** — the frame template handles `<html>`, theming, and scroll
6. **Start with a heading** — `<h2>` describes what the user is looking at
7. **Add a `.subtitle`** — describes the decision being made
8. **One decision per screen** — don't combine unrelated choices
9. **Use slot labels** — `label` makes comparison tabs readable
10. **Use `data-choice` for interaction** — the built-in `toggleSelect` emits events automatically
11. **Tell the user to interact** — after pushing content, let them know the browser is ready
12. **Read events after user has time** — don't immediately read; wait for user to respond
13. **Use `--timeout <min>` for auto-cleanup** — or call `stop` / `brainstorm_stop_session` when done

## Common Mistakes

- **Starting a new session for each update** — DON'T. Call `push_screen` to update the existing browser.
- **Pushing full HTML documents** — push fragments; the frame template adds theming and structure.
- **Reading events immediately after push** — give the user time to interact first.
- **Forgetting to stop** — always call `brainstorm_stop_session` / `stop` when done, or use `--timeout`.

## Author

Created by [Rafael Maya](https://github.com/rafaforesightai) at [Foresight AI Partners](https://github.com/rafaforesightai).

## License

MIT License. See [LICENSE](LICENSE) for details.
