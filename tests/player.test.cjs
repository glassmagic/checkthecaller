const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function setup({ ready = true, frames = true } = {}) {
  const elements = new Map();
  let focused;
  class Element {
    constructor(id) { this.id = id; this.handlers = {}; this.attributes = {}; this.hidden = false; this.value = 0; }
    addEventListener(event, handler) { (this.handlers[event] ??= []).push(handler); }
    emit(event) { for (const handler of this.handlers[event] || []) handler({ type: event }); }
    click() { if (!this.disabled) this.emit('click'); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus(options) {
      assert.equal(options?.preventScroll, true, 'focus changes must preserve the page position');
      focused = this.id;
    }
    scrollIntoView() { assert.fail('Story transitions must not scroll the page'); }
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    assert.ok(!elements.has(id), `Duplicate HTML ID: ${id}`);
    elements.set(id, new Element(id));
  }
  const $ = id => { assert.ok(elements.has(id), `Missing HTML element: ${id}`); return elements.get(id); };
  const video = $('film');
  Object.assign(video, { currentTime: 0, duration: 84.958333, readyState: ready ? 1 : 0, paused: true, muted: false, error: null });
  let nextError = null;
  video.play = async () => {
    if (nextError) { const error = nextError; nextError = null; throw error; }
    video.paused = false;
    video.emit('play');
    if (!video.paused) video.emit('playing');
  };
  video.pause = () => { const changed = !video.paused; video.paused = true; if (changed) video.emit('pause'); };
  video.load = () => { video.readyState = 0; video.error = null; video.loads = (video.loads || 0) + 1; };
  if (frames) {
    video.requestVideoFrameCallback = callback => { video.frameCallback = callback; return 1; };
    video.cancelVideoFrameCallback = () => { video.frameCallback = null; };
  }
  let interval;
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const documentEvents = {};
  const documentState = {
    hidden: false,
    getElementById: $,
    addEventListener(name, callback) { documentEvents[name] = callback; },
  };
  vm.runInNewContext(script, {
    document: documentState,
    window: {
      setInterval(callback) { interval = callback; },
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  function advance(ms) {
    const target = clock + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > target) break;
      const [id, timer] = entry;
      clock = timer.at;
      timers.delete(id);
      timer.callback();
    }
    clock = target;
  }
  function visibility(hidden) { documentState.hidden = hidden; documentEvents.visibilitychange(); }
  function metadata() {
    video.readyState = 1;
    video.duration = video.src?.includes('Wrong') ? 90.041667 : 84.958333;
    video.emit('loadedmetadata');
  }
  function decision() { $('start').click(); video.currentTime = 30; video.emit('timeupdate'); }
  function end() { video.currentTime = video.duration; video.pause(); video.emit('ended'); }
  return { $, video, metadata, decision, end, advance, visibility, focused: () => focused, tick: () => interval(), reject: name => { nextError = Object.assign(new Error(name), { name }); } };
}

test('starts without autoplay and pauses at 30 seconds until a choice is made', () => {
  const { $, video, focused } = setup();
  assert.equal(video.paused, true);
  assert.equal($('start-screen').hidden, false);
  $('start').click();
  assert.equal(video.paused, false);
  video.currentTime = 29.99;
  video.emit('timeupdate');
  assert.equal($('choice-panel').hidden, true);
  video.currentTime = 30.1;
  video.emit('timeupdate');
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 30);
  assert.equal($('choice-panel').hidden, false);
  assert.equal($('play-pause').disabled, true);
  assert.equal(focused(), 'choice-title');
  video.play();
  assert.equal(video.paused, true, 'external media commands must not bypass the choice');
});

for (const branch of ['right', 'wrong']) {
  test(`${branch} choice starts matching ending at 30 seconds, then offers the alternative`, () => {
    const { $, video, metadata, decision, end } = setup();
    decision();
    $(`choose-${branch}`).click();
    if (branch === 'wrong') {
      assert.equal(video.src, 'ScamProtection_Wrong.m4v');
      assert.equal($('play-pause').disabled, true, 'wait for new metadata before seeking');
      metadata();
    }
    assert.equal(video.currentTime, 30);
    assert.equal(video.paused, false);
    assert.equal($('choice-panel').hidden, true);
    assert.equal($('complete-panel').hidden, true);
    video.currentTime = 40;
    video.emit('timeupdate');
    assert.equal(video.paused, false, 'ending must not trigger the decision gate again');
    end();
    assert.equal($('complete-panel').hidden, false);
    assert.match($('outcome-label').textContent, branch === 'right' ? /SAFER/ : /UNSAFE/);
    $('other-ending').click();
    metadata();
    assert.equal(video.src, branch === 'right' ? 'ScamProtection_Wrong.m4v' : 'ScamProtection_Right.m4v');
    assert.equal(video.currentTime, 30);
    end();
    assert.match($('other-note').textContent, /seen both endings/);
    $('other-ending').click();
    metadata();
    assert.equal(video.currentTime, 30);
  });
}

test('restart clears watched endings and returns to the beginning', () => {
  const { $, video, metadata, decision, end } = setup();
  decision(); $('choose-wrong').click(); metadata(); end();
  $('restart').click(); metadata();
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, false);
  video.currentTime = 30; video.emit('timeupdate');
  assert.equal($('choice-panel').hidden, false);
  $('choose-right').click(); end();
  assert.doesNotMatch($('other-note').textContent, /seen both/);
});

