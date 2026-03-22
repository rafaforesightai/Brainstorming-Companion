---
name: brainstorm-companion
description: Visual brainstorming companion — opens a browser window for comparing design mockups, architecture options, and UI prototypes. Agents push HTML content and users interact visually. Sessions are persistent and never time out.
---

# Brainstorm Companion — Complete Agent Reference

## Quickstart (3 calls, no setup)

```
brainstorm_start_session()
brainstorm_push_screen({ html: "<h2>Hello World</h2><p>Your content here</p>" })
brainstorm_stop_session()
```

That's it. No arguments required. A browser opens, your HTML appears, and cleanup happens automatically.

## When to Use

- Show visual mockups, UI designs, or layout options
- Compare design alternatives side-by-side (A/B/C)
- Present architecture diagrams (Mermaid), code samples (Prism), or math (KaTeX)
- Get visual feedback — user clicks and preferences captured as events

**Don't use** for plain text, simple data, or anything fine in the terminal.

## Session Lifecycle

- **No setup needed** — `brainstorm_start_session()` works with zero arguments
- **Sessions are persistent** — they stay alive until you call `brainstorm_stop_session`
- **Safe to call start multiple times** — reuses existing session, never duplicates
- **Optional timeout** — pass `idle_timeout_minutes` for auto-cleanup
- **Always stop when done** — `brainstorm_stop_session()` frees port and cleans up

---

## MCP Tools Reference

### brainstorm_start_session

Start the server and open a browser. Works with no arguments. Reuses existing session if one is running.

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

**Calling it multiple times is safe** — returns the existing session. Just call `brainstorm_push_screen` to update content.

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

Read user interaction events (clicks, preferences).

```
brainstorm_read_events({ clear_after_read: false })
→ { events: [...], count: N }
```

Set `clear_after_read: true` between brainstorming rounds to avoid stale events.

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
3. → Tell user to make their selection in the browser
4. brainstorm_read_events({})
5. → Use the choice to proceed
6. brainstorm_stop_session({})
```

### A/B/C Comparison

```
1. brainstorm_start_session()
2. brainstorm_push_screen({ html: "...", slot: "a", label: "Option A" })
3. brainstorm_push_screen({ html: "...", slot: "b", label: "Option B" })
4. → Tell user to compare and pick a preference
5. brainstorm_read_events({})
6. → Look for { type: "preference", choice: "a"|"b" }
7. brainstorm_stop_session({})
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

## Best Practices

1. **Zero config** — `brainstorm_start_session()` works with no arguments; isolation is automatic
3. **Never restart to update content** — just call `brainstorm_push_screen` again; the browser auto-reloads
4. **One `brainstorm_start_session` per workflow** — it reuses the existing session automatically
5. **Push fragments, not full documents** — the frame template handles `<html>`, theming, and scroll
6. **Start with a heading** — `<h2>` describes what the user is looking at
7. **Add a `.subtitle`** — describes the decision being made
8. **One decision per screen** — don't combine unrelated choices
9. **Use slot labels** — `label` makes comparison tabs readable
10. **Use `data-choice` for interaction** — the built-in `toggleSelect` emits events automatically
11. **Tell the user to interact** — after pushing content, let them know the browser is ready
12. **Read events after user has time** — don't immediately read; wait for user to respond
13. **Clean up with `brainstorm_stop_session`** — or use `idle_timeout_minutes` for auto-cleanup

## Common Mistakes

- **Starting a new session for each update** — DON'T. Call `push_screen` to update the existing browser.
- **Pushing full HTML documents** — push fragments; the frame template adds theming and structure.
- **Reading events immediately after push** — give the user time to interact first.
- **Forgetting to stop** — always call `brainstorm_stop_session` when done, or use `idle_timeout_minutes`.
