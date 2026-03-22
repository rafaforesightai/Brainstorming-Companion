---
name: brainstorm-companion
description: Visual brainstorming companion — opens a browser window for comparing design mockups, architecture options, and UI prototypes. Agents push HTML content and users interact visually. Sessions are persistent and never time out.
---

# Brainstorm Companion — Complete Agent Reference

## How to Use (pick the right path for your environment)

### Step 1: Detect your environment

```
Can I run Bash commands?
  YES → Do I have brainstorm_* MCP tools available?
    YES → Use MCP tools (simplest)
    NO  → Use CLI via Bash
  NO  → Cannot use this tool

Does the user have a visible browser?
  YES → Normal mode (browser auto-opens or user opens the URL)
  NO  → Headless mode (agent renders + screenshots for the user)

Am I in a VM/container?
  YES → Use --host 0.0.0.0 so the user's browser can reach the server
  NO  → Default 127.0.0.1 is fine
```

### When to use headed vs headless browser

| Scenario | Browser Mode | Why |
|----------|-------------|-----|
| User is at their computer | Headed (default) | User sees and interacts directly |
| Remote agent, user on same machine | Headed (default) | Browser auto-opens for user |
| Remote agent, user on different machine | Headed + `--host 0.0.0.0` | User opens URL from their machine |
| Fully autonomous agent (no user watching) | Headless | Agent renders, screenshots, decides |
| CI/CD or automated testing | Headless | No display available |

For headless rendering, use any headless browser (Puppeteer, Playwright, Chrome `--headless`) to navigate to the brainstorm URL, screenshot, or inspect the DOM.

### Step 2: Check if installed (CLI path only)

```bash
which brainstorm-companion || npm list -g brainstorm-companion
# If not found:
npm install -g brainstorm-companion
# If global install fails:
npx brainstorm-companion@latest start   # works without installing
```

### Step 3: Start and push content

**Path A — MCP tools (if `brainstorm_*` tools are available):**

```
brainstorm_start_session()
// → Returns { url: "http://127.0.0.1:XXXXX" }
// → Tell user to open the URL in their browser

brainstorm_push_screen({ html: "<h2>Option A</h2>...", slot: "a", label: "Design A" })
brainstorm_push_screen({ html: "<h2>Option B</h2>...", slot: "b", label: "Design B" })
brainstorm_read_events({ wait_seconds: 120 })
// → Returns user's choice automatically

brainstorm_stop_session()
```

**Path B — CLI via Bash (works everywhere):**

```bash
# Start server in background (server runs in foreground, must be backgrounded)
brainstorm-companion start --no-open &
# or in Claude Code: use run_in_background: true

# Push content
brainstorm-companion push --html '<h2>Option A</h2>' --slot a --label "Design A"
brainstorm-companion push --html '<h2>Option B</h2>' --slot b --label "Design B"

# Wait for user interaction
brainstorm-companion events --wait 120

# Clean up
brainstorm-companion stop
```

