# Visual Companion — Detailed Usage Guide

This guide covers advanced usage patterns for the Brainstorm Companion tool.

---

## When to Use Browser vs Terminal

| Content Type | Use Browser | Use Terminal |
|---|---|---|
| UI mockups / wireframes | Yes | No |
| A/B/C design comparisons | Yes | No |
| Architecture diagrams (Mermaid) | Yes | No |
| Code review / diffs | Maybe | Yes |
| Plain text output | No | Yes |
| Data tables | Maybe | Yes |
| Math / equations (KaTeX) | Yes | No |
| Syntax-highlighted code examples | Yes | No |
| Interactive prototypes | Yes | No |

**Rule of thumb:** If it benefits from visual layout or user click-interaction, use the browser. If it's just information delivery, use the terminal.

---

## Complete CSS Class Reference

### Layout Classes

**`.options`** — Flex container for side-by-side option cards. Use as a wrapper around multiple `.option` elements.

**`.option`** — Individual option card with border and padding. Becomes highlighted on click when paired with `data-choice` and `onclick="toggleSelect(this)"`.

**`.cards`** — Grid container for card layouts. Responds to 1–4 children with appropriate column widths.

**`.card`** — Individual card with shadow and rounded corners. Good for feature tiles or comparison items.

**`.split`** — Two-column 50/50 split layout. First child goes left, second goes right.

**`.mockup`** — Framed browser-window-style container. Gives content a realistic viewport feel.

**`.mockup-header`** — Title bar for the mockup frame. Shows the "browser chrome" header row.

**`.mockup-body`** — Content area inside the mockup frame. Scrollable, padded content region.

### Interactive Classes

Elements with `data-choice="value"` and `onclick="toggleSelect(this)"` become selectable. When clicked:
- A visual highlight ring appears
- A `preference` event is emitted with the choice value
- Clicking again deselects

```html
<div class="option" data-choice="minimal" onclick="toggleSelect(this)">
  <h3>Minimal Nav</h3>
  <p>Clean top bar only</p>
</div>
```

### Styling Classes

**`.pros-cons`** — Two-column pros/cons container.

**`.pros`** — Green-tinted column for positive points. Prefix items with `+`.

**`.cons`** — Red-tinted column for negative points. Prefix items with `-`.

**`.placeholder`** — Gray placeholder block. Use to represent images, media, or unfinished sections.

**`.subtitle`** — Muted smaller text below headings.

**`.section`** — Section block with top border separator.

**`.label`** — Small uppercase badge/tag for categorizing content.

### Mock UI Classes

**`.mock-nav`** — Horizontal navigation bar mockup.

**`.mock-sidebar`** — Left sidebar mockup column.

**`.mock-content`** — Main content area mockup.

**`.mock-button`** — Styled button placeholder.

**`.mock-input`** — Styled input field placeholder.

---

## Auto-detected Libraries

The frame automatically injects CDN libraries when it detects matching content patterns. No setup required.

### Mermaid Diagrams

Wrap diagram syntax in a `<div class="mermaid">` block:

```html
<div class="mermaid">
graph TD
  A[User Request] --> B{Auth Check}
  B -->|Pass| C[Route Handler]
  B -->|Fail| D[401 Response]
  C --> E[Database Query]
  E --> F[JSON Response]
</div>
```

Supported diagram types: flowchart, sequence, class, state, ER, Gantt, pie.

### Syntax Highlighting (Prism)

Wrap code in `<pre><code>` with a `language-*` class:

```html
<pre><code class="language-typescript">
interface BrainstormEvent {
  type: "click" | "preference";
  choice: string;
  text?: string;
  timestamp: number;
}
</code></pre>
```

Supported languages include: javascript, typescript, python, rust, go, bash, json, css, html, sql.

### Math (KaTeX)

Inline math with `$...$`, display math with `$$...$$`:

```html
<p>The loss function is $$L = -\sum_{i} y_i \log(\hat{y}_i)$$</p>
<p>Where inline <span>$\hat{y} = \sigma(Wx + b)$</span> is the prediction.</p>
```

---

## Event Handling Patterns

### Basic Polling

After pushing content, give the user time to interact, then read events:

```
brainstorm_push_screen({ html: "..." })
// ... wait for user to interact ...
brainstorm_read_events()
```

### Clearing Events Between Rounds

When running multi-round comparisons, clear events between rounds to avoid stale data:

```
brainstorm_read_events({ clear_after_read: true })  // read and clear in one call
brainstorm_clear_screen({})                          // clear content for next round
brainstorm_push_screen({ html: "Round 2..." })       // push next round
```

### Interpreting Events

```json
// User clicked an element with data-choice="sidebar"
{"type": "click", "choice": "sidebar", "text": "Full Sidebar Layout", "timestamp": 1710000000}

// User used the built-in preference buttons (A/B/C buttons in comparison mode)
{"type": "preference", "choice": "b", "timestamp": 1710000001}
```

