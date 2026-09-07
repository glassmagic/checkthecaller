const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../access.js'), 'utf8');

function setup({ saved = null, blockedStorage = false } = {}) {
  const elements = new Map();
  const scripts = [];
  let focused;
  for (const id of ['access-form', 'access-code', 'access-error', 'access-submit', 'access-page', 'experience', 'film-skip-link', 'start']) {
    elements.set(id, { value: '', hidden: ['experience', 'film-skip-link', 'access-error'].includes(id), handlers: {}, attributes: {},
      addEventListener(event, fn) { this.handlers[event] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus(options) { assert.equal(options.preventScroll, true); focused = id; },
    });
  }
  const $ = id => elements.get(id);
  const storage = {
    getItem() { if (blockedStorage) throw new Error('blocked'); return saved; },
    setItem(_key, value) { if (blockedStorage) throw new Error('blocked'); saved = value; },
  };
  vm.runInNewContext(script, {
    window: { sessionStorage: storage },
    document: { getElementById: $, head: { append(node) { scripts.push(node); } },
      createElement(tag) { assert.equal(tag, 'script'); return { remove() { this.removed = true; } }; },
    },
  });
  function enter(code) {
    $('access-code').value = code;
    let prevented = false;
    $('access-form').handlers.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  return { $, scripts, enter, focused: () => focused, saved: () => saved };
}

test('entry starts locked without requesting the player or either video', () => {
  const { $, scripts } = setup();
  assert.equal($('experience').hidden, true);
  assert.equal($('access-page').hidden, false);
  assert.equal(scripts.length, 0);
});

test('empty and incorrect codes give a readable error and keep the film hidden', () => {
  const { $, scripts, enter, focused } = setup();
  enter('');
  assert.match($('access-error').textContent, /enter your access code/);
  enter('incorrect');
  assert.match($('access-error').textContent, /not recognised/);
  assert.equal($('access-code').attributes['aria-invalid'], 'true');
  assert.equal(focused(), 'access-code');
  assert.equal(scripts.length, 0);
  assert.equal($('experience').hidden, true);
  $('access-code').handlers.input();
  assert.equal($('access-error').hidden, true);
});

test('the supplied code ignores case and outer spaces, opens once and remembers this session', () => {
  const { $, scripts, enter, saved, focused } = setup();
  enter(' check2026 ');
  enter('CHECK2026');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'app.js');
  assert.equal($('experience').hidden, true, 'wait for the player script');
  scripts[0].onload();
  assert.equal($('experience').hidden, false);
  assert.equal($('access-page').hidden, true);
  assert.equal($('film-skip-link').hidden, false);
  assert.equal(saved(), 'CHECK2026');
  assert.equal(focused(), 'start');
});

test('only a session matching the current code can reopen the film', () => {
  assert.equal(setup({ saved: 'CHECK2026' }).scripts.length, 1);
  assert.equal(setup({ saved: 'OLD-CODE' }).scripts.length, 0);
});

test('entry works when browser storage is unavailable', () => {
  const { $, scripts, enter } = setup({ blockedStorage: true });
  enter('check2026');
  scripts[0].onload();
  assert.equal($('experience').hidden, false);
});

test('a player download failure keeps entry visible and can be retried', () => {
  const { $, scripts, enter } = setup();
  enter('check2026');
  scripts[0].onerror();
  assert.equal($('access-page').hidden, false);
  assert.equal($('experience').hidden, true);
  assert.equal($('access-submit').disabled, false);
  assert.match($('access-error').textContent, /could not load/);
  enter('check2026');
  assert.equal(scripts.length, 2);
  scripts[1].onload();
  assert.equal($('experience').hidden, false);
});
