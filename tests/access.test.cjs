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
  'open-film', 'open-presentation', 'presentation', 'deck-stage', 'deck-menu', 'deck-finish', 'slide-film-link', 'deck-open-film', 'deck-open-qr',
  'experience', 'film-menu', 'film-open-presentation', 'film-skip-link', 'start',
  'open-qr', 'qr-experience', 'qr-menu', 'qr-skip-link', 'qr-start', 'qr-open-presentation', 'qr-slide-film-link'];
const HIDDEN = ['hub', 'presentation', 'experience', 'film-skip-link', 'qr-experience', 'qr-skip-link', 'access-error', 'hub-error'];
// Unlocking awaits WebCrypto PBKDF2, which runs off the event loop, so allow real
// time as well as a run of event-loop turns before the assertions look at the DOM.
const settle = async (ms = 400) => {
  const deadline = Date.now() + ms;
  do {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  } while (Date.now() < deadline);
};

function setup({ saved = null, blockedStorage = false, hash = '', fetchOk = true, crypto = webcrypto, offline } = {}) {
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
  const videos = ['experience', 'qr-experience'].map(section => ({
    section, paused: false,
    pause() { this.paused = true; },
    closest(selector) { assert.equal(selector, '[hidden]'); return $(this.section).hidden ? $(this.section) : null; },
  }));
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
    window: { checkTheCallerOffline: offline, sessionStorage: storage, location, fetch, crypto, atob: text => Buffer.from(text, 'base64').toString('binary'), addEventListener(event, fn) { (listeners[event] ??= []).push(fn); } },
    document: { getElementById: $, head: { append(node) { scripts.push(node); } },
      querySelectorAll(selector) {
        assert.ok(['[data-private]', 'video'].includes(selector), `unexpected selector ${selector}`);
        return selector === 'video' ? videos : privates;
      },
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
  const visible = () => IDS.filter(id => ['access-page', 'hub', 'presentation', 'experience', 'qr-experience'].includes(id) && !$(id).hidden);
  return { $, scripts, privates, videos, enter, click, visible, location, fetches: () => fetches, focused: () => focused, saved: () => saved };
}

test('entry starts locked: no personal details, no player, no presentation, no video', async () => {
  const { visible, scripts, privates, fetches } = setup();
  await settle();
  assert.deepEqual(visible(), ['access-page']);
  assert.equal(scripts.length, 0);
  assert.equal(fetches(), 0);
  assert.ok(privates.every(element => element.textContent === ''));
});

test('offline entry decrypts the embedded payload and starts each section only on demand', async () => {
  const started = [];
  const offline = { payload, sections: {
    film: () => started.push('film'), qr: () => started.push('qr'), presentation: () => started.push('presentation'),
  } };
  const page = setup({ offline, fetchOk: false, blockedStorage: true });
  await page.enter('wrong');
  assert.deepEqual(page.visible(), ['access-page']);
  assert.ok(page.privates.every(element => element.textContent === ''));
  await page.enter(CODE);
  assert.deepEqual(page.visible(), ['hub']);
  assert.equal(page.privates[0].textContent, FIELDS.name);
  assert.deepEqual(started, []);
  page.click('open-presentation');
  assert.deepEqual(page.visible(), ['presentation']);
  assert.deepEqual(started, ['presentation']);
  page.click('deck-menu');
  assert.deepEqual(page.visible(), ['hub']);
  page.click('open-film');
  assert.deepEqual(page.visible(), ['experience']);
  assert.deepEqual(started, ['presentation', 'film']);
  page.click('film-menu');
  page.click('open-qr');
  assert.deepEqual(page.visible(), ['qr-experience']);
  assert.deepEqual(started, ['presentation', 'film', 'qr']);
  assert.equal(page.fetches(), 0);
  assert.equal(page.scripts.length, 0);
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
  click('slide-film-link');
  assert.equal(scripts[1].src, 'app.js');
  scripts[1].onload();
  assert.deepEqual(visible(), ['experience']);
  click('film-open-presentation');
  assert.equal(scripts.length, 2);
  assert.deepEqual(visible(), ['presentation']);
  click('deck-menu');
  assert.deepEqual(visible(), ['hub']);
  click('deck-finish');
  assert.deepEqual(visible(), ['hub']);
});

test('the closing page offers both films and the menu', async () => {
  const { scripts, enter, click, visible, location } = setup();
  await enter(CODE);
  click('open-presentation');
  scripts[0].onload();
  assert.deepEqual(visible(), ['presentation']);
  click('deck-open-film');
  assert.equal(scripts[1].src, 'app.js');
  scripts[1].onload();
  assert.deepEqual(visible(), ['experience']);
  click('deck-menu');
  assert.deepEqual(visible(), ['hub']);
  click('deck-open-qr');
  assert.equal(scripts[2].src, 'qr.js');
  scripts[2].onload();
  assert.deepEqual(visible(), ['qr-experience']);
  assert.equal(location.hash, '#qr');
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

test('choosing the QR film loads only its own script, shows it, and the menu button returns', async () => {
  const { $, scripts, enter, click, visible, location, focused } = setup();
  await enter(CODE);
  click('open-qr');
  assert.equal(location.hash, '#qr');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'qr.js', 'neither the phone film nor the presentation is downloaded');
  assert.deepEqual(visible(), ['hub'], 'wait for the QR script');
  assert.equal($('open-qr').disabled, true);
  assert.equal($('open-film').disabled, true);
  scripts[0].onload();
  assert.deepEqual(visible(), ['qr-experience']);
  assert.equal($('qr-skip-link').hidden, false);
  assert.equal($('film-skip-link').hidden, true);
  assert.equal(focused(), 'qr-start');
  click('qr-menu');
  assert.equal(location.hash, '#menu');
  assert.deepEqual(visible(), ['hub']);
  assert.equal($('qr-skip-link').hidden, true);
  click('open-qr');
  assert.equal(scripts.length, 1, 'the QR script is not downloaded twice');
  assert.deepEqual(visible(), ['qr-experience']);
});

test('a link straight to the QR film opens it once the code is entered', async () => {
  const page = setup({ hash: '#qr' });
  await page.enter(CODE);
  assert.equal(page.scripts[0].src, 'qr.js');
  page.scripts[0].onload();
  assert.deepEqual(page.visible(), ['qr-experience']);
});

test('leaving a film for the menu pauses its video so no sound carries on from a hidden page', async () => {
  const { videos, enter, click, scripts } = setup();
  const [phoneFilm, qrFilm] = videos;
  await enter(CODE);
  // Both films are playing when the viewer opens the QR film: only the other one is stopped.
  phoneFilm.paused = false;
  qrFilm.paused = false;
  click('open-qr');
  scripts[0].onload();
  assert.equal(qrFilm.paused, false, 'the film being watched is left alone');
  assert.equal(phoneFilm.paused, true, 'the film that is not on screen is stopped');
  click('qr-menu');
  assert.equal(qrFilm.paused, true, 'leaving for the menu stops it');
  // And the same in the other direction.
  phoneFilm.paused = false;
  click('open-film');
  scripts[1].onload();
  assert.equal(phoneFilm.paused, false);
  click('film-menu');
  assert.equal(phoneFilm.paused, true);
});

test('the QR film links across to the presentation page about QR codes', async () => {
  const { enter, click, scripts, location, visible } = setup();
  await enter(CODE);
  click('open-qr');
  scripts[0].onload();
  click('qr-open-presentation');
  assert.equal(location.hash, '#slide-11');
  assert.equal(scripts[1].src, 'presentation.js');
  scripts[1].onload();
  assert.deepEqual(visible(), ['presentation']);
  click('qr-slide-film-link');
  assert.equal(location.hash, '#qr');
  assert.deepEqual(visible(), ['qr-experience']);
});

test('a QR script download failure names the QR film and can be retried', async () => {
  const { $, scripts, enter, click, visible } = setup();
  await enter(CODE);
  click('open-qr');
  scripts[0].onerror();
  assert.deepEqual(visible(), ['hub']);
  assert.match($('hub-error').textContent, /QR code film could not load/);
  assert.equal($('open-qr').disabled, false);
  click('open-qr');
  assert.equal(scripts.length, 2);
  scripts[1].onload();
  assert.deepEqual(visible(), ['qr-experience']);
});