**Path C — VM/container/remote (localhost not reachable from user's browser):**

```bash
# Bind to all interfaces so the user's browser can reach it
brainstorm-companion start --no-open --host 0.0.0.0 &
# → Tell user to open http://<machine-ip>:XXXXX in their browser

# Everything else is the same
brainstorm-companion push --html '<h2>Content</h2>'
brainstorm-companion events --wait 120
brainstorm-companion stop
```

### Step 4: Tell the user the URL

After starting, **always tell the user the URL** from the output so they can open it. The browser may not auto-open in VMs, containers, or remote environments.

## When to Use

- Show visual mockups, UI designs, or layout options
- Compare design alternatives side-by-side (A/B/C)
- Present architecture diagrams (Mermaid), code samples (Prism), or math (KaTeX)
- Get visual feedback — user clicks and preferences captured as events

**Don't use** for plain text, simple data, or anything fine in the terminal.

## Session Lifecycle

- **No setup needed** — `brainstorm_start_session()` works with zero arguments
- **Sessions are persistent** — they stay alive until you call `brainstorm_stop_session`
- **Each start is a clean slate** — no leftover content from previous runs
- **Optional timeout** — pass `idle_timeout_minutes` for auto-cleanup
- **Always stop when done** — `brainstorm_stop_session()` frees port and cleans up

---

## MCP Tools Reference

### brainstorm_start_session

Start the server and open a browser. Works with no arguments. Always creates a fresh session — no leftover content.

```
// Simplest — no args needed:
brainstorm_start_session()
→ { url: "http://127.0.0.1:54321", session_dir: "..." }

// With options:
brainstorm_start_session({
  project_dir: "/path/to/project",  // optional — use cwd for project-local storage
  open_browser: true,                // default: true
  idle_timeout_minutes: 0            // default: 0 = no timeout. Set 30 for auto-cleanup.
})
```

**No arguments required.** Sessions are auto-isolated by working directory — different projects never collide, even without `project_dir`. Pass `project_dir` only if you want session files stored inside the project folder.

**Calling it multiple times is safe** — each call creates a fresh session. Within a single MCP connection, subsequent calls return the existing session. Just call `brainstorm_push_screen` to update content.

### brainstorm_push_screen

Push HTML content to the browser. **The browser auto-reloads instantly** — no manual refresh needed. Call this repeatedly to update the same browser window with new content. You do NOT need to restart the session.

**Single screen mode:**
```
brainstorm_push_screen({
  html: "<h2>Dashboard Layout</h2><p>Content here...</p>"
})
→ { path: "...", slot: null, label: null }
```

**Comparison mode (slots a, b, c):**
```
brainstorm_push_screen({ html: "<h2>Option A</h2>...", slot: "a", label: "Minimal" })
brainstorm_push_screen({ html: "<h2>Option B</h2>...", slot: "b", label: "Sidebar" })
brainstorm_push_screen({ html: "<h2>Option C</h2>...", slot: "c", label: "Hybrid" })
→ Browser shows all three side-by-side with tabs and preference buttons
```

When slots are used, the browser switches to comparison mode with:
- Tab bar for switching between options
- Side-by-side view (toggle to single view with Tab key)
- Preference buttons for picking a favorite
- Keyboard shortcuts: 1/2/3 or a/b/c to switch, Tab to toggle view

### brainstorm_read_events

Read user interaction events. **Use `wait_seconds` to get the user's click automatically** — returns as soon as the user interacts.

**Non-blocking:** If you call any other tool (push, clear, stop) while waiting, the wait is cancelled immediately and the new tool runs. You can always push updated content or stop the session — `wait_seconds` never blocks anything.

```
// Recommended — waits for user's click, returns it automatically:
brainstorm_read_events({ wait_seconds: 120 })
→ { events: [{ type: "click", choice: "grid", text: "Grid Layout" }], count: 1 }

// Immediate (returns whatever is available now):
brainstorm_read_events({})
→ { events: [...], count: N }
```

Set `clear_after_read: true` between brainstorming rounds to avoid stale events.
If the user never clicks, returns `{ events: [], count: 0 }` after the timeout.

### brainstorm_clear_screen

Clear content from the browser.

```
brainstorm_clear_screen({})            // Clear all content
brainstorm_clear_screen({ slot: "a" }) // Clear just slot A
```

### brainstorm_stop_session

Stop the server and clean up session files.

```
brainstorm_stop_session({})
→ { stopped: true }
```

Always call this when done brainstorming to free the port and clean up files.

---

## HTML Content — What to Push

You push HTML **fragments**, not full documents. The frame template wraps your content with theming (auto light/dark mode), a header, and a selection indicator bar.

### Selectable Options (A/B/C choices)

```html
<h2>Choose a Layout</h2>
<p class="subtitle">Select the dashboard structure</p>
<div class="options">
  <div class="option" data-choice="grid" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Grid Layout</h3>
      <p>Cards in a responsive grid, best for dashboards</p>
    </div>
  </div>
  <div class="option" data-choice="list" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content">
      <h3>List Layout</h3>
      <p>Vertical scrolling list, best for feeds</p>
    </div>
  </div>
  <div class="option" data-choice="table" onclick="toggleSelect(this)">
    <div class="letter">C</div>
    <div class="content">
      <h3>Table Layout</h3>
      <p>Dense data table, best for admin panels</p>
    </div>
  </div>
</div>
```

**Key:** `data-choice="value"` + `onclick="toggleSelect(this)"` makes any element clickable and captures the selection as an event. The `.letter` div shows A/B/C badges.

For multi-select, add `data-multiselect` to the container:
```html
<div class="options" data-multiselect>...</div>
```

### Card Grid

```html
<h2>Feature Mockups</h2>
<div class="cards">
  <div class="card" data-choice="dashboard" onclick="toggleSelect(this)">
    <div class="card-image"><div class="placeholder">Dashboard Preview</div></div>
    <div class="card-body">
      <h3>Dashboard</h3>
      <p>Analytics overview with charts</p>
    </div>
  </div>
  <div class="card" data-choice="settings" onclick="toggleSelect(this)">
    <div class="card-image"><div class="placeholder">Settings Preview</div></div>
    <div class="card-body">
      <h3>Settings</h3>
      <p>User preferences panel</p>
    </div>
  </div>
</div>
```

### Mockup Container

```html
<h2>Mobile App — Home Screen</h2>
<div class="mockup">
  <div class="mockup-header">iPhone 15 Pro — 393px</div>
  <div class="mockup-body">
    <div class="mock-nav">Home | Search | Profile</div>
    <div class="mock-content">
      <h3>Welcome back</h3>
      <p>Your feed content here</p>
      <div class="mock-button">Create Post</div>
    </div>
  </div>
</div>
```

### Side-by-Side Comparison

```html
<h2>Before / After</h2>
<div class="split">
  <div>
    <h3>Current</h3>
    <div class="mockup">
      <div class="mockup-body">Old design...</div>
    </div>
  </div>
  <div>
    <h3>Proposed</h3>
    <div class="mockup">
      <div class="mockup-body">New design...</div>
    </div>
  </div>
</div>
```

### Pros and Cons

```html
<h2>Trade-off Analysis</h2>
<div class="pros-cons">
  <div class="pros">
    <h4>Pros</h4>
    <ul>
      <li>Faster development</li>
      <li>Better mobile support</li>
    </ul>
  </div>
  <div class="cons">
    <h4>Cons</h4>
    <ul>
      <li>Larger bundle size</li>
      <li>Learning curve</li>
    </ul>
  </div>
</div>
```

### Mermaid Diagrams

Wrap diagram syntax in `<div class="mermaid">`. CDN is injected automatically.

```html
<h2>System Architecture</h2>
<div class="mermaid">
graph LR
  Client[Browser] --> API[API Server]
  API --> DB[(Database)]
  API --> Cache[(Redis)]
  API --> Queue[Job Queue]
  Queue --> Workers[Background Workers]
</div>
```

Supported: flowchart, sequence, class, state, ER, Gantt, pie.

```html
<h2>Auth Flow</h2>
<div class="mermaid">
sequenceDiagram
  User->>Client: Submit login
  Client->>API: POST /auth/login
  API->>DB: Verify credentials
  DB-->>API: User record
  API-->>Client: JWT token
  Client-->>User: Redirect to dashboard
</div>
```

### Syntax-Highlighted Code

Use `class="language-*"` on `<code>` elements. Prism.js CDN is injected automatically.

```html
<h2>API Response Format</h2>
<pre><code class="language-typescript">
interface ApiResponse<T> {
  data: T;
  status: "success" | "error";
  timestamp: number;
}
</code></pre>
```

### Math (KaTeX)

Use `$$...$$` for display math. KaTeX CDN is injected automatically.

```html
<h2>Loss Function</h2>
<p>$$L = -\sum_{i} y_i \log(\hat{y}_i)$$</p>
```

---

## CSS Classes Quick Reference

| Class | Purpose |
|-------|---------|
| `.options` | Vertical list container for `.option` elements |
| `.option` | Selectable option card (pair with `data-choice` + `onclick="toggleSelect(this)"`) |
| `.option .letter` | A/B/C badge inside an option |
| `.option .content` | Text content inside an option |
| `.cards` | Responsive grid container for `.card` elements |
| `.card` | Grid card with hover effect (pair with `data-choice` + `onclick`) |
| `.card-image` | Image/preview area at top of card |
| `.card-body` | Text area at bottom of card |
| `.mockup` | Browser-window-style container |
| `.mockup-header` | Title bar for mockup (shows viewport label) |
| `.mockup-body` | Content area inside mockup |
| `.split` | Two-column 50/50 side-by-side layout |
| `.pros-cons` | Two-column pros/cons grid |
| `.pros` | Green-tinted column (use with `<h4>Pros</h4>` + `<ul>`) |
| `.cons` | Red-tinted column (use with `<h4>Cons</h4>` + `<ul>`) |
| `.placeholder` | Dashed gray placeholder area |
| `.subtitle` | Muted text below headings |
| `.section` | Block with top margin spacing |
| `.label` | Small uppercase badge |
| `.mock-nav` | Horizontal nav bar mockup |
| `.mock-sidebar` | Sidebar column mockup |
| `.mock-content` | Main content area mockup |
| `.mock-button` | Styled button element |
| `.mock-input` | Styled input field |

---

## Event Types

| Event | When | Key Fields |
|-------|------|-----------|
| `click` | User clicks a `[data-choice]` element | `choice`, `text`, `id` |
| `preference` | User picks a preferred slot in comparison mode | `choice` (slot id) |
| `tab-switch` | User switches tabs in comparison mode | `slot` |
| `view-change` | User toggles side-by-side vs single view | `mode` |

All events include a `timestamp` field (Unix ms).

---

## Workflow Patterns

### Single Decision

```
1. brainstorm_start_session()
2. brainstorm_push_screen({ html: "...options with data-choice..." })
3. brainstorm_read_events({ wait_seconds: 120 })   // blocks until user clicks
4. → User's choice arrives automatically — use it to proceed
5. brainstorm_stop_session()
```

### A/B/C Comparison

```
1. brainstorm_start_session()
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Option A" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "Option B" })
4. brainstorm_read_events({ wait_seconds: 120 })   // blocks until user picks preference
5. → Look for { type: "preference", choice: "a"|"b" }
6. brainstorm_stop_session()
```

### Multi-Round Brainstorming

```
1. brainstorm_start_session()

// Round 1: Layout
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Grid" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "List" })
4. brainstorm_read_events({ wait_seconds: 120, clear_after_read: true })
5. → User chose "Grid" (returned automatically)

// Round 2: Color scheme (clear old slots first)
6. brainstorm_clear_screen({})
7. brainstorm_push_screen({ html: "...", slot: "a", label: "Light" })
8. brainstorm_push_screen({ html: "...", slot: "b", label: "Dark" })
9. brainstorm_read_events({ wait_seconds: 120, clear_after_read: true })
10. → User chose "Dark" (returned automatically)

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

## Best Practices

1. **Zero config** — works with no arguments; isolation is automatic
2. **Always tell the user the URL** — the browser may not auto-open in VMs/containers
3. **Never restart to update content** — just call `push_screen` / `push --html` again
4. **One start per workflow** — within MCP, subsequent calls reuse the session
5. **Push HTML inline, not files** — pass HTML directly, don't create temp files
6. **Push fragments, not full documents** — the frame template handles theming and scroll
7. **Start with `<h2>` heading + `.subtitle`** — describes what the user is looking at
8. **One decision per screen** — don't combine unrelated choices
9. **Use slot labels** — `label` makes comparison tabs readable
10. **Use `data-choice` for interaction** — the built-in `toggleSelect` emits events automatically
11. **Use `wait_seconds` in events** — the user's click returns automatically
12. **Clean up with `stop`** — or use `--timeout` / `idle_timeout_minutes` for auto-cleanup

## Common Mistakes

- **Starting a new session for each update** — DON'T. Call `push_screen` to update the existing browser.
- **Pushing full HTML documents** — push fragments; the frame template adds theming and structure.
- **Creating HTML files on disk then trying to serve them** — DON'T. Pass HTML directly via `--html` or `push_screen({ html })`.
- **Forgetting to stop** — always call `stop` / `brainstorm_stop_session` when done.
- **Going in circles when something fails** — if start works but push fails, check `--session` or the URL. If the browser can't reach localhost (VM/container), use `--host 0.0.0.0` to bind to all interfaces.

## Agent Autonomy

This tool is designed for **agents to operate fully autonomously**. Agents can and should:

- **Run the full workflow** — start, push, read events, stop — without human intervention
- **Verify content** — use `curl`, browser automation, screenshots, or DOM inspection to confirm content renders
- **Adapt to the environment** — detect if MCP tools are available (use them) or fall back to CLI via Bash
- **Handle VMs/containers** — use `--host 0.0.0.0` when localhost isn't reachable, tell user the correct URL
- **Get events automatically** — use `wait_seconds` / `--wait` so user clicks return without polling
- **Recover from failures** — if `push` fails with "no active session", the server may have died; restart it
- **Use npx as fallback** — if `brainstorm-companion` isn't installed, `npx brainstorm-companion@latest` works

### Headless mode (fully autonomous)

When no user is watching or no display is available, agents can render content themselves:

```bash
# Start server
brainstorm-companion start --no-open --host 0.0.0.0 &

# Push content
brainstorm-companion push --html '<h2>Dashboard</h2>...'

# Render and screenshot with headless Chrome
google-chrome --headless --screenshot=/tmp/brainstorm.png http://127.0.0.1:PORT/
# Or with Puppeteer/Playwright in a script

# Verify content via curl
curl -s http://127.0.0.1:PORT/ | grep -o '<h2>[^<]*</h2>'
```

### Troubleshooting for agents

| Problem | Cause | Fix |
|---------|-------|-----|
| "No active session found" after start | Server died (sandbox killed it) | Run start with `run_in_background` or `&` |
| "Session not found: ID" | Wrong base dir | Don't pass `--project-dir` to some commands but not others |
| Browser can't reach URL | VM/container isolation | Use `--host 0.0.0.0` and give user the machine IP |
| `brainstorm-companion: not found` | Not installed | `npm install -g brainstorm-companion` or use `npx` |
| No display available | Headless environment | Use `--no-open` and render with headless browser |
| Content not updating in browser | Stale cache | Already fixed — `Cache-Control: no-store` is set |

---

## Related Documentation

For deeper reference beyond this skill file:

- **[visual-companion.md](./visual-companion.md)** — Detailed usage guide: complete CSS class descriptions, all auto-detected library examples (Mermaid flowcharts/sequence/state, Prism languages, KaTeX math), event handling patterns, content design best practices, and a full multi-step brainstorming workflow walkthrough.
- **[README](https://www.npmjs.com/package/brainstorm-companion)** — Install instructions (global, local, npx), CLI reference, MCP setup for any agent, parallel instances, and architecture overview.
- **CLI help** — Run `brainstorm-companion --help` or `brainstorm-companion <command> --help` for per-command documentation with examples and CSS class reference.
- **Install this skill** — Global: `/install-skill $(npm root -g)/brainstorm-companion/skill/SKILL.md` | Local: `/install-skill ./node_modules/brainstorm-companion/skill/SKILL.md`
