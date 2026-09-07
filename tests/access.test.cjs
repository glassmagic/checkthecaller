const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../access.js'), 'utf8');

const IDS = ['access-form', 'access-code', 'access-error', 'access-submit', 'access-page', 'hub', 'hub-title', 'hub-error',
  'open-film', 'open-presentation', 'presentation', 'deck-stage', 'deck-menu', 'deck-open-film', 'deck-finish', 'slide-film-link',
  'experience', 'film-menu', 'film-open-presentation', 'film-skip-link', 'start'];
const HIDDEN = ['hub', 'presentation', 'experience', 'film-skip-link', 'access-error', 'hub-error'];

function setup({ saved = null, blockedStorage = false, hash = '' } = {}) {
  const elements = new Map();
  const scripts = [];
  const listeners = {};
  let focused;
  for (const id of IDS) {
    elements.set(id, { value: '', hidden: HIDDEN.includes(id), disabled: false, textContent: '', handlers: {}, attributes: {},
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
  // Assigning location.hash fires hashchange, as a browser does.
  const location = {
    current: hash,
    get hash() { return this.current; },
    set hash(value) {
      const next = value.startsWith('#') ? value : `#${value}`;
      if (next === this.current) return;
      this.current = next;
      for (const fn of listeners.hashchange || []) fn();
    },
  };
  vm.runInNewContext(script, {
    window: { sessionStorage: storage, location, addEventListener(event, fn) { (listeners[event] ??= []).push(fn); } },
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
  const click = id => { assert.equal($(id).disabled, false, `${id} is disabled`); $(id).handlers.click(); };
  const visible = () => IDS.filter(id => ['access-page', 'hub', 'presentation', 'experience'].includes(id) && !$(id).hidden);
  return { $, scripts, enter, click, visible, location, focused: () => focused, saved: () => saved };
}

test('entry starts locked without loading the player, the presentation or either video', () => {
  const { visible, scripts } = setup();
  assert.deepEqual(visible(), ['access-page']);
  assert.equal(scripts.length, 0);
});

test('empty and incorrect codes give a readable error and keep everything else hidden', () => {
  const { $, scripts, enter, visible, focused } = setup();
  enter('');
  assert.match($('access-error').textContent, /enter your access code/);
  enter('incorrect');
  assert.match($('access-error').textContent, /not recognised/);
  assert.equal($('access-code').attributes['aria-invalid'], 'true');
  assert.equal(focused(), 'access-code');
  assert.equal(scripts.length, 0);
  assert.deepEqual(visible(), ['access-page']);
  $('access-code').handlers.input();
  assert.equal($('access-error').hidden, true);
});

test('the supplied code ignores case and outer spaces, opens the menu without downloading anything and remembers this session', () => {
  const { scripts, enter, visible, saved, focused } = setup();
  enter(' check2026 ');
  assert.deepEqual(visible(), ['hub']);
  assert.equal(scripts.length, 0, 'the menu must not start the film download');
  assert.equal(saved(), 'CHECK2026');
  assert.equal(focused(), 'hub-title');
});

test('choosing the film loads the player once, shows it, and the menu button returns', () => {
  const { $, scripts, enter, click, visible, location, focused } = setup();
  enter('check2026');
  click('open-film');
  assert.equal(location.hash, '#film');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'app.js');
  assert.deepEqual(visible(), ['hub'], 'wait for the player script');
  assert.equal($('open-film').disabled, true);
  assert.equal($('open-presentation').disabled, true);
  scripts[0].onload();
  assert.deepEqual(visible(), ['experience']);
  assert.equal($('film-skip-link').hidden, false);
  assert.equal(focused(), 'start');
  click('film-menu');
  assert.equal(location.hash, '#menu');
  assert.deepEqual(visible(), ['hub']);
  assert.equal($('film-skip-link').hidden, true);
  assert.equal(focused(), 'hub-title');
  click('open-film');
  assert.equal(scripts.length, 1, 'the player is not downloaded twice');
  assert.deepEqual(visible(), ['experience']);
});

test('choosing the presentation loads its script rather than the film, and the two link to each other', () => {
  const { scripts, enter, click, visible, location, focused } = setup();
  enter('check2026');
  click('open-presentation');
  assert.equal(location.hash, '#slide-1');
  assert.equal(scripts[0].src, 'presentation.js');
  scripts[0].onload();
  assert.deepEqual(visible(), ['presentation']);
  assert.equal(focused(), 'deck-stage');
  click('deck-open-film');
  assert.equal(scripts[1].src, 'app.js');
  scripts[1].onload();
  assert.deepEqual(visible(), ['experience']);
  click('film-open-presentation');
  assert.equal(scripts.length, 2);
  assert.deepEqual(visible(), ['presentation']);
  click('slide-film-link');
  assert.deepEqual(visible(), ['experience']);
  click('deck-menu');
  assert.deepEqual(visible(), ['hub']);
  click('deck-finish');
  assert.deepEqual(visible(), ['hub']);
});

test('a link straight to a page or to the film opens it once the code is entered', () => {
  const pageLink = setup({ hash: '#slide-4' });
  assert.equal(pageLink.scripts.length, 0, 'still locked');
  pageLink.enter('check2026');
  assert.equal(pageLink.scripts[0].src, 'presentation.js');
  pageLink.scripts[0].onload();
  assert.deepEqual(pageLink.visible(), ['presentation']);
  const filmLink = setup({ hash: '#film' });
  filmLink.enter('check2026');
  assert.equal(filmLink.scripts[0].src, 'app.js');
});

test('only a session matching the current code can reopen the menu', () => {
  const remembered = setup({ saved: 'CHECK2026' });
  assert.deepEqual(remembered.visible(), ['hub']);
  assert.equal(remembered.scripts.length, 0);
  assert.deepEqual(setup({ saved: 'OLD-CODE' }).visible(), ['access-page']);
});

test('entry works when browser storage is unavailable', () => {
  const { enter, click, scripts, visible } = setup({ blockedStorage: true });
  enter('check2026');
  assert.deepEqual(visible(), ['hub']);
  click('open-film');
  scripts[0].onload();
  assert.deepEqual(visible(), ['experience']);
});

test('a script download failure returns to the menu with an error and can be retried', () => {
  const { $, scripts, enter, click, visible } = setup();
  enter('check2026');
  click('open-film');
  scripts[0].onerror();
  assert.equal(scripts[0].removed, true);
  assert.deepEqual(visible(), ['hub']);
  assert.match($('hub-error').textContent, /film could not load/);
  assert.equal($('open-film').disabled, false);
  click('open-film');
  assert.equal(scripts.length, 2, 'retry requests the script again even though the address did not change');
  assert.equal($('hub-error').hidden, true);
  scripts[1].onload();
  assert.deepEqual(visible(), ['experience']);
  click('film-menu');
  click('open-presentation');
  scripts[2].onerror();
  assert.match($('hub-error').textContent, /presentation could not load/);
});
