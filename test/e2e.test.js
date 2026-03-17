'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');

const { startServer } = require('../src/server');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function waitListening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/',
      method: 'GET',
      headers: {
        'Upgrade': 'websocket', 'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket) => resolve(socket));
    req.on('error', reject);
    req.end();
  });
}

function readWsMessage(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.removeListener('data', onData);
      reject(new Error('Timeout waiting for WS message'));
    }, timeoutMs);

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 2) return;

      const secondByte = buf[1];
      let payloadLen = secondByte & 0x7F;
      let offset = 2;

      if (payloadLen === 126) {
        if (buf.length < 4) return;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) return;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }

      const totalLen = offset + payloadLen;
      if (buf.length < totalLen) return;

      const payload = buf.slice(offset, totalLen);
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      resolve(payload.toString());
    }

    socket.on('data', onData);
  });
}

function sendWsMessage(socket, text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  const header = Buffer.alloc(2);
  header[0] = 0x80 | 0x01; // FIN + TEXT opcode
  header[1] = 0x80 | payload.length; // MASK bit + length (works for payloads < 126 bytes)
  socket.write(Buffer.concat([header, mask, masked]));
}

// -------------------------------------------------------------------------
// E2E lifecycle test
// -------------------------------------------------------------------------

describe('End-to-end lifecycle', () => {
  let tmpDir;
  let instance;
  let wsSocket;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-e2e-'));
    instance = startServer({ screenDir: tmpDir, port: 0, logFn: () => {} });
    await waitListening(instance.server);
  });

  after(() => {
    if (wsSocket && !wsSocket.destroyed) wsSocket.destroy();
    if (instance) instance.shutdown('e2e-done');
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Server starts and serves waiting page', async () => {
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    assert.ok(body.length > 0, 'should return a page');
  });

  test('WebSocket connects successfully', async () => {
    wsSocket = await connectWs(instance.port);
    assert.ok(wsSocket, 'WebSocket socket should be established');
    assert.ok(!wsSocket.destroyed, 'socket should not be destroyed');
  });

  test('Push HTML content and verify it is served + receive reload broadcast', async () => {
    // Connect WS first (already connected), then push content and wait for reload
    const reloadPromise = readWsMessage(wsSocket, 3000);

    const html = '<h1>Brainstorm Content</h1>';
    const filename = `screen-e2e-${Date.now()}.html`;
    fs.writeFileSync(path.join(tmpDir, filename), html, 'utf8');

    // Wait for the file watcher to fire and broadcast reload
    const message = await reloadPromise;
    const parsed = JSON.parse(message);
    assert.equal(parsed.type, 'reload', 'should receive reload broadcast after push');

    // Verify content is served
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    assert.ok(body.includes('Brainstorm Content'), 'pushed HTML should be served');
  });

  test('Send a choice event via WebSocket', async () => {
    const eventObj = { type: 'choice', choice: 'A', timestamp: Date.now() };
    const eventStr = JSON.stringify(eventObj);
    sendWsMessage(wsSocket, eventStr);

    // Give server time to process and write
    await new Promise(r => setTimeout(r, 300));

    const eventsPath = path.join(tmpDir, '.events');
    assert.ok(fs.existsSync(eventsPath), `.events file should exist in ${tmpDir}`);
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const events = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    assert.ok(events.length >= 1, 'should have at least one event');
    assert.equal(events[events.length - 1].choice, 'A', 'event should have choice A');
  });

  test('Push new content → events file gets cleared', async () => {
    const eventsPath = path.join(tmpDir, '.events');
    // Ensure events file exists before this test
    if (!fs.existsSync(eventsPath)) {
      fs.writeFileSync(eventsPath, '{"choice":"pre-existing"}\n', 'utf8');
    }
    assert.ok(fs.existsSync(eventsPath), '.events file should exist before push');

    // Listen for reload message before writing new file
    const reloadPromise = readWsMessage(wsSocket, 3000);

    // Push a NEW screen (new filename = unknown to server → clears events)
    const newFile = path.join(tmpDir, `screen-e2e-new-${Date.now()}.html`);
    fs.writeFileSync(newFile, '<h2>Updated content</h2>', 'utf8');

    // Wait for reload broadcast
    const message = await reloadPromise;
    const parsed = JSON.parse(message);
    assert.equal(parsed.type, 'reload', 'should receive reload broadcast');

    // Give server a moment to finish cleanup
    await new Promise(r => setTimeout(r, 100));

    // Events should be cleared (deleted or empty)
    if (fs.existsSync(eventsPath)) {
      const content = fs.readFileSync(eventsPath, 'utf8');
      assert.equal(content, '', 'events file should be empty after new screen');
    }
    // If file was deleted, that's also acceptable
  });

  test('Server shutdown cleans up properly', () => {
    // .server-info should exist before shutdown
    const serverInfoPath = path.join(tmpDir, '.server-info');
    assert.ok(fs.existsSync(serverInfoPath), '.server-info should exist');

    instance.shutdown('e2e-test-shutdown');

    // After shutdown, .server-info should be removed
    assert.ok(!fs.existsSync(serverInfoPath), '.server-info should be removed after shutdown');
  });
});
