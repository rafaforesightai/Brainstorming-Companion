---
name: brainstorm-companion
description: Visual brainstorming companion — opens a browser window for comparing design mockups, architecture options, and UI prototypes. Agents push HTML content and users interact visually.
---

# Brainstorm Companion

## When to Use

Use this tool when you need to:
- Show visual mockups, UI designs, or layout options to the user
- Compare multiple design alternatives side-by-side (A/B/C comparison)
- Present architecture diagrams (Mermaid), code samples (Prism), or math (KaTeX)
- Get visual feedback — user clicks and preferences are captured as events
- Show interactive prototypes or wireframes

**Don't use** for plain text output, simple data, or anything that works fine in the terminal.

## MCP Tools Reference

### brainstorm_start_session

Start the server and open a browser window.

```
brainstorm_start_session({
  project_dir: "/path/to/project",  // ALWAYS pass this — use the current working directory
  open_browser: true,                // default: true
  port: 0                            // default: random
})
→ { url: "http://127.0.0.1:54321", session_dir: "..." }
```

**Always pass `project_dir`** — this keeps session files with the project and avoids conflicts between agents. Without it, all sessions go to `/tmp/brainstorm-companion/` and may collide.

The server runs independently in the background with a 30-minute idle timeout. It survives the calling process exiting.

### brainstorm_push_screen

Push HTML content to the browser. The browser auto-reloads — no manual refresh needed.

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

## Event Types

| Event | When | Key Fields |
|-------|------|-----------|
| `click` | User clicks a `[data-choice]` element | `choice`, `text`, `id` |
| `preference` | User picks a preferred slot in comparison mode | `choice` (slot id) |
| `tab-switch` | User switches tabs in comparison mode | `slot` |
| `view-change` | User toggles side-by-side vs single view | `mode` |

All events include a `timestamp` field (Unix ms).

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

## Best Practices

1. **Always pass `project_dir`** to `brainstorm_start_session` — avoids cross-agent conflicts
2. **Push fragments, not full documents** — the frame template handles `<html>`, theming, and scroll
3. **Start with a heading** — `<h2>` describes what the user is looking at
4. **Add a `.subtitle`** — describes the decision being made
5. **One decision per screen** — don't combine unrelated choices
6. **Use slot labels** — `label` makes comparison tabs readable
7. **Use `data-choice` for interaction** — the built-in `toggleSelect` emits events automatically
8. **Tell the user to interact** — after pushing content, let them know the browser is ready
9. **Read events after user has time** — don't immediately read; wait for user to respond
10. **Clean up with `brainstorm_stop_session`** — frees the port and removes temp files
