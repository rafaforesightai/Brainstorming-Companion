'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { SessionManager } = require('../src/session');

// Create a fresh temp dir for each test group
let tmpDir;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-test-'));
}

function makeSessionManager() {
  return new SessionManager(tmpDir);
}

// Helper: write a fake .server-info with the current process.pid to make getActive() return a session
function makeActiveSession(sessionDir) {
  const serverInfo = {
    type: 'server-started',
    port: 12345,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:12345',
    pid: process.pid,
    startedAt: Date.now(),
  };
  fs.writeFileSync(path.join(sessionDir, '.server-info'), JSON.stringify(serverInfo), 'utf8');
}

describe('SessionManager.create()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns sessionId and creates directory', () => {
    const mgr = makeSessionManager();
    const { sessionId, sessionDir } = mgr.create();

    assert.ok(sessionId, 'sessionId should be truthy');
    assert.ok(fs.existsSync(sessionDir), 'sessionDir should exist');
    assert.ok(sessionDir.includes(sessionId), 'sessionDir should include sessionId');
  });

  test('sessionId includes process.pid', () => {
    const mgr = makeSessionManager();
    const { sessionId } = mgr.create();
    assert.ok(sessionId.startsWith(String(process.pid)), 'sessionId should start with PID');
  });
});

describe('SessionManager.getActive()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when baseDir does not exist', () => {
    const mgr = new SessionManager(path.join(tmpDir, 'nonexistent-subdir'));
    const result = mgr.getActive();
    assert.equal(result, null);
  });

  test('returns null when no .server-info exists in session dir', () => {
    const mgr = makeSessionManager();
    mgr.create(); // creates dir but no .server-info
    const result = mgr.getActive();
    assert.equal(result, null);
  });

  test('returns session when .server-info has live PID', () => {
    const mgr = makeSessionManager();
    const { sessionId, sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    const result = mgr.getActive();
    assert.ok(result, 'should return a result');
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.sessionDir, sessionDir);
    assert.ok(result.serverInfo, 'should include serverInfo');
    assert.equal(result.serverInfo.pid, process.pid);
  });

  test('returns null when .server-info has dead PID', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();

    // Use a PID that almost certainly doesn't exist
    const serverInfo = { pid: 9999999, url: 'http://127.0.0.1:9999' };
    fs.writeFileSync(path.join(sessionDir, '.server-info'), JSON.stringify(serverInfo), 'utf8');

    const result = mgr.getActive();
    assert.equal(result, null);
  });
});

describe('SessionManager.pushScreen()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupActiveSession() {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);
    return { mgr, sessionDir };
  }

  test('writes file to session dir', () => {
    const { mgr, sessionDir } = setupActiveSession();
    const html = '<p>Hello</p>';
    const result = mgr.pushScreen(html);

    assert.ok(result.path, 'should return path');
    assert.ok(fs.existsSync(result.path), 'file should exist');
    assert.equal(fs.readFileSync(result.path, 'utf8'), html);
  });

  test('with slot creates slot directory structure', () => {
    const { mgr, sessionDir } = setupActiveSession();
    const html = '<p>Slot A</p>';
    const result = mgr.pushScreen(html, { slot: 'a' });

    assert.ok(result.path.includes('slot-a'), 'path should include slot-a');
    assert.ok(fs.existsSync(result.path), 'slot file should exist');
    assert.equal(fs.readFileSync(result.path, 'utf8'), html);
    assert.ok(fs.existsSync(path.join(sessionDir, 'slot-a')), 'slot dir should exist');
  });

  test('with slot and label writes .label file', () => {
    const { mgr, sessionDir } = setupActiveSession();
    mgr.pushScreen('<p>test</p>', { slot: 'b', label: 'Option B' });

    const labelPath = path.join(sessionDir, 'slot-b', '.label');
    assert.ok(fs.existsSync(labelPath), '.label file should exist');
    assert.equal(fs.readFileSync(labelPath, 'utf8'), 'Option B');
  });

  test('throws when no active session', () => {
    const mgr = makeSessionManager();
    assert.throws(
      () => mgr.pushScreen('<p>test</p>'),
      /No active session/
    );
  });
});

describe('SessionManager.readEvents()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty array when no active session', () => {
    const mgr = makeSessionManager();
    const events = mgr.readEvents();
    assert.deepEqual(events, []);
  });

  test('returns empty array when no events file', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    const events = mgr.readEvents();
    assert.deepEqual(events, []);
  });

  test('parses JSONL correctly', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    const event1 = { type: 'choice', choice: 'A', timestamp: 1000 };
    const event2 = { type: 'choice', choice: 'B', timestamp: 2000 };
    const jsonl = JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n';
    fs.writeFileSync(path.join(sessionDir, '.events'), jsonl, 'utf8');

    const events = mgr.readEvents();
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], event1);
    assert.deepEqual(events[1], event2);
  });

  test('ignores empty lines in events file', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    const event1 = { choice: 'X' };
    fs.writeFileSync(
      path.join(sessionDir, '.events'),
      '\n' + JSON.stringify(event1) + '\n\n',
      'utf8'
    );

    const events = mgr.readEvents();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], event1);
  });
});

describe('SessionManager.clearEvents()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('truncates events file', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    const eventsPath = path.join(sessionDir, '.events');
    fs.writeFileSync(eventsPath, '{"choice":"A"}\n', 'utf8');

    mgr.clearEvents();

    assert.equal(fs.readFileSync(eventsPath, 'utf8'), '');
  });

  test('does nothing when no active session', () => {
    const mgr = makeSessionManager();
    // Should not throw
    assert.doesNotThrow(() => mgr.clearEvents());
  });
});

describe('SessionManager.clearSlot()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes slot content', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    mgr.pushScreen('<p>A</p>', { slot: 'a' });
    const slotFile = path.join(sessionDir, 'slot-a', 'current.html');
    assert.ok(fs.existsSync(slotFile), 'slot file should exist before clear');

    mgr.clearSlot('a');
    assert.ok(!fs.existsSync(slotFile), 'slot file should not exist after clear');
  });
});

describe('SessionManager.clearAll()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes all HTML files', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    // Write a couple of HTML files
    fs.writeFileSync(path.join(sessionDir, 'screen-1.html'), '<p>one</p>', 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'screen-2.html'), '<p>two</p>', 'utf8');
    mgr.pushScreen('<p>A</p>', { slot: 'a' });

    mgr.clearAll();

    const htmlFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith('.html'));
    assert.equal(htmlFiles.length, 0, 'no top-level HTML files should remain');

    const slotFile = path.join(sessionDir, 'slot-a', 'current.html');
    assert.ok(!fs.existsSync(slotFile), 'slot current.html should be removed');
  });
});

describe('SessionManager.cleanup()', () => {
  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    // cleanup may have already removed session dir, just clean up tmpDir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('removes session directory', () => {
    const mgr = makeSessionManager();
    const { sessionDir } = mgr.create();
    makeActiveSession(sessionDir);

    assert.ok(fs.existsSync(sessionDir), 'session dir should exist before cleanup');
    mgr.cleanup();
    assert.ok(!fs.existsSync(sessionDir), 'session dir should not exist after cleanup');
  });

  test('does nothing when no active session', () => {
    const mgr = makeSessionManager();
    // Should not throw
    assert.doesNotThrow(() => mgr.cleanup());
  });
});
