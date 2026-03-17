'use strict';

// ---------------------------------------------------------------------------
// detectLibraries — scan HTML for library usage signals
// ---------------------------------------------------------------------------

function detectLibraries(html) {
  const mermaid = /class=["']mermaid["']/.test(html);
  const prism = /class=["']language-/.test(html);
  const katex = /\$\$/.test(html) || /class=["']math["']/.test(html);
  return { mermaid, prism, katex };
}

// ---------------------------------------------------------------------------
// buildInjections — produce <script>/<link> tags for detected libraries
// ---------------------------------------------------------------------------

function buildInjections(needs, cdnBase) {
  if (!cdnBase) {
    cdnBase = process.env.BRAINSTORM_CDN_BASE || 'https://cdn.jsdelivr.net';
  }

  const parts = [];

  if (needs.mermaid) {
    parts.push(
      `<script src="${cdnBase}/npm/mermaid/dist/mermaid.min.js"></script>`,
      `<script>mermaid.initialize({startOnLoad:true,theme:window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'default'});</script>`
    );
  }

  if (needs.prism) {
    parts.push(
      `<link rel="stylesheet" href="${cdnBase}/npm/prismjs/themes/prism-tomorrow.min.css">`,
      `<script src="${cdnBase}/npm/prismjs/prism.min.js"></script>`,
      `<script src="${cdnBase}/npm/prismjs/plugins/autoloader/prism-autoloader.min.js"></script>`
    );
  }

  if (needs.katex) {
    parts.push(
      `<link rel="stylesheet" href="${cdnBase}/npm/katex/dist/katex.min.css">`,
      `<script src="${cdnBase}/npm/katex/dist/katex.min.js"></script>`,
      `<script src="${cdnBase}/npm/katex/dist/contrib/auto-render.min.js"></script>`,
      `<script>document.addEventListener('DOMContentLoaded',function(){renderMathInElement(document.body)});</script>`
    );
  }

  return parts.join('\n');
}

module.exports = { detectLibraries, buildInjections };
