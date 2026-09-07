/* A shared-code entry screen, not authentication: the pages and videos remain public.
   The presenter's personal details are the exception: they are published only as
   speaker.enc.json, sealed with the code (PBKDF2-SHA256 then AES-GCM, see
   scripts/private.cjs). Entering the code is the decryption, so the code itself is
   stored nowhere in the site. Keep this file and scripts/private.cjs in step. */
(() => {
  'use strict';
  const STORAGE_KEY = 'checkthecaller-access';
  const PRIVATE_URL = 'speaker.enc.json';
  // Each section's script downloads only when that section is first opened, so
  // choosing the presentation never starts a video download.
  const SCRIPTS = { film: 'app.js', presentation: 'presentation.js' };
  const $ = id => document.getElementById(id);
  const ready = new Set();
  let unlocked = false;
  let pending = null;
  let payload = null;
  let checking = false;

  const normalise = code => code.trim().toUpperCase();
  const bytes = text => Uint8Array.from(window.atob(text), character => character.charCodeAt(0));
  async function loadPayload() {
    if (payload) return payload;
    const response = await window.fetch(PRIVATE_URL);
    if (!response.ok) throw new Error('unavailable');
    payload = await response.json();
    return payload;
  }
  async function unseal(code) {
    const subtle = window.crypto?.subtle;
    if (!subtle) throw new Error('unsupported');
    const sealed = await loadPayload();
    const material = await subtle.importKey('raw', new TextEncoder().encode(normalise(code)), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(sealed.salt), iterations: sealed.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv) }, key, bytes(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function fill(fields) {
    for (const element of document.querySelectorAll('[data-private]')) element.textContent = fields[element.getAttribute('data-private')] ?? '';
  }
  function messageFor(error) {
    if (error.name === 'OperationError') return 'That code was not recognised. Please check it and try again.';
    if (error.message === 'unsupported') return 'This browser cannot open the site. Please use an up-to-date browser such as Safari, Chrome, Edge or Firefox.';
    return 'Could not check your code. Check your connection and try again.';
  }
  function showError(message) {
    $('access-error').textContent = message;
    $('access-error').hidden = false;
  }
  function setEntryBusy(busy) {
    $('access-submit').disabled = busy;
    if (busy) $('access-submit').textContent = 'Checking your code…';
    else $('access-submit').innerHTML = 'Continue <span aria-hidden="true">→</span>';
  }
  async function tryCode(code, { quiet = false } = {}) {
    if (checking) return;
    checking = true;
    setEntryBusy(true);
    try {
      fill(await unseal(code));
      unlock(normalise(code));
    } catch (error) {
      if (!quiet) {
        $('access-code').setAttribute('aria-invalid', String(error.name === 'OperationError'));
        showError(messageFor(error));
        $('access-code').focus({ preventScroll: true });
      }
    } finally {
      checking = false;
      setEntryBusy(false);
    }
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
  function unlock(code) {
    unlocked = true;
    try { window.sessionStorage.setItem(STORAGE_KEY, code); } catch (_error) { /* Storage is optional. */ }
    route();
  }

  $('access-form').addEventListener('submit', event => {
    event.preventDefault();
    const code = $('access-code').value;
    if (!normalise(code)) {
      $('access-code').setAttribute('aria-invalid', 'true');
      showError('Please enter your access code.');
      $('access-code').focus({ preventScroll: true });
      return undefined;
    }
    $('access-code').removeAttribute('aria-invalid');
    $('access-error').hidden = true;
    return tryCode(code);
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
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved) tryCode(saved, { quiet: true });
  } catch (_error) { /* Private browsing can disable storage; entry still works. */ }
})();