test('seeking cannot bypass the decision or rewind an ending into the intro', () => {
  const { $, video } = setup();
  $('start').click();
  video.currentTime = 80; video.emit('seeking');
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
  video.currentTime = 5; video.emit('seeking');
  assert.equal(video.currentTime, 30);
  $('choose-right').click();
  video.currentTime = 5; video.emit('seeking');
  assert.equal(video.currentTime, 30);
});

test('progress control reaches the decision but cannot seek beyond it', () => {
  const { $, video } = setup();
  $('start').click();
  $('progress').value = 70; $('progress').emit('input');
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
  assert.equal($('choice-panel').hidden, false);
});

test('frame callback stops the introduction at the boundary', () => {
  const { $, video } = setup();
  $('start').click();
  const callback = video.frameCallback;
  video.frameCallback = null; // A browser consumes its pending one-shot callback.
  callback(1000, { mediaTime: 30 });
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
  assert.equal(video.frameCallback, null);
});

test('timer fallback handles delayed media events and browsers without frame callbacks', () => {
  const { $, video, tick } = setup({ frames: false });
  $('start').click();
  video.currentTime = 33;
  tick();
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
});

test('start before metadata waits, then seeks and plays', () => {
  const { $, video, metadata } = setup({ ready: false });
  $('start').click();
  assert.equal($('play-pause').disabled, true);
  assert.equal(video.paused, true);
  metadata();
  assert.equal(video.paused, false);
  assert.equal($('play-pause').disabled, false);
});

test('blocked automatic playback exposes a working Play button', async () => {
  const { $, video, reject } = setup();
  reject('NotAllowedError');
  $('start').click();
  await new Promise(setImmediate);
  assert.match($('stage-notice-text').textContent, /Press Play/);
  assert.equal($('play-pause').disabled, false);
  $('play-pause').click();
  assert.equal(video.paused, false);
  assert.equal($('stage-notice').hidden, true);
});

test('a failed ending can be retried at the same position', () => {
  const { $, video, decision, metadata } = setup();
  decision(); $('choose-wrong').click(); metadata();
  video.currentTime = 45;
  video.error = { code: 2 }; video.emit('error');
  assert.equal($('error-panel').hidden, false);
  $('retry').click(); metadata();
  assert.equal($('error-panel').hidden, true);
  assert.equal(video.currentTime, 45);
  assert.equal(video.src, 'ScamProtection_Wrong.m4v');
  assert.equal(video.paused, false);
});

test('sound and pause controls work throughout playback', () => {
  const { $, video } = setup();
  $('start').click(); $('mute').click();
  assert.equal(video.muted, true);
  assert.equal($('mute').attributes['aria-pressed'], 'true');
  $('play-pause').click();
  assert.equal(video.paused, true);
  $('play-pause').click();
  assert.equal(video.paused, false);
});

function guidedReplay() {
  const player = setup();
  player.decision();
  player.$('choose-right').click();
  player.end();
  player.$('watch-commentary').click();
  player.metadata();
  return player;
}

test('commentary replays the unsafe version from zero and pauses at all six warnings', () => {
  const { $, video, advance, end } = guidedReplay();
  assert.equal(video.src, 'ScamProtection_Wrong.m4v');
  assert.equal(video.currentTime, 0);
  assert.equal($('progress').min, 0);
  assert.equal($('progress').max, 90.041667);
  assert.equal($('commentary-banner').hidden, false);
  for (const [time, title] of [[11.5, /unexpected call/], [16.9, /urgent/], [42.8, /card number/], [51.9, /text code/], [58.35, /do not share/], [64.9, /safety/]]) {
    video.currentTime = time + .1;
    video.emit('timeupdate');
    assert.equal(video.currentTime, time, 'delayed event is clamped to the warning moment');
    assert.equal(video.paused, true);
    assert.equal($('commentary-panel').hidden, false);
    assert.match($('commentary-title').textContent, title);
    assert.equal($('play-pause').disabled, true);
    advance(11000);
    assert.equal(video.paused, true);
    advance(1000);
    assert.equal(video.paused, false);
    assert.equal($('commentary-panel').hidden, true);
    if (time === 16.9) {
      video.currentTime = 30;
      video.emit('timeupdate');
      assert.equal(video.paused, false, 'guided replay continues through the original choice point');
      assert.equal($('choice-panel').hidden, true);
    }
  }
  end();
  assert.equal($('complete-panel').hidden, false);
  assert.equal($('commentary-banner').hidden, true);
  assert.match($('complete-title').textContent, /lost all the money/);
  assert.match($('other-note').textContent, /seen both endings/);
});

