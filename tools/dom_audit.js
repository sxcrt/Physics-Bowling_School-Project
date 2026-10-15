// In-page layout audit for the browser build. Paste this file's contents into
// the DevTools console (or evaluate it over CDP) on a loaded page; it defines
// window.hellsAudit() which returns layout defects for the current screen:
//
//   - elements that stick out of the 1280x720 stage
//   - leaf text that overlaps other leaf text
//   - text clipped by its own box
//   - buttons whose centre point is not hit-testable (covered / displaced)
//
// It only reads the DOM; it never mutates the game.
(() => {
  function leafText(el) {
    if (el.children.length !== 0) return false;
    return !!el.textContent && el.textContent.trim().length > 0;
  }

  window.hellsAudit = function hellsAudit() {
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    const sc = sr.width / 1280;
    const scale = (v) => Math.round(v / sc);
    const nodes = [];
    document.querySelectorAll('#ui-root div, #ui-root input, #ui-root canvas, #ui-root video').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) return;
      nodes.push({ el, r, cs });
    });
    const label = (el) => {
      const own = el.textContent && el.textContent.trim().slice(0, 30);
      if (own) return own;
      return `[${el.className}]`;
    };
    const out = [];
    for (const { el, r } of nodes) {
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) {
        out.push({ kind: 'out-of-stage', el: label(el), box: [scale(r.left - sr.left), scale(r.top - sr.top), scale(r.width), scale(r.height)] });
      }
    }
    const texts = nodes.filter(({ el }) => leafText(el));
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i].r; const b = texts[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 4 && oy > 4) {
          out.push({
            kind: 'text-overlap',
            a: label(texts[i].el), b: label(texts[j].el),
            overlap: [scale(ox), scale(oy)],
          });
        }
      }
    }
    for (const { el, cs } of nodes) {
      if (!leafText(el)) continue;
      if (el.scrollHeight > el.clientHeight + 2 && cs.overflowY !== 'visible') {
        out.push({ kind: 'clipped-text', el: label(el), scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
      if (el.scrollWidth > el.clientWidth + 4 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') {
        out.push({ kind: 'clipped-text-x', el: label(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
    }
    document.querySelectorAll('#ui-root .ui-button').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(hit === el || (hit && el.contains(hit)))) {
        out.push({ kind: 'button-not-hittable', el: label(el), hit: hit ? (hit.className || hit.tagName) : 'none' });
      }
    });
    return out;
  };
})();
