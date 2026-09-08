const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { encrypt } = require('../scripts/private.cjs');
const script = fs.readFileSync(path.join(__dirname, '../access.js'), 'utf8');

// The tests seal their own fixture with a code that exists nowhere else.
const CODE = 'TEST-CODE';
const FIELDS = { name: 'Test Presenter', greeting: 'Hello, I’m Test', role: 'Tester', bio: 'A bio.', note: 'A note.' };
let payload;
before(async () => { payload = await encrypt(FIELDS, CODE, 1000); });

const IDS = ['access-form', 'access-code', 'access-error', 'access-submit', 'access-page', 'hub', 'hub-title', 'hub-error',
  'open-film', 'open-presentation', 'presentation', 'deck-stage', 'deck-menu', 'deck-open-film', 'deck-finish', 'slide-film-link',
  'experience', 'film-menu', 'film-open-presentation', 'film-skip-link', 'start'];
const HIDDEN = ['hub', 'presentation', 'experience', 'film-skip-link', 'access-error', 'hub-error'];
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };

function setup({ saved = null, blockedStorage = false, hash = '', fetchOk = true, crypto = webcrypto } = {}) {
  const elements = new Map();
  const scripts = [];
  const listeners = {};
  let focused;
  for (const id of IDS) {
    elements.set(id, { value: '', hidden: HIDDEN.includes(id), disabled: false, textContent: '', innerHTML: '', handlers: {}, attributes: {},
      addEventListener(event, fn) { this.handlers[event] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus(options) { assert.equal(options.preventScroll, true); focused = id; },
    });
  }
  const privates = ['name', 'name', 'greeting', 'role', 'bio', 'note'].map(field => ({ field, textContent: '', getAttribute(name) { assert.equal(name, 'data-private'); return this.field; } }));
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
  let fetches = 0;
  const fetch = async url => {
    assert.equal(url, 'speaker.enc.json');
    fetches++;
    if (!fetchOk) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => payload };
  };
  vm.runInNewContext(script, {
    TextEncoder, TextDecoder,
    window: { sessionStorage: storage, location, fetch, crypto, atob: text => Buffer.from(text, 'base64').toString('binary'), addEventListener(event, fn) { (listeners[event] ??= []).push(fn); } },
    document: { getElementById: $, head: { append(node) { scripts.push(node); } },
      querySelectorAll(selector) { assert.equal(selector, '[data-private]'); return privates; },
      createElement(tag) { assert.equal(tag, 'script'); return { remove() { this.removed = true; } }; },
    },
  });
  async function enter(code) {
    $('access-code').value = code;
    let prevented = false;
    await $('access-form').handlers.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  const click = id => { assert.equal($(id).disabled, false, `${id} is disabled`); $(id).handlers.click(); };
  const visible = () => IDS.filter(id => ['access-page', 'hub', 'presentation', 'experience'].includes(id) && !$(id).hidden);
  return { $, scripts, privates, enter, click, visible, location, fetches: () => fetches, focused: () => focused, saved: () => saved };
}

test('entry starts locked: no personal details, no player, no presentation, no video', async () => {
  const { visible, scripts, privates, fetches } = setup();
  await settle();
  assert.deepEqual(visible(), ['access-page']);
  assert.equal(scripts.length, 0);
  assert.equal(fetches(), 0);
  assert.ok(privates.every(element => element.textContent === ''));
});

test('empty and incorrect codes give a readable error and keep everything else hidden', async () => {
  const { $, scripts, privates, enter, visible, focused } = setup();
  await enter('   ');
  assert.match($('access-error').textContent, /enter your access code/);
  await enter('incorrect');
  assert.match($('access-error').textContent, /not recognised/);
  assert.equal($('access-code').attributes['aria-invalid'], 'true');
  assert.equal(focused(), 'access-code');
  assert.equal($('access-submit').disabled, false);
  assert.equal(scripts.length, 0);
  assert.deepEqual(visible(), ['access-page']);
  assert.ok(privates.every(element => element.textContent === ''), 'a wrong code reveals nothing');
  $('access-code').handlers.input();
  assert.equal($('access-error').hidden, true);
});

test('the code ignores case and outer spaces, decrypts the personal details, opens the menu and remembers this session', async () => {
  const { scripts, privates, enter, visible, saved, focused } = setup();
  await enter(' test-code ');
  assert.deepEqual(visible(), ['hub']);
  assert.equal(scripts.length, 0, 'the menu must not start the film download');
  assert.deepEqual(privates.map(element => element.textContent), [FIELDS.name, FIELDS.name, FIELDS.greeting, FIELDS.role, FIELDS.bio, FIELDS.note]);
  assert.equal(saved(), CODE);
  assert.equal(focused(), 'hub-title');
});

test('the sealed file is fetched once per page and a network failure is reported without revealing anything', async () => {
  const offline = setup({ fetchOk: false });
  await offline.enter(CODE);
  assert.match(offline.$('access-error').textContent, /Could not check your code/);
  assert.notEqual(offline.$('access-code').attributes['aria-invalid'], 'true');
  assert.deepEqual(offline.visible(), ['access-page']);
  const online = setup();
  await online.enter('wrong');
  await online.enter(CODE);
  assert.equal(online.fetches(), 1);
});

test('a browser without Web Crypto is told so', async () => {
  const { $, enter, visible } = setup({ crypto: {} });
  await enter(CODE);
  assert.match($('access-error').textContent, /up-to-date browser/);
  assert.deepEqual(visible(), ['access-page']);
});

test('choosing the film loads the player once, shows it, and the menu button returns', async () => {
  const { $, scripts, enter, click, visible, location, focused } = setup();
  await enter(CODE);
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

test('choosing the presentation loads its script rather than the film, and the two link to each other', async () => {
  const { scripts, enter, click, visible, location, focused } = setup();
  await enter(CODE);
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

test('a link straight to a page or to the film opens it once the code is entered', async () => {
  const pageLink = setup({ hash: '#slide-4' });
  await pageLink.enter(CODE);
  assert.equal(pageLink.scripts[0].src, 'presentation.js');
  pageLink.scripts[0].onload();
  assert.deepEqual(pageLink.visible(), ['presentation']);
  const filmLink = setup({ hash: '#film' });
  await filmLink.enter(CODE);
  assert.equal(filmLink.scripts[0].src, 'app.js');
});

test('a remembered session reopens the menu only if its code still decrypts the current file', async () => {
  const remembered = setup({ saved: CODE });
  await settle();
  assert.deepEqual(remembered.visible(), ['hub']);
  assert.equal(remembered.scripts.length, 0);
  assert.equal(remembered.privates[0].textContent, FIELDS.name);
  const stale = setup({ saved: 'OLD-CODE' });
  await settle();
  assert.deepEqual(stale.visible(), ['access-page']);
  assert.equal(stale.$('access-error').hidden, true, 'a stale session fails quietly');
  assert.equal(stale.$('access-submit').disabled, false);
});

test('entry works when browser storage is unavailable', async () => {
  const { enter, click, scripts, visible } = setup({ blockedStorage: true });
  await enter(CODE);
  assert.deepEqual(visible(), ['hub']);
  click('open-film');
  scripts[0].onload();
  assert.deepEqual(visible(), ['experience']);
});

test('a script download failure returns to the menu with an error and can be retried', async () => {
  const { $, scripts, enter, click, visible } = setup();
  await enter(CODE);
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
