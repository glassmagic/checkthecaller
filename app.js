/* No player libraries or trackers. Background downloads stay on this site. */
(() => {
  'use strict';
  const CHOICE_TIME = 30;
  const SOURCES = { right: 'ScamProtection_Right.m4v', wrong: 'ScamProtection_Wrong.m4v' };
  const PORTRAIT_SOURCES = { right: 'assets/portrait-right.mp4', wrong: 'assets/portrait-wrong.mp4' };
  const portraitQuery = window.matchMedia?.('(max-width: 650px) and (orientation: portrait)');
  const compactQuery = window.matchMedia?.('(max-width: 650px)');
  const isCompact = () => Boolean(compactQuery?.matches);
  const sourceFor = branch => (portraitQuery?.matches ? PORTRAIT_SOURCES : SOURCES)[branch];
  const LABELS = { right: 'Say no, hang up and check', wrong: 'Say yes and do as he asks' };
  // Seconds in the original unsafe video, aligned to the end of each request.
  const COMMENTARY_CUES = [
    { time: 11.5, title: 'An unexpected call from “the bank”', text: 'He says he is from the fraud team, but that does not prove who he is. Knowing Mrs Hartly’s name does not make the call genuine. Question with question: “Who’s calling? Which company? Why do you need that?”', mobileText: "He claims to be from the bank. Knowing her name proves nothing. Ask: who’s calling, which company, and why?" },
    { time: 16.9, title: 'Fear makes it feel urgent', text: 'Saying someone has tried to take her money creates alarm. That pressure is designed to make her follow instructions before checking whether the caller is genuine. Never agree in haste.', mobileText: "He says her money is at risk. Fear and pressure are designed to rush her. Never agree in haste." },
    { time: 42.8, title: 'He asks for the full card number', text: 'He presents the long card number as a security check. Your bank already has it. Giving card details to an unexpected caller can help them make fraudulent payments. Hang up and check independently.', mobileText: "He asks for the long card number as a “security check”. Your bank already has it. An unexpected caller could use it to commit fraud." },
    { time: 51.9, title: 'He asks her to read out a text code', text: 'A one-time code can approve a payment or give access to an account. Do not read it to an unexpected caller, even if they claim to be protecting you.', mobileText: "A text code can approve a payment or let someone into an account. Never read it to an unexpected caller." },
    { time: 58.35, title: 'He dismisses the “do not share” warning', text: 'Mrs Hartly notices the warning, but he says it does not apply to him. The warning still applies. Someone asking you to ignore it is a serious danger sign.', mobileText: "The text says “do not share”. He tells her to ignore that warning. The warning applies to him too." },
    { time: 64.9, title: 'He claims he will move her money to safety', text: 'A “safe account” is a common scam story. Your bank will never ask you to transfer money to one. Yes with no: “No. I’ll hang up and call the bank on the number on my card.”', mobileText: "Your bank will never ask you to move money to a “safe account”. Say no, hang up and call the number on your card." },
  ];
  const COMMENTARY_PAUSE_SECONDS = 12;
  const $ = (id) => document.getElementById(id);
  const video = $('film');
  let phase = 'start';
  let selected = null;
  let loaded = 'right';
  let loadedSource = sourceFor('right');
  const preparedSources = new Map();
  const backgroundLoads = new Map();
  const attemptedSources = new Set();
  let resumeAfterSeek = true;
  video.src = loadedSource;
  video.poster = portraitQuery?.matches ? 'assets/poster-portrait.jpg' : 'assets/poster.jpg';
  let pendingSeek = null;
  let generation = 0;
  let frameId = null;
  let nextCue = 0;
  let activeCue = null;
  let commentaryTimer = null;
  let commentarySeconds = 0;
  let lastCommentaryTime = 0;
  let resultPage = 0;
  const RESULT_HEADINGS = ['complete-title', 'warning-caller-title', 'warning-pressure-title', 'warning-account-title', 'safe-next-step-title', 'replay-title'];
  const watched = new Set();
  const isCommentary = () => ['commentary', 'commentary-pause'].includes(phase);
  const isPlayback = () => ['intro', 'ending', 'commentary'].includes(phase);

  function cancelBackgroundLoad(source) {
    if (backgroundLoads.has(source)) attemptedSources.delete(source);
    backgroundLoads.get(source)?.abort();
    backgroundLoads.delete(source);
  }
  async function prepareOtherEnding() {
    // Browsers cannot fetch file: URLs; adjacent videos load through the player.
    if (window.location?.protocol === 'file:') return;
    if (!window.fetch || !window.URL?.createObjectURL || !window.AbortController) return;
    const source = sourceFor(loaded === 'wrong' ? 'right' : 'wrong');
    if (preparedSources.has(source) || attemptedSources.has(source)) return;
    attemptedSources.add(source);
    const controller = new window.AbortController();
    backgroundLoads.set(source, controller);
    try {
      // Wait for canplaythrough before this low-priority request. Use the finished
      // local blob directly so selecting an ending doesn't rely on range-cache reuse.
      const response = await window.fetch(source, { cache: 'force-cache', priority: 'low', signal: controller.signal });
      if (!response.ok) return;
      const blob = await response.blob();
      if (!controller.signal.aborted && blob.size) preparedSources.set(source, window.URL.createObjectURL(blob));
    } catch (_error) {
      // Warming is optional; normal media loading and Retry still work offline or on failure.
    } finally {
      if (backgroundLoads.get(source) === controller) backgroundLoads.delete(source);
    }
  }

  const timestamp = (seconds) => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };
  function announce(message) { $('status').textContent = message; }
  function focus(id) { $(id).focus({ preventScroll: true }); }
  function notice(message) {
    $('stage-notice').hidden = !message;
    $('stage-notice-text').textContent = message || '';
  }
  function syncProgress() {
    const end = phase === 'ending' || phase === 'complete' || isCommentary() ? (video.duration || CHOICE_TIME) : CHOICE_TIME;
    $('progress').max = Number.isFinite(end) ? end : CHOICE_TIME;
    $('progress').min = phase === 'ending' || phase === 'complete' ? CHOICE_TIME : 0;
    $('progress').value = Math.min(video.currentTime || 0, Number($('progress').max));
    $('progress').setAttribute('aria-valuetext', `${timestamp(video.currentTime)} of ${timestamp(end)}`);
    $('time').textContent = `${timestamp(video.currentTime)} / ${timestamp(end)}`;
  }
  function syncControls() {
    const playable = isPlayback() && pendingSeek === null;
    $('play-pause').disabled = !playable;
    $('progress').disabled = !playable;
    $('play-pause').textContent = video.paused ? 'Play' : 'Pause';
    $('play-pause').setAttribute('data-playing', String(!video.paused));
    $('mute').textContent = video.muted ? 'Unmute' : 'Mute sound';
    $('mute').setAttribute('aria-pressed', String(video.muted));
    syncProgress();
  }
  function render() {
    $('player-card').setAttribute('data-phase', phase);
    $('start-screen').hidden = phase !== 'start';
    $('choice-panel').hidden = phase !== 'choice';
    $('complete-panel').hidden = phase !== 'complete';
    $('commentary-banner').hidden = !isCommentary();
    $('commentary-panel').hidden = phase !== 'commentary-pause';
    const active = phase === 'choice' ? 'choose' : ['ending', 'complete'].includes(phase) || isCommentary() ? 'ending' : 'watch';
    for (const step of ['watch', 'choose', 'ending']) {
      if (step === active) $(`step-${step}`).setAttribute('aria-current', 'step');
      else $(`step-${step}`).removeAttribute('aria-current');
    }
    syncControls();
  }
  function renderResultPages() {
    RESULT_HEADINGS.forEach((_heading, index) => { $(`result-page-${index}`).hidden = index !== resultPage; });
    $('result-back').disabled = resultPage === 0;
    $('result-next').textContent = resultPage === RESULT_HEADINGS.length - 1 ? 'Result' : 'Next →';
    $('result-actions').hidden = resultPage !== 5;
    $('result-next').hidden = resultPage === 0;
    $('result-back').hidden = resultPage === 0;
    $('result-navigation').setAttribute('data-page', String(resultPage));
    $('result-page-count').textContent = resultPage === 0 ? '' : resultPage === 5 ? 'Watch again' : `${resultPage} of 4 · What to remember`;
  }
  function changeResultPage(direction) {
    if (phase !== 'complete') return;
    resultPage = direction > 0 ? (resultPage + 1) % RESULT_HEADINGS.length : Math.max(0, resultPage - 1);
    renderResultPages();
    focus(RESULT_HEADINGS[resultPage]);
  }
  function stopFrameWatch() {
    if (frameId !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameId);
    frameId = null;
  }
  function showChoice() {
    if (phase !== 'intro') return;
    phase = 'choice';
    generation++;
    stopFrameWatch();
    video.pause();
    // Clamp the playhead even after a seek, tab suspension or delayed media event.
    video.currentTime = CHOICE_TIME;
    notice('');
    $('choice-panel').scrollTop = 0;
    render();
    announce('The film is paused. Choose what you would do next.');
    focus('choice-title');
  }
  function checkBoundary(mediaTime = video.currentTime) {
    if (phase === 'intro' && (mediaTime >= CHOICE_TIME || video.currentTime >= CHOICE_TIME)) showChoice();
    if (phase === 'commentary' && pendingSeek === null && $('error-panel').hidden) {
      const cue = COMMENTARY_CUES[nextCue];
      if (cue && Math.max(mediaTime, video.currentTime) >= cue.time) showCommentaryCue();
      lastCommentaryTime = video.currentTime;
    }
  }
  function watchFrames() {
    stopFrameWatch();
    if (!video.requestVideoFrameCallback || !['intro', 'commentary'].includes(phase)) return;
    const tick = (_now, metadata) => {
      frameId = null;
      checkBoundary(metadata.mediaTime);
      if (['intro', 'commentary'].includes(phase) && !video.paused) frameId = video.requestVideoFrameCallback(tick);
    };
    frameId = video.requestVideoFrameCallback(tick);
  }
  async function play() {
    const token = generation;
    try {
      await video.play();
      if (token !== generation && !isPlayback()) video.pause();
    } catch (error) {
      if (token !== generation || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        notice('Press Play to continue');
        announce('Your browser paused playback. Press Play to continue.');
      } else showError();
    }
    syncControls();
  }
  function showError() {
    clearCommentaryTimer();
    stopFrameWatch();
    video.pause();
    $('error-panel').hidden = false;
    notice('Video unavailable');
    announce('The video could not play. Check your connection and select Try again.');
  }
  function seekWhenReady() {
    if (pendingSeek === null || video.readyState < 1) return;
    if (video.duration <= pendingSeek) { pendingSeek = null; showError(); return; }
    const target = pendingSeek;
    pendingSeek = null;
    video.currentTime = target;
    syncControls();
    if (resumeAfterSeek && isPlayback()) play();
  }
  function loadAt(branch, time) {
    generation++;
    video.pause();
    stopFrameWatch();
    $('error-panel').hidden = true;
    pendingSeek = time;
    resumeAfterSeek = true;
    notice('Loading the story…');
    const source = sourceFor(branch);
    if (loaded !== branch || loadedSource !== source || video.error) {
      cancelBackgroundLoad(source);
      loaded = branch;
      loadedSource = source;
      video.src = preparedSources.get(source) || source;
      video.load();
    }
    render();
    seekWhenReady();
  }
  function changePresentation() {
    video.poster = portraitQuery?.matches ? 'assets/poster-portrait.jpg' : 'assets/poster.jpg';
    const source = sourceFor(loaded || selected || 'right');
    if (source === loadedSource) return;
    const time = pendingSeek ?? video.currentTime;
    const resume = pendingSeek !== null ? resumeAfterSeek : isPlayback() && !video.paused;
    generation++;
    video.pause();
    stopFrameWatch();
    pendingSeek = time;
    resumeAfterSeek = resume;
    loadedSource = source;
    for (const pendingSource of backgroundLoads.keys()) cancelBackgroundLoad(pendingSource);
    video.src = preparedSources.get(source) || source;
    video.load();
    if (phase !== 'start') notice('Adjusting the film…');
    if (phase === 'commentary-pause') holdCommentary();
    syncControls();
  }
  portraitQuery?.addEventListener('change', changePresentation);
  compactQuery?.addEventListener('change', () => {
    if (activeCue) {
      $('commentary-description').textContent = isCompact() ? activeCue.mobileText : activeCue.text;
      $('commentary-label').textContent = isCompact() ? `Warning ${nextCue} of ${COMMENTARY_CUES.length} · Film paused` : `WARNING SIGN ${nextCue} OF ${COMMENTARY_CUES.length} · FILM PAUSED`;
    }
    if (isCompact()) holdCommentary();
  });

  function start() {
    resetCommentary();
    selected = null;
    watched.clear();
    phase = 'intro';
    loadAt('right', 0);
    focus('play-pause');
  }
  function choose(branch) {
    if (!['choice', 'complete'].includes(phase)) return;
    resetCommentary();
    selected = branch;
    phase = 'ending';
    loadAt(branch, CHOICE_TIME);
    announce(`Your choice: ${LABELS[branch]}. Playing the ending.`);
    focus('video-stage');
  }
  function complete() {
    if (phase === 'intro') { showChoice(); return; }
    if (phase === 'commentary' && nextCue < COMMENTARY_CUES.length) { showCommentaryCue(); return; }
    if (!['ending', 'commentary'].includes(phase)) return;
    resetCommentary();
    phase = 'complete';
    resultPage = 0;
    renderResultPages();
    watched.add(selected);
    const safe = selected === 'right';
    $('complete-panel').setAttribute('data-outcome', selected);
    $('outcome-label').textContent = safe ? 'THE SAFER CHOICE' : 'THE UNSAFE CHOICE';
    $('complete-title').textContent = safe
      ? 'Mrs Hartly kept her money safe.'
      : 'Mrs Hartly lost all the money in her current account.';
    $('complete-description').textContent = safe
      ? 'She said no, hung up and called the bank on the number on her card.'
      : 'She said yes. The caller was a scammer, and he got everything he asked for.';
    $('other-ending').innerHTML = `${watched.size === 2 ? 'Watch the other ending again' : 'Watch the other ending'} <span aria-hidden="true">→</span>`;
    $('other-note').textContent = watched.size === 2
      ? 'You’ve now seen both endings. You can revisit either one or start again.'
      : 'The other ending starts at the choice, so you won’t repeat the introduction.';
    notice('');
    $('complete-panel').scrollTop = 0;
    $('result-body').scrollTop = 0;
    render();
    announce('The ending has finished. You can now watch the other ending or start again.');
    focus('complete-title');
  }

  function clearCommentaryTimer() {
    if (commentaryTimer !== null) window.clearTimeout(commentaryTimer);
    commentaryTimer = null;
  }
  function resetCommentary() {
    clearCommentaryTimer();
    nextCue = 0;
    activeCue = null;
    lastCommentaryTime = 0;
  }
  function startCommentary() {
    if (phase !== 'complete') return;
    resetCommentary();
    selected = 'wrong';
    phase = 'commentary';
    loadAt('wrong', 0);
    announce(isCompact() ? 'Replaying the unsafe version with six explanations. Read each warning, then select Continue film.' : 'Replaying the unsafe version with six on-screen explanations. Each pauses the film for twelve seconds. Select Keep paused if you need longer.');
    focus('video-stage');
  }
  function holdCommentary() {
    if (phase !== 'commentary-pause') return;
    clearCommentaryTimer();
    $('commentary-countdown').textContent = 'Paused. Continue when you’re ready.';
    $('hold-commentary').textContent = 'Staying paused';
    $('hold-commentary').setAttribute('aria-pressed', 'true');
  }
  function continueCommentary() {
    if (phase !== 'commentary-pause') return;
    clearCommentaryTimer();
    activeCue = null;
    phase = 'commentary';
    render();
    focus('video-stage');
    play();
  }
  function scheduleCommentaryResume() {
    $('commentary-countdown').textContent = `Film continues in ${commentarySeconds} seconds`;
    commentaryTimer = window.setTimeout(() => {
      commentaryTimer = null;
      if (phase !== 'commentary-pause') return;
      if (document.hidden) { holdCommentary(); return; }
      commentarySeconds--;
      if (commentarySeconds <= 0) continueCommentary();
      else scheduleCommentaryResume();
    }, 1000);
  }
  function showCommentaryCue() {
    if (phase !== 'commentary' || !COMMENTARY_CUES[nextCue]) return;
    activeCue = COMMENTARY_CUES[nextCue++];
    phase = 'commentary-pause';
    generation++;
    stopFrameWatch();
    video.pause();
    video.currentTime = activeCue.time;
    lastCommentaryTime = activeCue.time;
    notice('');
    $('commentary-label').textContent = isCompact() ? `Warning ${nextCue} of ${COMMENTARY_CUES.length} · Film paused` : `WARNING SIGN ${nextCue} OF ${COMMENTARY_CUES.length} · FILM PAUSED`;
    $('commentary-title').textContent = activeCue.title;
    const explanation = isCompact() ? activeCue.mobileText : activeCue.text;
    $('commentary-description').textContent = explanation;
    $('hold-commentary').textContent = 'Keep paused';
    $('hold-commentary').setAttribute('aria-pressed', 'false');
    $('commentary-panel').scrollTop = 0;
    $('commentary-copy').scrollTop = 0;
    render();
    announce(`${activeCue.title}. ${explanation} ${isCompact() ? 'Select Continue film when you are ready.' : 'The film will continue in twelve seconds. Select Keep paused for more time.'}`);
    focus('commentary-title');
    commentarySeconds = COMMENTARY_PAUSE_SECONDS;
    clearCommentaryTimer();
    if (document.hidden || isCompact()) holdCommentary();
    else scheduleCommentaryResume();
  }

  $('start').addEventListener('click', start);
  $('restart').addEventListener('click', start);
  $('watch-commentary').addEventListener('click', startCommentary);
  $('result-warnings').addEventListener('click', () => { if (phase === 'complete') { resultPage = 0; changeResultPage(1); } });
  $('result-replays').addEventListener('click', () => { if (phase === 'complete') { resultPage = 4; changeResultPage(1); } });
  $('result-back').addEventListener('click', () => changeResultPage(-1));
  $('result-next').addEventListener('click', () => changeResultPage(1));
  $('hold-commentary').addEventListener('click', holdCommentary);
  $('continue-commentary').addEventListener('click', continueCommentary);
  $('exit-commentary').addEventListener('click', () => { if (isCommentary()) start(); });
  $('choose-right').addEventListener('click', () => choose('right'));
  $('choose-wrong').addEventListener('click', () => choose('wrong'));
  $('other-ending').addEventListener('click', () => choose(selected === 'right' ? 'wrong' : 'right'));
  $('play-pause').addEventListener('click', () => {
    if (!isPlayback() || pendingSeek !== null) return;
    if (video.paused) play(); else video.pause();
  });
  $('mute').addEventListener('click', () => { video.muted = !video.muted; syncControls(); });
  $('progress').addEventListener('input', () => {
    if (!isPlayback() || pendingSeek !== null) return;
    video.currentTime = Math.max(Number($('progress').min), Math.min(Number($('progress').value), Number($('progress').max)));
    checkBoundary();
    syncProgress();
  });
  $('retry').addEventListener('click', () => {
    const guided = isCommentary();
    const target = guided ? video.currentTime || 0 : phase === 'ending' ? Math.max(CHOICE_TIME, video.currentTime || CHOICE_TIME) : 0;
    if (guided) { clearCommentaryTimer(); activeCue = null; phase = 'commentary'; }
    else if (phase !== 'ending') phase = 'intro';
    const branch = selected || 'right';
    const source = sourceFor(branch);
    if (preparedSources.has(source)) {
      window.URL.revokeObjectURL(preparedSources.get(source));
      preparedSources.delete(source);
    }
    loaded = null; // Force a fresh request even for network failures without MediaError.
    loadAt(branch, target);
  });
  video.addEventListener('loadedmetadata', () => { seekWhenReady(); syncProgress(); });
  video.addEventListener('canplaythrough', prepareOtherEnding);
  video.addEventListener('seeked', () => { if (pendingSeek === null && !video.error) notice(''); });
  video.addEventListener('durationchange', syncProgress);
  video.addEventListener('timeupdate', () => { checkBoundary(); syncProgress(); });
  video.addEventListener('seeking', () => {
    if (phase === 'commentary' && pendingSeek === null && video.currentTime < lastCommentaryTime - .2) {
      const upcoming = COMMENTARY_CUES.findIndex(cue => cue.time >= video.currentTime);
      nextCue = upcoming === -1 ? COMMENTARY_CUES.length : upcoming;
    }
    if (phase === 'commentary-pause' && activeCue && video.currentTime !== activeCue.time) video.currentTime = activeCue.time;
    checkBoundary();
    if (phase === 'choice' && video.currentTime !== CHOICE_TIME) video.currentTime = CHOICE_TIME;
    if (phase === 'ending' && pendingSeek === null && video.currentTime < CHOICE_TIME) video.currentTime = CHOICE_TIME;
  });
  video.addEventListener('play', () => {
    if (!isPlayback()) { video.pause(); return; }
    checkBoundary();
    watchFrames();
    syncControls();
  });
  video.addEventListener('playing', () => {
    if (!isPlayback()) { video.pause(); return; }
    notice('');
    syncControls();
  });
  video.addEventListener('pause', () => { stopFrameWatch(); syncControls(); });
  video.addEventListener('waiting', () => { if (isPlayback()) notice('Loading the story…'); });
  video.addEventListener('volumechange', syncControls);
  video.addEventListener('ended', complete);
  video.addEventListener('error', showError);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'commentary-pause') holdCommentary();
    checkBoundary();
  });
  // The timer also handles browsers without requestVideoFrameCallback.
  window.setInterval(checkBoundary, 25);
  render();
})();
