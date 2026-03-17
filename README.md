# Brainstorm Companion

AI-assisted visual brainstorming tool. Opens a browser window alongside AI coding sessions for comparing design mockups, architecture options, and UI prototypes.

Zero dependencies. Node.js only.

## Quick Start

### As CLI
```bash
npx brainstorm-companion start
# Browser opens → push content → get feedback

echo '<h2>Hello</h2>' | npx brainstorm-companion push -
npx brainstorm-companion events
npx brainstorm-companion stop
```

### As MCP Server (Claude Code)
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

## Features
- **Single screen mode**: Push HTML content, auto-reloads on changes
- **Comparison mode**: Push to slots A/B/C for side-by-side comparison
- **Event capture**: User clicks and preferences flow back as structured events
- **Auto-detection**: Mermaid diagrams, Prism syntax highlighting, KaTeX math
- **Dark/light theme**: Auto-detects OS preference

## CLI Commands

| Command | Description |
|---------|-------------|
| `start` | Start server and open browser |
| `push <file\|->` | Push HTML content |
| `events` | Read interaction events |
| `clear` | Clear content or events |
| `stop` | Stop the server |
| `status` | Show server status |

## MCP Tools

| Tool | Description |
|------|-------------|
| `brainstorm_start_session` | Start server, open browser |
| `brainstorm_push_screen` | Push HTML (with optional slot) |
| `brainstorm_read_events` | Read user interactions |
| `brainstorm_clear_screen` | Clear content |
| `brainstorm_stop_session` | Stop and clean up |

## Requirements

Node.js >= 18. No external dependencies.

## License

MIT
