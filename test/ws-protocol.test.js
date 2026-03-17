'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { OPCODES, WS_MAGIC, computeAcceptKey, encodeFrame, decodeFrame } = require('../src/ws-protocol');

// Helper to create a masked frame (client→server direction)
function createMaskedFrame(opcode, payload) {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  const fin = 0x80;
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

describe('OPCODES constants', () => {
  test('TEXT is 0x01', () => {
    assert.equal(OPCODES.TEXT, 0x01);
  });

  test('CLOSE is 0x08', () => {
    assert.equal(OPCODES.CLOSE, 0x08);
  });

  test('PING is 0x09', () => {
    assert.equal(OPCODES.PING, 0x09);
  });

  test('PONG is 0x0A', () => {
    assert.equal(OPCODES.PONG, 0x0A);
  });
});

describe('computeAcceptKey', () => {
  test('produces correct SHA-1 hash for known RFC 6455 test vector', () => {
    // RFC 6455 Section 1.3 example
    const clientKey = 'dGhlIHNhbXBsZSBub25jZQ==';
    const expected = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';
    assert.equal(computeAcceptKey(clientKey), expected);
  });

  test('uses WS_MAGIC constant', () => {
    assert.equal(WS_MAGIC, '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
  });

  test('returns base64 string', () => {
    const key = crypto.randomBytes(16).toString('base64');
    const result = computeAcceptKey(key);
    assert.match(result, /^[A-Za-z0-9+/]+=*$/);
  });
});

describe('encodeFrame / decodeFrame round-trip', () => {
  test('small payload (<126 bytes)', () => {
    const payload = Buffer.from('Hello, World!');
    const frame = encodeFrame(OPCODES.TEXT, payload);

    // encodeFrame produces unmasked frames (server→client)
    // To test decodeFrame we need masked frames (client→server)
    const maskedFrame = createMaskedFrame(OPCODES.TEXT, payload);
    const result = decodeFrame(maskedFrame);

    assert.ok(result, 'decodeFrame should return a result');
    assert.equal(result.opcode, OPCODES.TEXT);
    assert.deepEqual(result.payload, payload);
    assert.equal(result.bytesConsumed, maskedFrame.length);
  });

  test('medium payload (126-65535 bytes)', () => {
    const payload = Buffer.alloc(200, 0x41); // 200 'A' bytes
    const maskedFrame = createMaskedFrame(OPCODES.TEXT, payload);
    const result = decodeFrame(maskedFrame);

    assert.ok(result, 'decodeFrame should return a result');
    assert.equal(result.opcode, OPCODES.TEXT);
    assert.deepEqual(result.payload, payload);
    assert.equal(result.bytesConsumed, maskedFrame.length);
  });

  test('large payload header structure (>65535 bytes) — verify encodeFrame header', () => {
    // Just verify the header structure, don't round-trip the full large payload
    const payload = Buffer.alloc(70000, 0x42);
    const frame = encodeFrame(OPCODES.TEXT, payload);

    // Header: byte 0 = 0x80 | opcode, byte 1 = 127, then 8-byte big-endian length
    assert.equal(frame[0], 0x80 | OPCODES.TEXT);
    assert.equal(frame[1], 127);
    const len = Number(frame.readBigUInt64BE(2));
    assert.equal(len, 70000);
  });

  test('encodeFrame small payload has correct 2-byte header', () => {
    const payload = Buffer.from('hi');
    const frame = encodeFrame(OPCODES.TEXT, payload);

    assert.equal(frame.length, 2 + 2); // 2-byte header + 2-byte payload
    assert.equal(frame[0], 0x80 | OPCODES.TEXT);
    assert.equal(frame[1], 2);
  });

  test('encodeFrame medium payload has correct 4-byte header', () => {
    const payload = Buffer.alloc(200);
    const frame = encodeFrame(OPCODES.TEXT, payload);

    assert.equal(frame[0], 0x80 | OPCODES.TEXT);
    assert.equal(frame[1], 126);
    assert.equal(frame.readUInt16BE(2), 200);
  });
});

describe('decodeFrame edge cases', () => {
  test('returns null for incomplete buffer (< 2 bytes)', () => {
    const result = decodeFrame(Buffer.from([0x81]));
    assert.equal(result, null);
  });

  test('returns null for empty buffer', () => {
    const result = decodeFrame(Buffer.alloc(0));
    assert.equal(result, null);
  });

  test('returns null for incomplete medium payload', () => {
    // Create a masked frame for a 200-byte payload, then truncate it
    const payload = Buffer.alloc(200);
    const fullFrame = createMaskedFrame(OPCODES.TEXT, payload);
    const partial = fullFrame.slice(0, 10); // truncated
    const result = decodeFrame(partial);
    assert.equal(result, null);
  });

  test('throws for unmasked frames', () => {
    // Create an unmasked frame (server-style)
    const frame = encodeFrame(OPCODES.TEXT, Buffer.from('test'));
    assert.throws(
      () => decodeFrame(frame),
      /Client frames must be masked/
    );
  });

  test('returns null when medium payload header is incomplete', () => {
    // Masked frame with payload length 126 but only 3 bytes total
    const buf = Buffer.from([0x81, 0x80 | 126, 0x00]); // missing one byte for length
    const result = decodeFrame(buf);
    assert.equal(result, null);
  });

  test('decodes CLOSE opcode', () => {
    const payload = Buffer.alloc(0);
    const maskedFrame = createMaskedFrame(OPCODES.CLOSE, payload);
    const result = decodeFrame(maskedFrame);
    assert.ok(result);
    assert.equal(result.opcode, OPCODES.CLOSE);
  });

  test('bytesConsumed matches frame size for small payload', () => {
    const payload = Buffer.from('test payload');
    const maskedFrame = createMaskedFrame(OPCODES.TEXT, payload);
    const result = decodeFrame(maskedFrame);
    assert.equal(result.bytesConsumed, maskedFrame.length);
  });

  test('can decode multiple frames from concatenated buffer', () => {
    const p1 = Buffer.from('first');
    const p2 = Buffer.from('second');
    const f1 = createMaskedFrame(OPCODES.TEXT, p1);
    const f2 = createMaskedFrame(OPCODES.TEXT, p2);
    const combined = Buffer.concat([f1, f2]);

    const r1 = decodeFrame(combined);
    assert.ok(r1);
    assert.deepEqual(r1.payload, p1);

    const r2 = decodeFrame(combined.slice(r1.bytesConsumed));
    assert.ok(r2);
    assert.deepEqual(r2.payload, p2);
  });
});
