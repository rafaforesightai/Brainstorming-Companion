'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = path.join('/tmp', 'brainstorm-companion');
const ACTIVE_POINTER = path.join(DEFAULT_BASE, '.active');

class SessionManager {
  constructor(projectDir, targetSessionId) {
    this.baseDir = projectDir
      ? path.join(projectDir, '.superpowers', 'brainstorm')
      : DEFAULT_BASE;
    this.targetSessionId = targetSessionId || null;
  }

  create() {
    const sessionId = `${process.pid}-${Date.now()}`;
    const sessionDir = path.join(this.baseDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    return { sessionId, sessionDir };
  }

  // Write a global pointer so any command can find the active session
  // regardless of --project-dir
  static writeActivePointer(sessionDir) {
    try {
      fs.mkdirSync(path.dirname(ACTIVE_POINTER), { recursive: true });
      fs.writeFileSync(ACTIVE_POINTER, sessionDir, 'utf8');
    } catch { /* ignore */ }
  }

  static clearActivePointer() {
    try { fs.rmSync(ACTIVE_POINTER); } catch { /* ignore */ }
  }

  // Read the global pointer — returns { sessionDir, serverInfo } or null
  static readActivePointer() {
    try {
      if (!fs.existsSync(ACTIVE_POINTER)) return null;
      const sessionDir = fs.readFileSync(ACTIVE_POINTER, 'utf8').trim();
      if (!fs.existsSync(sessionDir)) return null;
      const infoPath = path.join(sessionDir, '.server-info');
      if (!fs.existsSync(infoPath)) return null;
      const serverInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      const pid = serverInfo.pid || serverInfo.serverPid;
      if (pid) {
        try { process.kill(pid, 0); } catch { return null; } // dead
      } else {
        return null;
      }
      const sessionId = path.basename(sessionDir);
      return { sessionId, sessionDir, serverInfo };
    } catch {
      return null;
    }
  }

  getActive(targetSessionId) {
    // If a specific session ID is requested, search baseDir and pointer
    if (targetSessionId) {
      // Try baseDir first
      const sessionDir = path.join(this.baseDir, targetSessionId);
      if (fs.existsSync(sessionDir)) {
        const result = this._checkSession(targetSessionId, sessionDir);
        if (result) return result;
      }
      // Try global pointer
      const pointer = SessionManager.readActivePointer();
      if (pointer && pointer.sessionId === targetSessionId) return pointer;
      return null;
    }

    // Try global pointer first (works regardless of --project-dir)
    const pointer = SessionManager.readActivePointer();
    if (pointer) return pointer;

    // Fall back to scanning baseDir
    if (!fs.existsSync(this.baseDir)) return null;

    let entries;
    try {
      entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    } catch {
      return null;
    }

    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(this.baseDir, entry.name);
      try {
        const stat = fs.statSync(sessionDir);
        sessions.push({ name: entry.name, sessionDir, mtime: stat.mtimeMs });
      } catch { /* skip */ }
    }

    sessions.sort((a, b) => b.mtime - a.mtime);

    for (const { name: sessionId, sessionDir } of sessions) {
      const result = this._checkSession(sessionId, sessionDir);
      if (result) return result;
    }

    return null;
  }

  _checkSession(sessionId, sessionDir) {
    const serverInfoPath = path.join(sessionDir, '.server-info');
    if (!fs.existsSync(serverInfoPath)) return null;
    let serverInfo;
    try {
      serverInfo = JSON.parse(fs.readFileSync(serverInfoPath, 'utf8'));
    } catch {
      return null;
    }
    const pid = serverInfo.pid || serverInfo.serverPid;
    if (!pid) return null;
    try { process.kill(pid, 0); } catch { return null; }
    return { sessionId, sessionDir, serverInfo };
  }

  pushScreen(html, { slot, filename, label } = {}) {
    const active = this.getActive(this.targetSessionId);
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
      // Single-screen mode: clear any existing slot dirs so server switches out of comparison mode
      try {
        const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('slot-')) {
            fs.rmSync(path.join(sessionDir, entry.name), { recursive: true, force: true });
          }
        }
      } catch { /* ignore */ }
      filePath = path.join(sessionDir, filename || `screen-${Date.now()}.html`);
    }

    fs.writeFileSync(filePath, html, 'utf8');
    return { path: filePath };
  }

  readEvents() {
    const active = this.getActive(this.targetSessionId);
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
    const active = this.getActive(this.targetSessionId);
    if (!active) return;
    const eventsPath = path.join(active.sessionDir, '.events');
    try {
      fs.writeFileSync(eventsPath, '', 'utf8');
    } catch {
      // ignore if file doesn't exist
    }
  }

  clearSlot(slot) {
    const active = this.getActive(this.targetSessionId);
    if (!active) return;
    const slotFile = path.join(active.sessionDir, `slot-${slot.toLowerCase()}`, 'current.html');
    try {
      fs.rmSync(slotFile);
    } catch {
      // ignore if not found
    }
  }

  clearAll() {
    const active = this.getActive(this.targetSessionId);
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
    const active = this.getActive(this.targetSessionId);
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
    const active = this.getActive(this.targetSessionId);
    if (!active) return;
    try {
      fs.rmSync(active.sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

module.exports = { SessionManager };
