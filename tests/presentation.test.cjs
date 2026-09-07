const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'presentation.js'), 'utf8');
const PAGE_IDS = [...html.matchAll(/<article class="slide[^"]*" id="(slide-\d+)"/g)].map(match => match[1]);

function setup({ hash = '' } = {}) {
  const listeners = {};
  let focused;
  const pages = PAGE_IDS.map(id => ({
    id, hidden: id !== 'slide-1',
    heading: { focus(options) { assert.equal(options.preventScroll, true); focused = id; } },
    querySelector(selector) { assert.equal(selector, 'h2'); return this.heading; },
  }));
  const stage = { scrollTop: 40, querySelectorAll(selector) { assert.equal(selector, '.slide'); return pages; } };
  const elements = {
    'deck-stage': stage,
    'deck-back': { disabled: false, handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } },
    'deck-next': { hidden: false, handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } },
    'deck-count': { textContent: '' },
    presentation: { hidden: false },
  };
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
    window: { location, addEventListener(event, fn) { (listeners[event] ??= []).push(fn); } },
    document: {
      getElementById(id) { assert.ok(id in elements, `Missing element: ${id}`); return elements[id]; },
      addEventListener(event, fn) { (listeners[event] ??= []).push(fn); },
    },
  });
  const shown = () => pages.filter(page => !page.hidden).map(page => page.id);
  const key = (name, extra = {}) => {
    const event = { key: name, target: { tagName: 'DIV' }, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    for (const fn of listeners.keydown) fn(event);
    return event;
  };
  return { $: id => elements[id], pages, stage, shown, key, location, focused: () => focused };
}

test('twelve pages, starting on the first', () => {
  const { $, pages, stage, shown, focused } = setup();
  assert.equal(pages.length, 12);
  assert.deepEqual(shown(), ['slide-1']);
  assert.equal($('deck-count').textContent, '1 of 12');
  assert.equal($('deck-back').disabled, true);
  assert.equal($('deck-next').hidden, false);
  assert.equal(focused(), 'slide-1');
  assert.equal(stage.scrollTop, 0);
});

test('Next and Back move one page, update the address and focus the new heading', () => {
  const { $, shown, location, focused } = setup();
  $('deck-next').handlers.click();
  assert.equal(location.hash, '#slide-2');
  assert.deepEqual(shown(), ['slide-2']);
  assert.equal($('deck-count').textContent, '2 of 12');
  assert.equal($('deck-back').disabled, false);
  assert.equal(focused(), 'slide-2');
  $('deck-back').handlers.click();
  assert.equal(location.hash, '#slide-1');
  assert.deepEqual(shown(), ['slide-1']);
  $('deck-back').handlers.click();
  assert.deepEqual(shown(), ['slide-1'], 'Back stops at the first page');
});

test('the last page hides Next and Next cannot go beyond it', () => {
  const { $, shown, location } = setup({ hash: '#slide-12' });
  assert.deepEqual(shown(), ['slide-12']);
  assert.equal($('deck-count').textContent, '12 of 12');
  assert.equal($('deck-next').hidden, true);
  $('deck-next').handlers.click();
  assert.equal(location.hash, '#slide-12');
  assert.deepEqual(shown(), ['slide-12']);
});

test('arrow, page and Home/End keys move between pages', () => {
  const { shown, key } = setup();
  assert.equal(key('ArrowRight').prevented, true);
  assert.deepEqual(shown(), ['slide-2']);
  key('PageDown');
  assert.deepEqual(shown(), ['slide-3']);
  key('ArrowLeft');
  assert.deepEqual(shown(), ['slide-2']);
  key('PageUp');
  assert.deepEqual(shown(), ['slide-1']);
  key('End');
  assert.deepEqual(shown(), ['slide-12']);
  key('Home');
  assert.deepEqual(shown(), ['slide-1']);
  assert.equal(key('Enter').prevented, false, 'other keys are left alone');
});

test('keys are ignored while typing, with modifiers, or when the presentation is hidden', () => {
  const { $, shown, key } = setup();
  assert.equal(key('ArrowRight', { target: { tagName: 'INPUT' } }).prevented, false);
  assert.equal(key('ArrowRight', { ctrlKey: true }).prevented, false);
  $('presentation').hidden = true;
  assert.equal(key('ArrowRight').prevented, false);
  assert.deepEqual(shown(), ['slide-1']);
});

test('page numbers in the address are clamped and other addresses leave the page alone', () => {
  assert.deepEqual(setup({ hash: '#slide-99' }).shown(), ['slide-12']);
  assert.deepEqual(setup({ hash: '#slide-0' }).shown(), ['slide-1']);
  const { shown, location } = setup({ hash: '#slide-5' });
  assert.deepEqual(shown(), ['slide-5']);
  location.hash = '#film';
  assert.deepEqual(shown(), ['slide-5']);
  location.hash = '#slide-7';
  assert.deepEqual(shown(), ['slide-7']);
});
