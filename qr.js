/* The QR code film: one lead-in, then one of two alternative endings.
   No player libraries or trackers. Background downloads stay on this site. */
(() => {
  'use strict';
  // The lead-in finishes on a frame that already carries the A and B wording. The
  // buttons below belong to the page; the endings start straight on the action.
  const SOURCES = {
    intro: 'assets/QRScamAssets/QRFraudPart1.m4v',
    scam: 'assets/QRScamAssets/QR Fraud Answer 1.m4v',
    check: 'assets/QRScamAssets/QR Fraud Answer 2.m4v',
  };
  const LABELS = { scam: 'Enter your details and continue', check: 'Check the website address first' };
  const OUTCOMES = {
    scam: {
      label: 'THE UNSAFE CHOICE',
      title: 'The driver’s details were sent to a fraudulent website.',
      text: 'The page looked convincing and even showed a payment-success message. But it was townpark-pay.example, not the company’s own address, townpark.example. A convincing page can still be fake.',
    },
    check: {
      label: 'THE SAFER CHOICE',
      title: 'The driver checked the address before entering anything.',
      text: 'The sign said townpark.example. The page said townpark-pay.example. The driver closed it and found an approved way to pay through the company’s own website. At the pub, a customer asked staff about the sticker on the menu.',
    },
  };
  const $ = id => document.getElementById(id);
  const video = $('qr-film');
  const preparedSources = new Map();
  const backgroundLoads = new Map();
  const attemptedSources = new Set();
  const watched = new Set();
  let phase = 'start'; // start, intro, choice, ending, complete
  let selected = null;
  let loadedKey = 'intro';
  let loadedSource = SOURCES.intro;
  let page = 0;
  let warming = false;
  video.src = loadedSource;

  const isPlayback = () => ['intro', 'ending'].includes(phase);
  const timestamp = seconds => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };
  const announce = message => { $('qr-status').textContent = message; };
  const focus = id => $(id).focus({ preventScroll: true });
  function notice(message) {
    $('qr-stage-notice').hidden = !message;
    $('qr-stage-notice-text').textContent = message || '';
  }

  function cancelBackgroundLoad(source) {
    if (backgroundLoads.has(source)) attemptedSources.delete(source);
    backgroundLoads.get(source)?.abort();
    backgroundLoads.delete(source);
  }
  async function prepareEndings() {
    // Browsers cannot fetch file: URLs; adjacent videos load through the player.
    if (window.location?.protocol === 'file:') return;
    if (!window.fetch || !window.URL?.createObjectURL || !window.AbortController) return;
    // canplaythrough can fire repeatedly; only one run may be active at a time.
    if (warming) return;
    warming = true;
    // One ending at a time, low priority, and only once the lead-in can play through.
    for (const key of ['scam', 'check']) {
      const source = SOURCES[key];
      if (preparedSources.has(source) || attemptedSources.has(source)) continue;
      attemptedSources.add(source);
      const controller = new window.AbortController();
      backgroundLoads.set(source, controller);
      try {
        const response = await window.fetch(source, { cache: 'force-cache', priority: 'low', signal: controller.signal });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!controller.signal.aborted && blob.size) preparedSources.set(source, window.URL.createObjectURL(blob));
      } catch (_error) {
        // Warming is optional; loading the ending directly still works.
      } finally {
        if (backgroundLoads.get(source) === controller) backgroundLoads.delete(source);
      }
    }
    warming = false;
  }

  function syncProgress() {
    const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    $('qr-progress').max = end || 1;
    $('qr-progress').value = Math.min(video.currentTime || 0, end || 1);
    $('qr-progress').setAttribute('aria-valuetext', `${timestamp(video.currentTime)} of ${timestamp(end)}`);
    $('qr-time').textContent = `${timestamp(video.currentTime)} / ${timestamp(end)}`;
  }
  function syncControls() {
    const playable = isPlayback() && $('qr-error-panel').hidden;
    $('qr-play-pause').disabled = !playable;
    $('qr-progress').disabled = !playable;
    $('qr-play-pause').textContent = video.paused ? 'Play' : 'Pause';
    $('qr-play-pause').setAttribute('data-playing', String(!video.paused));
    $('qr-mute').textContent = video.muted ? 'Unmute' : 'Mute sound';
    $('qr-mute').setAttribute('aria-pressed', String(video.muted));
    syncProgress();
  }
  function renderPages() {
    $('qr-page-0').hidden = page !== 0;
    $('qr-page-1').hidden = page !== 1;
  }
  function render() {
    $('qr-player').setAttribute('data-phase', phase);
    $('qr-start-screen').hidden = phase !== 'start';
    $('qr-choice').hidden = phase !== 'choice';
    $('qr-complete').hidden = phase !== 'complete';
    const active = phase === 'choice' ? 'choose' : ['ending', 'complete'].includes(phase) ? 'ending' : 'watch';
    for (const step of ['watch', 'choose', 'ending']) {
      if (step === active) $(`qr-step-${step}`).setAttribute('aria-current', 'step');
      else $(`qr-step-${step}`).removeAttribute('aria-current');
    }
    syncControls();
  }

  async function play() {
    try {
      await video.play();
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        notice('Press Play to continue');
        announce('Your browser paused playback. Press Play to continue.');
      } else showError();
    }
    syncControls();
  }
  function showError() {
    video.pause();
    $('qr-error-panel').hidden = false;
    notice('Video unavailable');
    announce('The video could not play. Check your connection and select Try again.');
    syncControls();
  }
  function loadClip(key) {
    $('qr-error-panel').hidden = true;
    notice('Loading the story…');
    const source = SOURCES[key];
    if (loadedKey !== key || loadedSource !== source || video.error) {
      cancelBackgroundLoad(source);
      loadedKey = key;
      loadedSource = source;
      video.src = preparedSources.get(source) || source;
      video.load();
    } else {
      video.currentTime = 0;
    }
  }

  function start() {
    selected = null;
    watched.clear();
    page = 0;
    phase = 'intro';
    loadClip('intro');
    render();
    play();
    focus('qr-play-pause');
  }
  function showChoice() {
    phase = 'choice';
    video.pause();
    notice('');
    render();
    announce('The film has paused. Choose what the driver should do.');
    focus('qr-choice-title');
  }
  function choose(key) {
    if (!['choice', 'complete'].includes(phase)) return;
    selected = key;
    page = 0;
    phase = 'ending';
    loadClip(key);
    render();
    play();
    announce(`You chose: ${LABELS[key]}. Playing the ending.`);
    focus('qr-stage');
  }
  function complete() {
    phase = 'complete';
    page = 0;
    watched.add(selected);
    const outcome = OUTCOMES[selected];
    $('qr-complete').setAttribute('data-outcome', selected);
    $('qr-outcome-label').textContent = outcome.label;
    $('qr-complete-title').textContent = outcome.title;
    $('qr-complete-description').textContent = outcome.text;
    const both = watched.size === 2;
    for (const id of ['qr-other-0', 'qr-other-1']) {
      $(id).innerHTML = `${both ? 'Watch the other ending again' : 'Watch the other ending'} <span aria-hidden="true">→</span>`;
    }
    notice('');
    renderPages();
    render();
    announce('The ending has finished. You can read what to remember or watch the other ending.');
    focus('qr-complete-title');
  }
  function showPage(next) {
    page = next;
    renderPages();
    focus(page === 0 ? 'qr-complete-title' : 'qr-remember-title');
  }

  $('qr-start').addEventListener('click', start);
  $('qr-restart').addEventListener('click', start);
  $('qr-choose-scam').addEventListener('click', () => choose('scam'));
  $('qr-choose-check').addEventListener('click', () => choose('check'));
  for (const id of ['qr-other-0', 'qr-other-1']) $(id).addEventListener('click', () => choose(selected === 'check' ? 'scam' : 'check'));
  $('qr-remember').addEventListener('click', () => showPage(1));
  $('qr-back').addEventListener('click', () => showPage(0));
  $('qr-play-pause').addEventListener('click', () => {
    if (!isPlayback()) return;
    if (video.paused) play(); else video.pause();
  });
  $('qr-mute').addEventListener('click', () => { video.muted = !video.muted; syncControls(); });
  $('qr-progress').addEventListener('input', () => {
    if (!isPlayback()) return;
    video.currentTime = Math.max(0, Math.min(Number($('qr-progress').value), Number($('qr-progress').max)));
    syncProgress();
  });
  $('qr-retry').addEventListener('click', () => {
    const key = phase === 'ending' ? selected : 'intro';
    const source = SOURCES[key];
    if (preparedSources.has(source)) {
      window.URL.revokeObjectURL(preparedSources.get(source));
      preparedSources.delete(source);
    }
    loadedKey = null; // Force a fresh request even for failures without a MediaError.
    loadClip(key);
    render();
    play();
  });
  video.addEventListener('canplaythrough', () => { if (phase === 'intro') prepareEndings(); });
  video.addEventListener('timeupdate', syncProgress);
  video.addEventListener('durationchange', syncProgress);
  video.addEventListener('playing', () => { notice(''); syncControls(); });
  video.addEventListener('play', syncControls);
  video.addEventListener('pause', syncControls);
  video.addEventListener('waiting', () => { if (isPlayback()) notice('Loading the story…'); });
  video.addEventListener('volumechange', syncControls);
  video.addEventListener('error', showError);
  video.addEventListener('ended', () => {
    if (phase === 'intro') showChoice();
    else if (phase === 'ending') complete();
  });
  render();
})();