- `click` events are triggered by `data-choice` elements the user clicks
- `preference` events are triggered by the slot comparison buttons (A, B, C labels in comparison view)
- Multiple events may arrive — look for the most recent or most frequent choice

---

## Content Design Best Practices

1. **Keep HTML focused.** The frame provides the outer shell (theme, fonts, scrolling). Push only the inner content — no `<html>`, `<head>`, or `<body>` tags needed.

2. **Use headings for context.** Start with an `<h2>` that names what the user is looking at.

3. **Add a `.subtitle`** below the heading to describe the decision being made.

4. **Label pros and cons explicitly.** Users make better decisions when trade-offs are surfaced.

5. **One decision per screen.** Don't push multiple unrelated choices at once. Push one question per `push_screen` call.

6. **Use slot labels.** When using comparison slots, always include a `label` parameter so the slot tabs are readable.

7. **Prefer data-choice over custom JS.** The built-in `toggleSelect` + `data-choice` pattern automatically emits events. Custom `onclick` handlers don't.

---

## Mermaid Diagram Examples

### System Architecture

```html
<h2>Proposed Architecture</h2>
<div class="mermaid">
graph LR
  CLI[CLI / npx] --> Server[HTTP Server :7891]
  MCP[MCP Tools] --> Server
  Server --> State[State Store]
  Server --> SSE[SSE /events]
  Browser[Browser] -->|polls| Server
  Browser -->|clicks| Server
</div>
```

### Sequence Diagram

```html
<h2>Auth Flow</h2>
<div class="mermaid">
sequenceDiagram
  participant User
  participant Client
  participant API
  participant DB

  User->>Client: Login form submit
  Client->>API: POST /auth/login
  API->>DB: SELECT user WHERE email=?
  DB-->>API: User record
  API-->>Client: JWT token
  Client-->>User: Redirect to dashboard
</div>
```

### State Machine

```html
<h2>Order States</h2>
<div class="mermaid">
stateDiagram-v2
  [*] --> Pending
  Pending --> Confirmed: payment_success
  Pending --> Cancelled: timeout
  Confirmed --> Shipped: fulfillment
  Shipped --> Delivered: delivery_scan
  Delivered --> [*]
  Cancelled --> [*]
</div>
```

---

## Multi-step Brainstorming Workflow Example

This example shows a full workflow for choosing a navigation pattern for a new app.

### Step 1: Start session and present the question

```
brainstorm_start_session()  // no args needed — opens browser automatically

brainstorm_push_screen({
  html: `
    <h2>Navigation Pattern Decision</h2>
    <p class="subtitle">Choose the nav structure for the mobile app</p>
    <p class="section">We have three options to evaluate. Click each to learn more, then use the A/B/C buttons to vote.</p>
  `
})
```

### Step 2: Push comparison options

```
brainstorm_push_screen({
  slot: "a",
  label: "Bottom Tabs",
  html: `
    <h2>Bottom Tab Bar</h2>
    <p class="subtitle">iOS-style fixed bottom navigation</p>
    <div class="mockup">
      <div class="mockup-header">Mobile — 390px</div>
      <div class="mockup-body">
        <div class="mock-content">Main content area</div>
        <div class="mock-nav">Home | Search | Profile | Settings</div>
      </div>
    </div>
    <div class="pros-cons">
      <div class="pros"><b>Pros</b><br>+ Thumb-friendly<br>+ Always visible<br>+ Familiar pattern</div>
      <div class="cons"><b>Cons</b><br>- Max 5 items<br>- Takes vertical space</div>
    </div>
  `
})

brainstorm_push_screen({
  slot: "b",
  label: "Hamburger",
  html: `
    <h2>Hamburger Menu</h2>
    <p class="subtitle">Slide-out drawer navigation</p>
    <div class="mockup">
      <div class="mockup-header">Mobile — 390px</div>
      <div class="mockup-body">
        <div class="mock-nav">☰ App Name</div>
        <div class="mock-content">Main content area</div>
      </div>
    </div>
    <div class="pros-cons">
      <div class="pros"><b>Pros</b><br>+ Unlimited items<br>+ Clean default view</div>
      <div class="cons"><b>Cons</b><br>- Hidden by default<br>- Extra tap required</div>
    </div>
  `
})
```

### Step 3: Read the result

```
brainstorm_read_events()
// → [{"type": "preference", "choice": "a", "timestamp": ...}]
// User preferred Option A: Bottom Tabs
```

### Step 4: Confirm and continue

```
brainstorm_push_screen({
  html: `
    <h2>Decision: Bottom Tab Bar</h2>
    <p class="subtitle">Moving forward with bottom tab navigation</p>
    <p>Next: define the 4-5 tab items and their icons.</p>
  `
})

brainstorm_stop_session()
```