test('commentary can stay paused indefinitely or continue early without a stale timer', () => {
  const { $, video, advance } = guidedReplay();
  video.currentTime = 12; video.emit('timeupdate');
  $('hold-commentary').click();
  advance(120000);
  assert.equal(video.paused, true);
  assert.match($('commentary-countdown').textContent, /when you’re ready/);
  $('continue-commentary').click();
  assert.equal(video.paused, false);
  video.currentTime = 17; video.emit('timeupdate');
  advance(1000);
  $('continue-commentary').click();
  video.currentTime = 43; video.emit('timeupdate');
  advance(11000);
  assert.equal(video.paused, true, 'an earlier cue’s timer must not resume the next pause');
  advance(1000);
  assert.equal(video.paused, false);
});

test('hiding the page holds commentary until the viewer explicitly continues', () => {
  const { $, video, visibility, advance } = guidedReplay();
  video.currentTime = 12; video.emit('timeupdate');
  advance(1000); visibility(true); advance(30000);
  assert.equal(video.paused, true);
  visibility(false); advance(30000);
  assert.equal(video.paused, true);
  $('continue-commentary').click();
  assert.equal(video.paused, false);
});

test('seeking forward shows missed warnings, and rewinding allows warnings to be seen again', () => {
  const { $, video } = guidedReplay();
  video.currentTime = 80; video.emit('seeking');
  assert.equal(video.currentTime, 11.5);
  video.currentTime = 20; video.emit('seeking');
  assert.equal(video.currentTime, 11.5, 'seek is locked while a note is paused');
  $('continue-commentary').click();
  video.currentTime = 17; video.emit('timeupdate');
  $('continue-commentary').click();
  video.currentTime = 0; video.emit('seeking');
  video.currentTime = 12; video.emit('timeupdate');
  assert.match($('commentary-label').textContent, /1 OF 6/);
  assert.equal(video.paused, true);
});

test('exit cancels commentary pauses and restores the original interactive story', () => {
  const { $, video, advance, metadata } = guidedReplay();
  video.currentTime = 12; video.emit('timeupdate');
  $('exit-commentary').click(); metadata();
  assert.equal(video.src, 'ScamProtection_Right.m4v');
  assert.equal(video.currentTime, 0);
  assert.equal($('commentary-banner').hidden, true);
  video.currentTime = 30; video.emit('timeupdate');
  advance(30000);
  assert.equal(video.paused, true);
  assert.equal($('choice-panel').hidden, false);
});

test('a network failure retains commentary mode and does not repeat completed cues', () => {
  const { $, video, metadata } = guidedReplay();
  video.currentTime = 12; video.emit('timeupdate'); $('continue-commentary').click();
  video.currentTime = 14; video.error = { code: 2 }; video.emit('error');
  $('retry').click(); metadata();
  assert.equal(video.currentTime, 14);
  assert.equal($('commentary-banner').hidden, false);
  video.currentTime = 17; video.emit('timeupdate');
  assert.match($('commentary-label').textContent, /2 OF 6/);
});

test('media keyboard commands cannot bypass a commentary pause', () => {
  const { $, video } = guidedReplay();
  video.currentTime = 12; video.emit('timeupdate');
  video.play();
  assert.equal(video.paused, true);
  assert.equal($('commentary-panel').hidden, false);
});

test('ending explanations page through all notes without moving focus by scrolling', () => {
  const { $, decision, end, focused } = setup();
  decision(); $('choose-right').click(); end();
  assert.equal($('result-page-0').hidden, false);
  assert.equal($('result-back').disabled, true);
  assert.equal($('result-actions').hidden, false);
  const titles = ['complete-title', 'warning-caller-title', 'warning-pressure-title', 'warning-account-title', 'safe-next-step-title'];
  for (let page = 1; page < 5; page++) {
    $('result-next').click();
    for (let index = 0; index < 5; index++) assert.equal($(`result-page-${index}`).hidden, index !== page);
    assert.equal($('result-page-count').textContent, `${page + 1} of 5`);
    assert.equal(focused(), titles[page]);
  }
  $('result-back').click();
  assert.equal($('result-page-3').hidden, false);
  $('result-next').click();
  assert.equal($('result-next').textContent, 'Back to result');
  $('result-next').click();
  assert.equal($('result-actions').hidden, false);
  assert.equal($('result-back').disabled, true);
});

test('a new ending opens its outcome instead of retaining the previous explanation page', () => {
  const { $, decision, end, metadata } = setup();
  decision(); $('choose-right').click(); end();
  $('result-next').click();
  $('result-back').click();
  $('other-ending').click(); metadata(); end();
  assert.equal($('result-page-0').hidden, false);
  assert.equal($('result-page-count').textContent, '1 of 5');
  assert.equal($('result-actions').hidden, false);
});
