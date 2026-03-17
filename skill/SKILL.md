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

## Quick Start

1. Call `brainstorm_start_session` to start the server and open the browser
2. Call `brainstorm_push_screen` with HTML content to display
3. For comparisons, use the `slot` parameter (a, b, c) with labels
4. Call `brainstorm_read_events` to get user interactions
5. Call `brainstorm_stop_session` when done

## HTML Content Patterns

### Single Option Display
```html
<h2>Dashboard Layout</h2>
<p class="subtitle">Proposed navigation structure</p>
<div class="mockup">
  <div class="mockup-header">Desktop View</div>
  <div class="mockup-body">
    <!-- Your mockup content -->
  </div>
</div>
```

### A/B/C Choice Options
Push to separate slots for comparison mode:
```
brainstorm_push_screen({ html: "<h2>Minimal Nav</h2>...", slot: "a", label: "Minimal" })
brainstorm_push_screen({ html: "<h2>Full Sidebar</h2>...", slot: "b", label: "Sidebar" })
```

### Available CSS Classes

**Layout:** `.options`, `.option`, `.cards`, `.card`, `.split`, `.mockup`, `.mockup-header`, `.mockup-body`
**Interactive:** Add `data-choice="value"` and `onclick="toggleSelect(this)"` to make elements clickable
**Styling:** `.pros-cons`, `.pros`, `.cons`, `.placeholder`, `.subtitle`, `.section`, `.label`
**Mock UI:** `.mock-nav`, `.mock-sidebar`, `.mock-content`, `.mock-button`, `.mock-input`

### Auto-detected Libraries
Content is automatically enhanced when these patterns are found:
- **Mermaid diagrams:** `<div class="mermaid">graph TD; A-->B</div>`
- **Syntax highlighting:** `<pre><code class="language-typescript">...</code></pre>`
- **Math (KaTeX):** `$$E = mc^2$$`

## Event Format

Events are JSON objects:
```json
{"type": "click", "choice": "a", "text": "Option A", "timestamp": 1234567890}
{"type": "preference", "choice": "b", "timestamp": 1234567890}
```

## Tips
- Use the frame template's built-in dark/light theme — it auto-detects OS preference
- For mockups, use the `.mockup` container with `.mockup-header` for context
- For comparisons, always use slots — they enable side-by-side iframe comparison
- Check events after giving the user time to interact
- The browser auto-reloads when content changes
