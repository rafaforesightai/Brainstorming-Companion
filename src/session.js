'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SessionManager {
  constructor(projectDir) {
    this.baseDir = projectDir
      ? `${projectDir}/.superpowers/brainstorm/`
      : `/tmp/brainstorm-companion/`;
  }

  create() {
    const sessionId = `${process.pid}-${Date.now()}`;
    const sessionDir = path.join(this.baseDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    return { sessionId, sessionDir };
  }

  getActive() {
    if (!fs.existsSync(this.baseDir)) return null;

    let entries;
    try {
      entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    } catch {
      return null;
    }

    // Collect session dirs with their mtime for sorting (most recent first)
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(this.baseDir, entry.name);
      try {
        const stat = fs.statSync(sessionDir);
        sessions.push({ name: entry.name, sessionDir, mtime: stat.mtimeMs });
      } catch {
        // skip unreadable dirs
      }
    }

    // Sort most recent first
    sessions.sort((a, b) => b.mtime - a.mtime);

    for (const { name: sessionId, sessionDir } of sessions) {
      const serverInfoPath = path.join(sessionDir, '.server-info');
      if (!fs.existsSync(serverInfoPath)) continue;

      let serverInfo;
      try {
        const raw = fs.readFileSync(serverInfoPath, 'utf8');
        serverInfo = JSON.parse(raw);
      } catch {
        continue;
      }

      // Verify server PID is alive
      const pid = serverInfo.pid || serverInfo.serverPid;
      if (pid) {
        try {
          process.kill(pid, 0);
        } catch {
          // PID is dead — stale session
          continue;
        }
      } else {
        // No PID in server-info — can't verify, skip
        continue;
      }

      return { sessionId, sessionDir, serverInfo };
    }

    return null;
  }

  pushScreen(html, { slot, filename, label } = {}) {
    const active = this.getActive();
    if (!active) throw new Error('No active session found');
    const { sessionDir } = active;

    let filePath;
    if (slot !== undefined) {
      const slotDir = path.join(sessionDir, `slot-${slot.toLowerCase()}`);
      fs.mkdirSync(slotDir, { recursive: true });
      filePath = path.join(slotDir, 'current.html');
      if (label !== undefined) {
        fs.writeFileSync(path.join(slotDir, '.label'), String(label), 'utf8');
      }
    } else {
      filePath = path.join(sessionDir, filename || `screen-${Date.now()}.html`);
    }

    fs.writeFileSync(filePath, html, 'utf8');
    return { path: filePath };
  }

  readEvents() {
    const active = this.getActive();
    if (!active) return [];
    const eventsPath = path.join(active.sessionDir, '.events');
    if (!fs.existsSync(eventsPath)) return [];

    try {
      const raw = fs.readFileSync(eventsPath, 'utf8');
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  clearEvents() {
    const active = this.getActive();
    if (!active) return;
    const eventsPath = path.join(active.sessionDir, '.events');
    try {
      fs.writeFileSync(eventsPath, '', 'utf8');
    } catch {
      // ignore if file doesn't exist
    }
  }

  clearSlot(slot) {
    const active = this.getActive();
    if (!active) return;
    const slotFile = path.join(active.sessionDir, `slot-${slot.toLowerCase()}`, 'current.html');
    try {
      fs.rmSync(slotFile);
    } catch {
      // ignore if not found
    }
  }

  clearAll() {
    const active = this.getActive();
    if (!active) return;
    const { sessionDir } = active;

    // Remove top-level .html files
    try {
      const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.html')) {
          fs.rmSync(path.join(sessionDir, entry.name));
        }
        // Remove slot-*/current.html
        if (entry.isDirectory() && entry.name.startsWith('slot-')) {
          const slotCurrent = path.join(sessionDir, entry.name, 'current.html');
          try {
            fs.rmSync(slotCurrent);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  getStatus() {
    const active = this.getActive();
    if (!active) return null;
    const { sessionId, sessionDir, serverInfo } = active;

    // Gather slots
    const slots = [];
    try {
      const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('slot-')) {
          const slotId = entry.name.replace(/^slot-/, '');
          const slotDir = path.join(sessionDir, entry.name);
          const labelPath = path.join(slotDir, '.label');
          const hasContent = fs.existsSync(path.join(slotDir, 'current.html'));
          let label = null;
          if (fs.existsSync(labelPath)) {
            try { label = fs.readFileSync(labelPath, 'utf8'); } catch { /* ignore */ }
          }
          slots.push({ slot: slotId, label, hasContent });
        }
      }
    } catch {
      // ignore
    }

    // Count events
    const events = this.readEvents();
    const eventCount = events.length;

    // Uptime and URL from serverInfo
    const uptime = serverInfo && serverInfo.startedAt
      ? Date.now() - serverInfo.startedAt
      : null;
    const url = serverInfo && serverInfo.url ? serverInfo.url : null;

    return { sessionId, sessionDir, slots, eventCount, uptime, url };
  }

  cleanup() {
    const active = this.getActive();
    if (!active) return;
    try {
      fs.rmSync(active.sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

module.exports = { SessionManager };
