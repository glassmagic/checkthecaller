/* A shared-code entry screen, not authentication: the static assets remain public. */
(() => {
  'use strict';
  // Change this value to change the shared visitor code. Matching ignores case and outer spaces.
  const ACCESS_CODE = 'CHECK2026';
  const STORAGE_KEY = 'checkthecaller-access';
  // Each section's script downloads only when that section is first opened, so
  // choosing the presentation never starts a video download.
  const SCRIPTS = { film: 'app.js', presentation: 'presentation.js' };
  const $ = id => document.getElementById(id);
  const ready = new Set();
  let unlocked = false;
  let pending = null;

  function showError(message) {
    $('access-error').textContent = message;
    $('access-error').hidden = false;
  }
  function sectionFor(hash) {
    if (hash === '#film') return 'film';
    if (/^#slide-\d+$/.test(hash)) return 'presentation';
    return 'hub';
  }
  function setHubBusy(busy) {
    for (const id of ['open-film', 'open-presentation']) $(id).disabled = busy;
  }
  function reveal(section) {
    $('access-page').hidden = true;
    $('hub').hidden = section !== 'hub';
    $('presentation').hidden = section !== 'presentation';
    $('experience').hidden = section !== 'film';
    $('film-skip-link').hidden = section !== 'film';
    if (section === 'hub') $('hub-title').focus({ preventScroll: true });
    else if (section === 'film') $('start').focus({ preventScroll: true });
    else $('deck-stage').focus({ preventScroll: true }); // presentation.js then focuses each page heading.
  }
  function load(section, onReady) {
    const src = SCRIPTS[section];
    if (!src || ready.has(src)) { onReady(); return; }
    if (pending) return;
    $('hub-error').hidden = true;
    setHubBusy(true);
    const script = document.createElement('script');
    script.src = src;
    pending = script;
    script.onload = () => {
      pending = null;
      ready.add(src);
      setHubBusy(false);
      onReady();
    };
    script.onerror = () => {
      pending = null;
      script.remove();
      setHubBusy(false);
      reveal('hub');
      $('hub-error').textContent = section === 'film'
        ? 'The film could not load. Check your connection and try again.'
        : 'The presentation could not load. Check your connection and try again.';
      $('hub-error').hidden = false;
    };
    document.head.append(script);
  }
  // The address bar hash is the single source of truth for which section is open,
  // so the browser's Back button returns to the menu or the previous page.
  function route() {
    if (!unlocked) return;
    const section = sectionFor(window.location.hash);
    load(section, () => reveal(section));
  }
  function go(hash) {
    if (window.location.hash === hash) route();
    else window.location.hash = hash;
  }
  function unlock() {
    unlocked = true;
    try { window.sessionStorage.setItem(STORAGE_KEY, ACCESS_CODE); } catch (_error) { /* Storage is optional. */ }
    route();
  }

  $('access-form').addEventListener('submit', event => {
    event.preventDefault();
    const code = $('access-code').value.trim().toUpperCase();
    if (code !== ACCESS_CODE) {
      $('access-code').setAttribute('aria-invalid', 'true');
      showError(code ? 'That code was not recognised. Please check it and try again.' : 'Please enter your access code.');
      $('access-code').focus({ preventScroll: true });
      return;
    }
    $('access-code').removeAttribute('aria-invalid');
    $('access-error').hidden = true;
    unlock();
  });
  $('access-code').addEventListener('input', () => {
    $('access-code').removeAttribute('aria-invalid');
    $('access-error').hidden = true;
  });
  for (const id of ['open-film', 'deck-open-film', 'slide-film-link']) $(id).addEventListener('click', () => go('#film'));
  for (const id of ['open-presentation', 'film-open-presentation']) $(id).addEventListener('click', () => go('#slide-1'));
  for (const id of ['deck-menu', 'film-menu', 'deck-finish']) $(id).addEventListener('click', () => go('#menu'));
  window.addEventListener('hashchange', route);
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) === ACCESS_CODE) unlock();
  } catch (_error) { /* Private browsing can disable storage; entry still works. */ }
})();
