// A lightweight static check for the port: flag `this.foo(...)` calls inside a
// class body where `foo` is not a method of that class (nor assigned in it),
// taking `extends` chains into account. Approximate by design; it catches the
// snake/camel drift a port can introduce (see the go_to_menu / go_to_lab
// mismatches it is meant to flag).
import fs from 'fs';
import path from 'path';

const ROOTS = ['src'];
const SKIP = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
  'function', 'super', 'this', 'new', 'await']);

// Matches method definitions, including `async` methods and getters/setters.
const METHOD_RE = /^\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/gm;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function findClassBodies(source) {
  const bodies = [];
  const re = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const name = match[1], parent = match[2];
    let depth = 1, i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    bodies.push({ name, parent, start: re.lastIndex, end: i - 1 });
  }
  return bodies;
}

function ownMembers(text) {
  const defined = new Set();
  for (const m of text.matchAll(METHOD_RE)) defined.add(m[1]);
  for (const m of text.matchAll(/this\.(\w+)\s*=/g)) defined.add(m[1]);
  return defined;
}

// Pass 1: collect every class, its file, its parent and its own members.
const classes = new Map();     // name -> { parent, members, file, text }
for (const file of walk(ROOTS[0])) {
  const source = fs.readFileSync(file, 'utf8');
  for (const body of findClassBodies(source)) {
    const text = source.slice(body.start, body.end);
    classes.set(body.name, {
      parent: body.parent || null,
      members: ownMembers(text),
      file,
      text,
    });
  }
}

// Pass 2: resolve inheritance (same name in different files: last wins, which
// matches how the modules are imported in practice).
function resolvedMembers(name, seen = new Set()) {
  if (!classes.has(name) || seen.has(name)) return new Set();
  seen.add(name);
  const info = classes.get(name);
  const inherited = info.parent ? resolvedMembers(info.parent, seen) : new Set();
  for (const member of info.members) inherited.add(member);
  return inherited;
}

const problems = [];
for (const [name, info] of classes) {
  const defined = resolvedMembers(name);
  for (const m of info.text.matchAll(/this\.(\w+)\s*\(/g)) {
    const member = m[1];
    if (SKIP.has(member)) continue;
    if (!defined.has(member)) problems.push(`${info.file} :: class ${name} :: this.${member}() not defined here`);
  }
}

// Cross-object check: every `this.app.<method>()` call must exist on the App
// class (src/main.js). This is the exact drift that broke QUIT TO MENU and
// OPEN PHYSICS LAB once (`go_to_menu` / `go_to_lab` vs goToMenu / goToLab).
if (classes.has('App')) {
  const appMethods = resolvedMembers('App');
  for (const [name, info] of classes) {
    for (const m of info.text.matchAll(/this\.app\.(\w+)\s*\(/g)) {
      if (!appMethods.has(m[1])) {
        problems.push(`${info.file} :: class ${name} :: this.app.${m[1]}() is not an App method`);
      }
    }
  }
}

const unique = [...new Set(problems)];
console.log(`candidate issues: ${unique.length}`);
for (const line of unique) console.log('  ' + line);
