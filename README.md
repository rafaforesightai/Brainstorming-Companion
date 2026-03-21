# Brainstorm Companion

Visual brainstorming tool for AI coding sessions. Opens a browser window where agents push HTML content (mockups, diagrams, comparisons) and users interact visually. Selections flow back as structured events.

Zero dependencies. Node.js >= 18 only.

**Sessions are persistent** — they never time out. Sessions stay alive until you explicitly stop them with `stop` or `brainstorm_stop_session`.

## Install

```bash
npm install -g brainstorm-companion
```

Or run directly:

```bash
npx brainstorm-companion start
```

### Claude Code MCP Setup

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

Once configured, the agent has access to 5 tools: `brainstorm_start_session`, `brainstorm_push_screen`, `brainstorm_read_events`, `brainstorm_clear_screen`, and `brainstorm_stop_session`. Full documentation is embedded in the tool descriptions — the agent becomes an expert immediately upon connecting.

---

## Complete Usage Guide

### Quick Start (CLI)

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

### Quick Start (MCP / Agent)

```
1. brainstorm_start_session({ project_dir: "/path/to/project" })
   → { url: "http://127.0.0.1:54321", session_dir: "..." }

2. brainstorm_push_screen({ html: "<h2>Option A</h2>...", slot: "a", label: "Minimal" })
   brainstorm_push_screen({ html: "<h2>Option B</h2>...", slot: "b", label: "Sidebar" })

3. brainstorm_read_events({})
   → { events: [{ type: "preference", choice: "a" }], count: 1 }

4. brainstorm_push_screen({ html: "<h2>Revised A</h2>...", slot: "a", label: "Minimal v2" })

5. brainstorm_stop_session({})
```

**Important:** Call `brainstorm_start_session` once. It returns the existing session if already running. Update content by calling `brainstorm_push_screen` repeatedly — the browser auto-reloads each time. Sessions never time out.

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
| `brainstorm_start_session` | Start server (or reuse existing). Returns URL. Always pass `project_dir`. |
| `brainstorm_push_screen` | Push HTML content. Browser auto-reloads. Use `slot` + `label` for comparison. |
| `brainstorm_read_events` | Read user interaction events. Option to clear after reading. |
| `brainstorm_clear_screen` | Clear a specific slot or all content. |
| `brainstorm_stop_session` | Stop server and clean up session files. |

---

## Workflow Patterns

### Single Decision

```
1. brainstorm_start_session({ project_dir: "..." })
2. brainstorm_push_screen({ html: "...options with data-choice..." })
3. → Tell user to make their selection in the browser
4. brainstorm_read_events({})
5. → Use the choice to proceed
6. brainstorm_stop_session({})
```

### A/B/C Comparison

```
1. brainstorm_start_session({ project_dir: "..." })
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Option A" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "Option B" })
4. → Tell user to compare and pick a preference
5. brainstorm_read_events({})
6. → Look for { type: "preference", choice: "a"|"b" }
7. brainstorm_stop_session({})
```

### Multi-Round Brainstorming

```
1. brainstorm_start_session({ project_dir: "..." })

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
1. brainstorm_start_session({ project_dir: "..." })

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

---

## How It Works

1. `start` checks for an existing active session — reuses it if found, otherwise creates a new one with its own port and directory
2. `push` writes HTML files to the session directory; the file watcher detects changes and broadcasts reload to the browser via WebSocket
3. The browser auto-reloads and renders content in a themed frame with click capture on `[data-choice]` elements
4. Click events are sent over WebSocket to the server and appended to a `.events` JSONL file
5. `events` reads the JSONL file and returns structured JSON
6. Each session is fully isolated: own port, own directory, own event log
7. Sessions are persistent — they stay alive until explicitly stopped with `stop` or `brainstorm_stop_session`

## Best Practices

1. **Always pass `project_dir`** to `brainstorm_start_session` — avoids cross-agent conflicts
2. **Never restart to update content** — just call `brainstorm_push_screen` again; the browser auto-reloads
3. **One `brainstorm_start_session` per workflow** — it reuses the existing session automatically
4. **Push fragments, not full documents** — the frame template handles `<html>`, theming, and scroll
5. **Start with a heading** — `<h2>` describes what the user is looking at
6. **Add a `.subtitle`** — describes the decision being made
7. **One decision per screen** — don't combine unrelated choices
8. **Use slot labels** — `label` makes comparison tabs readable
9. **Use `data-choice` for interaction** — the built-in `toggleSelect` emits events automatically
10. **Tell the user to interact** — after pushing content, let them know the browser is ready
11. **Read events after user has time** — don't immediately read; wait for user to respond
12. **Clean up with `brainstorm_stop_session`** — frees the port and removes temp files

## Common Mistakes

- **Starting a new session for each update** — DON'T. Call `push_screen` to update the existing browser.
- **Omitting `project_dir`** — leads to `/tmp` collisions between agents.
- **Pushing full HTML documents** — push fragments; the frame template adds theming and structure.
- **Reading events immediately after push** — give the user time to interact first.
- **Forgetting to stop** — always call `brainstorm_stop_session` when done.

## Author

Created by [Rafael Maya](https://github.com/rafaforesightai) at [Foresight AI Partners](https://github.com/rafaforesightai).

## License

MIT License. See [LICENSE](LICENSE) for details.
