/* Page-by-page navigation for the presentation. Pages are plain HTML; nothing else downloads. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const stage = $('deck-stage');
  const pages = Array.from(stage.querySelectorAll('.slide'));
  const total = pages.length;
  let current = -1;

  const fromHash = () => {
    const match = /^#slide-(\d+)$/.exec(window.location.hash);
    return match ? Math.min(total, Math.max(1, Number(match[1]))) - 1 : null;
  };
  function show(index) {
    if (index === current) return;
    current = index;
    pages.forEach((page, position) => { page.hidden = position !== index; });
    $('deck-back').disabled = index === 0;
    $('deck-next').hidden = index === total - 1;
    $('deck-count').textContent = `${index + 1} of ${total}`;
    stage.scrollTop = 0;
    pages[index].querySelector('h2').focus({ preventScroll: true });
  }
  function goTo(index) {
    const target = Math.max(0, Math.min(total - 1, index));
    const hash = `#slide-${target + 1}`;
    if (window.location.hash === hash) show(target);
    else window.location.hash = hash;
  }

  window.addEventListener('hashchange', () => {
    const index = fromHash();
    if (index !== null) show(index);
  });
  $('deck-back').addEventListener('click', () => goTo(current - 1));
  $('deck-next').addEventListener('click', () => goTo(current + 1));
  document.addEventListener('keydown', event => {
    if ($('presentation').hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const targets = { ArrowRight: current + 1, PageDown: current + 1, ArrowLeft: current - 1, PageUp: current - 1, Home: 0, End: total - 1 };
    if (!(event.key in targets)) return;
    event.preventDefault();
    goTo(targets[event.key]);
  });
  show(fromHash() ?? 0);
})();
