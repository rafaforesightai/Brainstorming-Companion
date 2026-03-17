'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'brainstorm.js');

function startMcpClient() {
  const proc = spawn(process.execPath, [BIN_PATH, '--mcp'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let buffer = '';
  const responses = [];
  const waiters = [];

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        const msg = JSON.parse(line);
        if (waiters.length > 0) {
          // Dispatch directly to waiter; do NOT also push to responses[]
          waiters.shift()(msg);
        } else {
          responses.push(msg);
        }
      }
    }
  });

  proc.stderr.on('data', () => {}); // suppress stderr

  return {
    send(msg) { proc.stdin.write(JSON.stringify(msg) + '\n'); },
    async waitResponse() {
      if (responses.length > 0) return responses.shift();
      return new Promise(resolve => waiters.push(resolve));
    },
    close() { proc.stdin.end(); },
    kill() { proc.kill(); }
  };
}

// Helper: create fresh client and run a request/response cycle
async function withMcpClient(fn) {
  const client = startMcpClient();
  try {
    await fn(client);
  } finally {
    client.close();
    // Small delay to allow process to exit cleanly
    await new Promise(r => setTimeout(r, 100));
  }
}

// Single persistent client + session for the sequential tool chain tests
describe('MCP Server', () => {
  let client;
  let msgId = 0;

  function nextId() { return ++msgId; }

  before(async () => {
    client = startMcpClient();
    // Send initialize and wait for it first
    const id = nextId(); // id = 1
    client.send({ jsonrpc: '2.0', id, method: 'initialize', params: {} });
    const initResp = await client.waitResponse();
    assert.equal(initResp.id, id, 'initialize should return correct id');
    assert.equal(initResp.result.protocolVersion, '2024-11-05');
  });

  after(async () => {
    client.close();
    await new Promise(r => setTimeout(r, 200));
  });

  test('initialize response has correct protocolVersion', () => {
    // Already verified in before() hook; this test confirms the setup
    // The initialize was done in before(), we just assert the structure was correct
    assert.ok(true, 'initialize was verified in before()');
  });

  test('tools/list returns 5 tools', async () => {
    const id = nextId();
    client.send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(Array.isArray(response.result.tools), 'tools should be an array');
    assert.equal(response.result.tools.length, 5, 'should have 5 tools');

    const toolNames = response.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('brainstorm_start_session'));
    assert.ok(toolNames.includes('brainstorm_push_screen'));
    assert.ok(toolNames.includes('brainstorm_read_events'));
    assert.ok(toolNames.includes('brainstorm_clear_screen'));
    assert.ok(toolNames.includes('brainstorm_stop_session'));
  });

  test('brainstorm_start_session returns URL', async () => {
    const id = nextId();
    client.send({
      jsonrpc: '2.0', id,
      method: 'tools/call',
      params: {
        name: 'brainstorm_start_session',
        arguments: { open_browser: false, port: 0 }
      }
    });

    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(!response.result.isError, `should not be an error: ${JSON.stringify(response.result)}`);
    const text = response.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.url, 'should have url field');
    assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+/, 'URL should be localhost');
  });

  test('brainstorm_push_screen succeeds', async () => {
    const id = nextId();
    client.send({
      jsonrpc: '2.0', id,
      method: 'tools/call',
      params: {
        name: 'brainstorm_push_screen',
        arguments: { html: '<h1>Test Screen</h1>' }
      }
    });

    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(!response.result.isError, `should not be an error: ${JSON.stringify(response.result)}`);
    const text = response.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.path, 'should have path field');
  });

  test('brainstorm_read_events returns events array', async () => {
    const id = nextId();
    client.send({
      jsonrpc: '2.0', id,
      method: 'tools/call',
      params: {
        name: 'brainstorm_read_events',
        arguments: {}
      }
    });

    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(!response.result.isError, `should not be an error: ${JSON.stringify(response.result)}`);
    const text = response.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.events), 'should have events array');
    assert.ok(typeof parsed.count === 'number', 'should have count');
  });

  test('brainstorm_stop_session succeeds', async () => {
    const id = nextId();
    client.send({
      jsonrpc: '2.0', id,
      method: 'tools/call',
      params: {
        name: 'brainstorm_stop_session',
        arguments: {}
      }
    });

    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(!response.result.isError, `should not be an error: ${JSON.stringify(response.result)}`);
    const text = response.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.stopped, true, 'should return stopped: true');
  });

  test('unknown method returns error', async () => {
    const id = nextId();
    client.send({ jsonrpc: '2.0', id, method: 'nonexistent/method', params: {} });
    const response = await client.waitResponse();
    assert.equal(response.id, id);
    assert.ok(response.error, 'should return an error');
    assert.equal(response.error.code, -32601, 'should be method not found error code');
  });
});
