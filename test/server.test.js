'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

const { startServer } = require('../src/server');
const { decodeFrame, encodeFrame, OPCODES } = require('../src/ws-protocol');

// Helper: wait until server is listening
function waitListening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

// Helper: make an HTTP GET request
function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

// Helper: connect WebSocket using raw HTTP
function connectWs(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket) => resolve({ socket, res }));
    req.on('error', reject);
    req.end();
  });
}

// Helper: read a WS message from socket
function readWsMessage(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.removeListener('data', onData);
      reject(new Error('Timeout waiting for WS message'));
    }, timeoutMs);

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      // Try to decode
      try {
        // Server sends unmasked frames; we need to read them directly
        if (buf.length < 2) return;
        const secondByte = buf[1];
        const masked = (secondByte & 0x80) !== 0;
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
      } catch (e) {
        // keep waiting
      }
    }

    socket.on('data', onData);
  });
}

// Helper: send a WS message from client (masked)
function sendWsMessage(socket, text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  const header = Buffer.alloc(2);
  header[0] = 0x80 | 0x01; // FIN + TEXT
  header[1] = 0x80 | payload.length; // MASK bit + length
  socket.write(Buffer.concat([header, mask, masked]));
}

describe('HTTP+WS Server', () => {
  let tmpDir;
  let instance;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-server-test-'));
    instance = startServer({ screenDir: tmpDir, port: 0, logFn: () => {} });
    await waitListening(instance.server);
  });

  after(() => {
    instance.shutdown('test-done');
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('GET / returns waiting page when no content', async () => {
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    // waiting page has some HTML content
    assert.ok(body.includes('<html') || body.includes('<!DOCTYPE') || body.includes('<!doctype'),
      'should return an HTML page');
  });

  test('GET / returns content when HTML file exists in screenDir', async () => {
    const html = '<p>Test content from file</p>';
    fs.writeFileSync(path.join(tmpDir, 'screen-test.html'), html, 'utf8');

    // Give watcher a moment, but just re-request immediately
    await new Promise(r => setTimeout(r, 50));
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    assert.ok(body.includes('Test content from file'), 'should include the pushed content');
  });

  test('GET / wraps HTML fragments in frame template', async () => {
    // Remove all existing HTML files first
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.html') && !f.startsWith('.'));
    for (const f of files) fs.rmSync(path.join(tmpDir, f));

    const fragment = '<p>Just a fragment</p>';
    // Use a timestamp-based filename so it's the newest
    const fname = `screen-wrap-${Date.now()}.html`;
    fs.writeFileSync(path.join(tmpDir, fname), fragment, 'utf8');

    await new Promise(r => setTimeout(r, 50));
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    assert.ok(body.includes('Just a fragment'), 'should contain the fragment');
    // The fragment should be wrapped (frame template adds more HTML around it)
    assert.ok(body.includes('<html') || body.includes('<!DOCTYPE') || body.includes('<!doctype'),
      'fragment should be wrapped in full HTML');
  });

  test('GET / serves full HTML documents as-is (with helper injected)', async () => {
    // Remove existing HTML files
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.html') && !f.startsWith('.'));
    for (const f of files) fs.rmSync(path.join(tmpDir, f));

    const fullDoc = `<!DOCTYPE html><html><head><title>Test</title></head><body><p>Full doc</p></body></html>`;
    fs.writeFileSync(path.join(tmpDir, `screen-full-${Date.now()}.html`), fullDoc, 'utf8');

    await new Promise(r => setTimeout(r, 50));
    const { statusCode, body } = await httpGet(instance.port, '/');
    assert.equal(statusCode, 200);
    assert.ok(body.includes('Full doc'), 'should contain original content');
    // Helper script should be injected
    assert.ok(body.includes('<script>'), 'should have helper script injected');
  });

  test('GET /files/:filename serves static files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.html'), '<p>static</p>', 'utf8');
    const { statusCode, body } = await httpGet(instance.port, '/files/test.html');
    assert.equal(statusCode, 200);
    assert.ok(body.includes('static'));
  });

  test('GET /files/nonexistent returns 404', async () => {
    const { statusCode } = await httpGet(instance.port, '/files/nonexistent.html');
    assert.equal(statusCode, 404);
  });

  test('GET /api/status returns JSON', async () => {
    const { statusCode, headers, body } = await httpGet(instance.port, '/api/status');
    assert.equal(statusCode, 200);
    assert.ok(headers['content-type'].includes('application/json'));
    const json = JSON.parse(body);
    assert.ok('mode' in json, 'should have mode field');
    assert.ok('slots' in json, 'should have slots field');
    assert.ok('eventCount' in json, 'should have eventCount field');
  });

  test('WebSocket upgrade works (101 response)', async () => {
    const { socket, res } = await connectWs(instance.port);
    assert.equal(res.statusCode, 101);
    assert.equal(res.headers['upgrade'].toLowerCase(), 'websocket');
    socket.destroy();
  });

  test('File watcher: write new HTML file → receive reload broadcast', async () => {
    // Connect WebSocket
    const { socket } = await connectWs(instance.port);

    // Small delay for connection to be established
    await new Promise(r => setTimeout(r, 50));

    // Write a new HTML file to trigger reload
    const newFile = path.join(tmpDir, `screen-reload-${Date.now()}.html`);
    const messagePromise = readWsMessage(socket, 3000);
    fs.writeFileSync(newFile, '<p>new content</p>', 'utf8');

    const message = await messagePromise;
    const parsed = JSON.parse(message);
    assert.equal(parsed.type, 'reload', 'should receive reload message');

    socket.destroy();
  });

  test('Server shutdown cleans up .server-info', async () => {
    // Create a fresh server/dir to test shutdown
    const shutdownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-shutdown-test-'));
    try {
      const inst = startServer({ screenDir: shutdownDir, port: 0, logFn: () => {} });
      await waitListening(inst.server);

      const serverInfoPath = path.join(shutdownDir, '.server-info');
      assert.ok(fs.existsSync(serverInfoPath), '.server-info should exist while running');

      inst.shutdown('test');

      // Give shutdown a moment
      await new Promise(r => setTimeout(r, 100));
      assert.ok(!fs.existsSync(serverInfoPath), '.server-info should be removed after shutdown');
    } finally {
      fs.rmSync(shutdownDir, { recursive: true, force: true });
    }
  });
});
