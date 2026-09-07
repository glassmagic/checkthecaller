/* A shared-code entry screen, not authentication: the static assets remain public. */
(() => {
  'use strict';
  // Change this value to change the shared visitor code. Matching ignores case and outer spaces.
  const ACCESS_CODE = 'CHECK2026';
  const STORAGE_KEY = 'checkthecaller-access';
  const $ = id => document.getElementById(id);
  let loading = false;

  function showError(message) {
    $('access-error').textContent = message;
    $('access-error').hidden = false;
  }
  function openFilm() {
    if (loading) return;
    loading = true;
    $('access-submit').disabled = true;
    $('access-submit').textContent = 'Opening the film…';
    $('access-error').hidden = true;
    const script = document.createElement('script');
    script.src = 'app.js';
    script.onload = () => {
      try { window.sessionStorage.setItem(STORAGE_KEY, ACCESS_CODE); } catch (_error) { /* Storage is optional. */ }
      $('access-page').hidden = true;
      $('experience').hidden = false;
      $('film-skip-link').hidden = false;
      $('start').focus({ preventScroll: true });
    };
    script.onerror = () => {
      script.remove();
      loading = false;
      $('access-submit').disabled = false;
      $('access-submit').textContent = 'Open the film →';
      showError('The film could not load. Check your connection and try again.');
    };
    // Do not download either video or initialise the player until entry succeeds.
    document.head.append(script);
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
    openFilm();
  });
  $('access-code').addEventListener('input', () => {
    $('access-code').removeAttribute('aria-invalid');
    $('access-error').hidden = true;
  });
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) === ACCESS_CODE) openFilm();
  } catch (_error) { /* Private browsing can disable storage; entry still works. */ }
})();
