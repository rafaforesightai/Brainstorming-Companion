'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detectLibraries, buildInjections } = require('../src/content-detect');

describe('detectLibraries', () => {
  test('detects Mermaid with double quotes', () => {
    const html = '<div class="mermaid">graph TD; A-->B;</div>';
    const result = detectLibraries(html);
    assert.equal(result.mermaid, true);
  });

  test('detects Mermaid with single quotes', () => {
    const html = "<div class='mermaid'>graph TD; A-->B;</div>";
    const result = detectLibraries(html);
    assert.equal(result.mermaid, true);
  });

  test('detects Prism language classes with double quotes', () => {
    const html = '<code class="language-javascript">const x = 1;</code>';
    const result = detectLibraries(html);
    assert.equal(result.prism, true);
  });

  test('detects Prism language classes with single quotes', () => {
    const html = "<code class='language-python'>print('hello')</code>";
    const result = detectLibraries(html);
    assert.equal(result.prism, true);
  });

  test('detects KaTeX with $$ math delimiters', () => {
    const html = '<p>The formula is $$E=mc^2$$</p>';
    const result = detectLibraries(html);
    assert.equal(result.katex, true);
  });

  test('detects KaTeX with math class double quotes', () => {
    const html = '<span class="math">E=mc^2</span>';
    const result = detectLibraries(html);
    assert.equal(result.katex, true);
  });

  test('detects KaTeX with math class single quotes', () => {
    const html = "<span class='math'>x^2</span>";
    const result = detectLibraries(html);
    assert.equal(result.katex, true);
  });

  test('returns all false for plain HTML', () => {
    const html = '<h1>Hello World</h1><p>Just some text.</p>';
    const result = detectLibraries(html);
    assert.equal(result.mermaid, false);
    assert.equal(result.prism, false);
    assert.equal(result.katex, false);
  });

  test('returns all false for empty string', () => {
    const result = detectLibraries('');
    assert.equal(result.mermaid, false);
    assert.equal(result.prism, false);
    assert.equal(result.katex, false);
  });

  test('detects multiple libraries at once', () => {
    const html = `
      <div class="mermaid">graph</div>
      <code class="language-js">code</code>
      <span>$$math$$</span>
    `;
    const result = detectLibraries(html);
    assert.equal(result.mermaid, true);
    assert.equal(result.prism, true);
    assert.equal(result.katex, true);
  });
});

describe('buildInjections', () => {
  test('returns empty string when nothing detected', () => {
    const needs = { mermaid: false, prism: false, katex: false };
    const result = buildInjections(needs);
    assert.equal(result, '');
  });

  test('includes Mermaid CDN URL when mermaid is detected', () => {
    const needs = { mermaid: true, prism: false, katex: false };
    const result = buildInjections(needs);
    assert.ok(result.includes('mermaid'), 'should include mermaid');
    assert.ok(result.includes('mermaid.min.js'), 'should include mermaid.min.js');
    assert.ok(result.includes('mermaid.initialize'), 'should include initialization call');
  });

  test('includes Prism CDN URLs when prism is detected', () => {
    const needs = { mermaid: false, prism: true, katex: false };
    const result = buildInjections(needs);
    assert.ok(result.includes('prismjs'), 'should include prismjs');
    assert.ok(result.includes('prism.min.js'), 'should include prism.min.js');
    assert.ok(result.includes('prism-tomorrow.min.css'), 'should include prism CSS');
  });

  test('includes KaTeX CDN URLs when katex is detected', () => {
    const needs = { mermaid: false, prism: false, katex: true };
    const result = buildInjections(needs);
    assert.ok(result.includes('katex'), 'should include katex');
    assert.ok(result.includes('katex.min.js'), 'should include katex.min.js');
    assert.ok(result.includes('katex.min.css'), 'should include katex CSS');
  });

  test('respects custom cdnBase parameter', () => {
    const needs = { mermaid: true, prism: false, katex: false };
    const customBase = 'https://my-cdn.example.com';
    const result = buildInjections(needs, customBase);
    assert.ok(result.includes(customBase), 'should use custom CDN base');
    assert.ok(!result.includes('cdn.jsdelivr.net'), 'should not use default CDN');
  });

  test('uses default CDN base when not specified', () => {
    const needs = { mermaid: true, prism: false, katex: false };
    const result = buildInjections(needs);
    assert.ok(result.includes('cdn.jsdelivr.net'), 'should use default jsdelivr CDN');
  });

  test('includes all libraries when all detected', () => {
    const needs = { mermaid: true, prism: true, katex: true };
    const result = buildInjections(needs);
    assert.ok(result.includes('mermaid'), 'should include mermaid');
    assert.ok(result.includes('prismjs'), 'should include prism');
    assert.ok(result.includes('katex'), 'should include katex');
  });

  test('respects custom cdnBase for all libraries', () => {
    const needs = { mermaid: true, prism: true, katex: true };
    const customBase = 'https://mycdn.test';
    const result = buildInjections(needs, customBase);
    // All URLs should use the custom base
    const lines = result.split('\n').filter(l => l.includes('http'));
    for (const line of lines) {
      assert.ok(line.includes(customBase), `line should use custom CDN: ${line}`);
    }
  });
});
