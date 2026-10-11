const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'qr.js'), 'utf8');

const INTRO = 'assets/QRScamAssets/QRFraudPart1.m4v';
const SCAM = 'assets/QRScamAssets/QR Fraud Answer 1.m4v';
const CHECK = 'assets/QRScamAssets/QR Fraud Answer 2.m4v';

function setup({ network = false, protocol = 'https:' } = {}) {
  const elements = new Map();
  let focused;
  class Element {
    constructor(id) { this.id = id; this.handlers = {}; this.attributes = {}; this.hidden = false; this.value = 0; this.textContent = ''; this.innerHTML = ''; }
    addEventListener(event, handler) { (this.handlers[event] ??= []).push(handler); }
    emit(event) { for (const handler of this.handlers[event] || []) handler({ type: event }); }
    click() { if (!this.disabled) this.emit('click'); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus(options) {
      assert.equal(options?.preventScroll, true, 'focus changes must preserve the page position');
      focused = this.id;
    }
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, new Element(id));
  const $ = id => { assert.ok(elements.has(id), `Missing HTML element: ${id}`); return elements.get(id); };
  // Elements that start hidden in the markup must start hidden here too.
  for (const [, id] of html.matchAll(/id="([^"]+)"[^>]*\shidden\b/g)) if (elements.has(id)) elements.get(id).hidden = true;
  const video = $('qr-film');
  Object.assign(video, { currentTime: 0, duration: 0, paused: true, muted: false, error: null });
  let nextError = null;
  video.play = async () => {
    if (nextError) { const error = nextError; nextError = null; throw error; }
    video.paused = false;
    video.emit('play');
    video.emit('playing');
  };
  video.pause = () => { const changed = !video.paused; video.paused = true; if (changed) video.emit('pause'); };
  video.load = () => { video.error = null; video.loads = (video.loads || 0) + 1; };
  const requests = [];
  vm.runInNewContext(script, {
    document: { getElementById: $ },
    window: {
      location: { protocol },
      ...(network ? {
        AbortController,
        URL: { createObjectURL: blob => `blob:prepared-${blob.name}`, revokeObjectURL() {} },
        fetch(source, options) { return new Promise((resolve, reject) => { requests.push({ source, options, resolve, reject }); }); },
      } : {}),
    },
  });
  // Each clip reports its own length, as the real files do.
  const lengths = { [INTRO]: 54.333333, [SCAM]: 14.333333, [CHECK]: 16.75 };
  function metadata() { video.duration = lengths[decodeURIComponent(video.src).replace(/^blob:.*/, '') || video.src] ?? 15; video.emit('durationchange'); }
  function end() { video.currentTime = video.duration || 15; video.pause(); video.emit('ended'); }
  return { $, video, requests, metadata, end, focused: () => focused, reject: name => { nextError = Object.assign(new Error(name), { name }); } };
}

test('the film points at the three supplied videos and the poster exists', () => {
  for (const file of [INTRO, SCAM, CHECK, 'assets/qr-poster.jpg']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  }
  assert.match(html, /poster="assets\/qr-poster\.jpg"/);
});

test('the film opens on a start screen, loads only the lead-in, and does not autoplay', () => {
  const { $, video } = setup();
  assert.equal(video.src, INTRO);
  assert.equal(video.paused, true);
  assert.equal($('qr-start-screen').hidden, false);
  assert.equal($('qr-choice').hidden, true);
  assert.equal($('qr-complete').hidden, true);
  assert.equal($('qr-play-pause').disabled, true);
  assert.equal($('qr-step-watch').attributes['aria-current'], 'step');
});

test('starting plays the lead-in, and the choice buttons appear only when it ends', () => {
  const { $, video, focused, end } = setup();
  $('qr-start').click();
  assert.equal(video.paused, false);
  assert.equal($('qr-start-screen').hidden, true);
  assert.equal($('qr-choice').hidden, true, 'no buttons while the lead-in is playing');
  assert.equal($('qr-player').attributes['data-phase'], 'intro');
  assert.equal($('qr-play-pause').disabled, false);
  end();
  assert.equal($('qr-choice').hidden, false);
  assert.equal($('qr-player').attributes['data-phase'], 'choice');
  assert.equal($('qr-step-choose').attributes['aria-current'], 'step');
  assert.equal($('qr-play-pause').disabled, true);
  assert.equal(focused(), 'qr-choice-title');
  assert.equal(video.paused, true, 'the last frame stays up, carrying the wording');
});

test('the two buttons carry the wording from the brief', () => {
  const choice = /id="qr-choose-scam"[^>]*>(.*?)<\/button>/s.exec(html)[1].replace(/<[^>]+>/g, '').trim();
  const check = /id="qr-choose-check"[^>]*>(.*?)<\/button>/s.exec(html)[1].replace(/<[^>]+>/g, '').trim();
  assert.equal(choice, 'AEnter your details and continue.');
  assert.equal(check, 'BCheck the website address first.');
});

test('choosing A plays the scammed ending straight away, from the start of that file', () => {
  const { $, video, end, focused } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-scam').click();
  assert.equal(video.src, SCAM);
  assert.equal($('qr-choice').hidden, true);
  assert.equal(video.paused, false, 'the viewer pressed a button, so the ending plays at once');
  assert.equal($('qr-player').attributes['data-phase'], 'ending');
  assert.equal($('qr-step-ending').attributes['aria-current'], 'step');
  assert.equal(focused(), 'qr-stage');
});

test('choosing B plays the check-first ending', () => {
  const { $, video, end } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-check').click();
  assert.equal(video.src, CHECK);
  assert.equal(video.paused, false);
});

test('each ending finishes on its own outcome, then offers what to remember', () => {
  const { $, end, focused } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-scam').click();
  end();
  assert.equal($('qr-complete').hidden, false);
  assert.equal($('qr-complete').attributes['data-outcome'], 'scam');
  assert.match($('qr-outcome-label').textContent, /UNSAFE/);
  assert.match($('qr-complete-title').textContent, /fraudulent website/);
  assert.match($('qr-complete-description').textContent, /townpark-pay\.example/);
  assert.match($('qr-complete-description').textContent, /townpark\.example/);
  assert.equal($('qr-page-0').hidden, false);
  assert.equal($('qr-page-1').hidden, true);
  assert.equal(focused(), 'qr-complete-title');
  $('qr-remember').click();
  assert.equal($('qr-page-0').hidden, true);
  assert.equal($('qr-page-1').hidden, false);
  assert.equal(focused(), 'qr-remember-title');
  $('qr-back').click();
  assert.equal($('qr-page-0').hidden, false);
  // The safer ending reads differently.
  $('qr-other-0').click();
  end();
  assert.equal($('qr-complete').attributes['data-outcome'], 'check');
  assert.match($('qr-outcome-label').textContent, /SAFER/);
  assert.match($('qr-complete-title').textContent, /checked the address/);
});

test('the other ending is offered, and says so once both have been watched', () => {
  const { $, video, end } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-scam').click();
  end();
  assert.match($('qr-other-0').innerHTML, /^Watch the other ending </);
  $('qr-other-0').click();
  assert.equal(video.src, CHECK);
  end();
  assert.match($('qr-other-0').innerHTML, /other ending again/);
  assert.match($('qr-other-1').innerHTML, /other ending again/);
  $('qr-other-1').click();
  assert.equal(video.src, SCAM);
});

test('starting again returns to the lead-in and forgets which endings were seen', () => {
  const { $, video, end } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-check').click();
  end();
  $('qr-restart').click();
  assert.equal(video.src, INTRO);
  assert.equal($('qr-complete').hidden, true);
  assert.equal($('qr-choice').hidden, true);
  assert.equal(video.paused, false);
  end();
  $('qr-choose-scam').click();
  end();
  assert.match($('qr-other-0').innerHTML, /^Watch the other ending </, 'only one ending seen since restarting');
});

test('pause, play, mute and the position slider only work while a clip is playing', () => {
  const { $, video, metadata, end } = setup();
  $('qr-play-pause').click();
  assert.equal(video.paused, true, 'a disabled control does nothing');
  $('qr-start').click();
  metadata();
  assert.equal($('qr-time').textContent, '0:00 / 0:54');
  $('qr-play-pause').click();
  assert.equal(video.paused, true);
  assert.equal($('qr-play-pause').textContent, 'Play');
  $('qr-play-pause').click();
  assert.equal(video.paused, false);
  assert.equal($('qr-play-pause').textContent, 'Pause');
  $('qr-mute').click();
  assert.equal(video.muted, true);
  assert.equal($('qr-mute').textContent, 'Unmute');
  assert.equal($('qr-mute').attributes['aria-pressed'], 'true');
  $('qr-progress').value = 20;
  $('qr-progress').emit('input');
  assert.equal(video.currentTime, 20);
  end();
  $('qr-progress').value = 5;
  $('qr-progress').emit('input');
  assert.notEqual(video.currentTime, 5, 'the slider is inert while the choice is showing');
});

test('blocked autoplay exposes a working Play button instead of failing', async () => {
  const { $, video, reject } = setup();
  reject('NotAllowedError');
  $('qr-start').click();
  await new Promise(setImmediate);
  assert.equal($('qr-stage-notice').hidden, false);
  assert.equal($('qr-stage-notice-text').textContent, 'Press Play to continue');
  assert.equal($('qr-error-panel').hidden, true);
  $('qr-play-pause').click();
  assert.equal(video.paused, false);
});

test('a failed video shows the error panel, and Try again reloads the clip being watched', async () => {
  const { $, video, end } = setup();
  $('qr-start').click();
  end();
  $('qr-choose-check').click();
  const loads = video.loads;
  video.emit('error');
  assert.equal($('qr-error-panel').hidden, false);
  assert.equal($('qr-play-pause').disabled, true);
  $('qr-retry').click();
  assert.equal($('qr-error-panel').hidden, true);
  assert.equal(video.src, CHECK, 'it retries the ending, not the lead-in');
  assert.ok(video.loads > loads, 'a fresh request is made');
  assert.equal(video.paused, false);
});

test('local files play directly without fetch-based background downloads', () => {
  const { $, video, requests, end } = setup({ network: true, protocol: 'file:' });
  $('qr-start').click();
  video.emit('canplaythrough');
  assert.equal(requests.length, 0);
  end();
  $('qr-choose-scam').click();
  assert.equal(video.src, SCAM);
});

test('the endings are warmed one at a time, low priority, only once the lead-in can play through', async () => {
  const { $, video, requests, end } = setup({ network: true });
  assert.equal(requests.length, 0, 'nothing is fetched before the film starts');
  $('qr-start').click();
  assert.equal(requests.length, 0, 'or before the lead-in can play through');
  video.emit('canplaythrough');
  video.emit('canplaythrough');
  assert.equal(requests.length, 1, 'one request at a time');
  assert.equal(requests[0].source, SCAM);
  assert.equal(requests[0].options.priority, 'low');
  requests[0].resolve({ ok: true, blob: async () => ({ size: 100, name: 'scam' }) });
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].source, CHECK);
  requests[1].resolve({ ok: true, blob: async () => ({ size: 100, name: 'check' }) });
  await new Promise(setImmediate);
  end();
  $('qr-choose-check').click();
  assert.equal(video.src, 'blob:prepared-check', 'the finished download is used directly');
});

test('a failed or incomplete background download never delays the chosen ending', async () => {
  const { $, video, requests, end } = setup({ network: true });
  $('qr-start').click();
  video.emit('canplaythrough');
  requests[0].reject(new Error('offline'));
  await new Promise(setImmediate);
  end();
  $('qr-choose-scam').click();
  assert.equal(video.src, SCAM, 'it falls back to the file itself');
  assert.equal(video.paused, false);
});

test('the fictional-company notice is always on the page', () => {
  assert.match(html, /TownPark and the \.example website addresses are fictional demonstration details\./);
});

test('the caveat about legitimate payment providers is part of what to remember', () => {
  assert.match(html, /separate payment provider with a different address/);
  assert.match(html, /not proof of fraud/);
});
