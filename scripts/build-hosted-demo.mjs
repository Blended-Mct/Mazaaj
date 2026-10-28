// Builds the hosted demo: the whole web app in ONE self-contained HTML page with
// no server and no external files. The /api/v1 handlers run in the browser
// (src/browser/local-server.js) over the same demo data and mood engine.
//
//   npm run build:demo
//   → dist/mizaj-demo.html          page fragment for hosts that add their own <html>/<head>
//   → dist/mizaj-demo.preview.html  full document to open locally (strict CSP: no network)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LOCAL_SERVER_ORIGIN = 'http://localhost:3000';

// Our modules only use `import { a, b } from './x.js'` and `export function|const|class`.
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Wraps each ES module in its own function scope, in dependency order. */
function bundle(entry) {
  const modules = new Map();
  const order = [];

  function visit(file, from) {
    const known = modules.get(file);
    if (known === 'visiting') throw new Error(`Import cycle at ${path.relative(root, file)} (from ${from})`);
    if (known) return;
    modules.set(file, 'visiting');
    const src = fs.readFileSync(file, 'utf8');
    const imports = [...src.matchAll(IMPORT_RE)].map(([, names, spec]) => ({
      names: names.split(',').map((n) => n.trim()).filter(Boolean),
      file: path.resolve(path.dirname(file), spec),
    }));
    for (const im of imports) visit(im.file, path.relative(root, file));
    const exported = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
    const mod = { id: `__m${order.length}`, file, src, imports, exported };
    modules.set(file, mod);
    order.push(mod);
  }
  visit(entry, 'entry');

  return order.map((mod) => {
    const head = mod.imports.map((im) => {
      const dep = modules.get(im.file);
      const missing = im.names.filter((n) => !dep.exported.includes(n));
      if (missing.length) throw new Error(`${path.relative(root, mod.file)} imports ${missing.join(', ')} not exported by ${path.relative(root, im.file)}`);
      return `const { ${im.names.join(', ')} } = ${dep.id};`;
    });
    const body = mod.src
      .replace(IMPORT_RE, '')
      .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
    if (/^\s*(import|export)\s/m.test(body)) throw new Error(`Unsupported import/export form in ${path.relative(root, mod.file)}`);
    return `// ---- ${path.relative(root, mod.file)}\nconst ${mod.id} = (() => {\n${head.join('\n')}\n${body.trim()}\nreturn { ${mod.exported.join(', ')} };\n})();`;
  }).join('\n\n');
}

const between = (s, start, end) => {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Markers not found: ${start} … ${end}`);
  return s.slice(a + start.length, b);
};

function replaceOnce(s, from, to) {
  if (!s.includes(from)) throw new Error(`Expected to find: ${from}`);
  return s.replace(from, to);
}

// --- Page body: the web app shell, adjusted for the hosted demo ---------------
let body = between(read('public/index.html'), '<body>', '</body>').trim();
body = replaceOnce(body, '<a href="/docs" target="_blank" rel="noopener">API</a>', '<a href="#api" data-nav="api">API</a>');
body = replaceOnce(body, '<span>Fictional customers · all customer data sources simulated.</span>',
  '<span>Hosted demo running in your browser · fictional customers · all data sources simulated.</span>');

// --- API docs, shown in-app on #api ---------------------------------------------
let docs = between(read('public/docs.html'), '<main class="doc">', '</main>').trim();
docs = docs.replaceAll('{{origin}}', LOCAL_SERVER_ORIGIN)
  .replace('<a href="/">/</a>', '<a href="#">/</a>')
  .replace('<a href="/popup">/popup</a>', '<a href="#popup">/popup</a>');

const css = read('public/css/mizaj.css');
const js = bundle(path.join(root, 'src/browser/hosted-entry.js'));
if (js.includes('</script')) throw new Error('Bundle contains </script');
if (css.includes('</style')) throw new Error('CSS contains </style');

const fragment = `<title>Mizaj Customer Mood</title>
<style>
${css}
</style>
${body}
<template id="mizaj-docs"><div class="doc" style="padding-left:0;padding-right:0">${docs}</div></template>
<script type="module">
${js}
</script>
`;

const preview = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
</head>
<body>
${fragment}</body>
</html>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/mizaj-demo.html'), fragment);
fs.writeFileSync(path.join(root, 'dist/mizaj-demo.preview.html'), preview);
console.log(`Built dist/mizaj-demo.html (${(fragment.length / 1024).toFixed(0)} KB) and dist/mizaj-demo.preview.html`);
