// In-page layout audit for the browser build. Paste this file's contents into
// the DevTools console (or evaluate it over CDP) on a loaded page; it defines
// window.hellsAudit() which returns layout defects for the current screen:
//
//   - elements that stick out of the 1280x720 stage
//   - leaf text that overlaps other leaf text
//   - text clipped by its own box
//   - content that escapes (and is clipped by) a scrolling/hidden ancestor
//   - text hidden behind an opaque element drawn on top of it
//   - text sitting under a button plate
//   - buttons whose centre point is not hit-testable (covered / displaced)
//
// Intentional layering is explicitly allowed: full-screen backdrops
// (.screen-dim, .screen-vignette), decorative glow layers (.brand-glow) and
// elements with pointer-events:none are never treated as obscuring text.
//
// It only reads the DOM; it never mutates the game.
(() => {
  function leafText(el) {
    if (el.children.length !== 0) return false;
    return !!el.textContent && el.textContent.trim().length > 0;
  }

  const IGNORED_OVERLAYS = ['screen-dim', 'screen-vignette', 'brand-glow', 'hint-strip', 'motion-particle'];
  function isIgnoredOverlay(el) {
    if (!el.className || typeof el.className !== 'string') return false;
    return IGNORED_OVERLAYS.some((name) => el.className.includes(name));
  }

  function hasVisiblePaint(cs) {
    const bg = cs.backgroundColor || '';
    const match = bg.match(/rgba?\(([^)]+)\)/);
    if (match) {
      const parts = match[1].split(',').map((v) => Number(v.trim()));
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha > 0.05) return true;
    }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    return false;
  }

  window.hellsAudit = function hellsAudit() {
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    const sc = sr.width / 1280;
    const scale = (v) => Math.round(v / sc);
    const nodes = [];
    document.querySelectorAll('#ui-root div, #ui-root input, #ui-root canvas, #ui-root video, #ui-root span, #ui-root svg')
      .forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
        const r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return;
        nodes.push({ el, r, cs });
      });
    const label = (el) => {
      const own = el.textContent && el.textContent.trim().slice(0, 30);
      if (own) return own;
      return `[${String(el.className || el.tagName).slice(0, 30)}]`;
    };
    const out = [];
    for (const { el, r } of nodes) {
      // The decorative glow layers are deliberately larger than the stage;
      // they are backgrounds, not content.
      if (isIgnoredOverlay(el)) continue;
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
    // Content that escapes a clipping ancestor (a panel with overflow:hidden,
    // a scroll box): its own box is fine, but the container cuts it off.
    for (const { el, r } of nodes) {
      if (el.children.length > 0) continue;
      let parent = el.parentElement;
      while (parent && parent !== stage) {
        const pcs = getComputedStyle(parent);
        if (pcs.display === 'none') break;
        if ((pcs.overflow !== 'visible' || pcs.overflowY !== 'visible' || pcs.overflowX !== 'visible')) {
          const pr = parent.getBoundingClientRect();
          const dx = Math.max(pr.left - r.left, r.right - pr.right);
          const dy = Math.max(pr.top - r.top, r.bottom - pr.bottom);
          if (dx > 2 || dy > 2) {
            out.push({
              kind: 'escapes-clipping-panel',
              el: label(el),
              container: String(parent.className || parent.tagName).slice(0, 30),
              over: [scale(dx), scale(dy)],
            });
          }
          break;      // the nearest clipping ancestor is the one that cuts
        }
        parent = parent.parentElement;
      }
    }
    // Text covered by an opaque element (an overlay, a plate, a video) drawn
    // above it in the stacking order. Elements that are not hit-testable
    // (the HUD's pointer-events:none layers) cannot be resolved through
    // elementsFromPoint, so they are skipped rather than guessed at.
    const notHittable = (el) => {
      let node = el;
      while (node && node !== stage) {
        if (getComputedStyle(node).pointerEvents === 'none') return true;
        node = node.parentElement;
      }
      return false;
    };
    for (const { el, r } of texts) {
      if (notHittable(el)) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < sr.left || cx > sr.right || cy < sr.top || cy > sr.bottom) continue;
      const stack = document.elementsFromPoint(cx, cy);
      const index = stack.indexOf(el);
      if (index < 0) continue;
      for (let i = 0; i < index; i += 1) {
        const other = stack[i];
        if (!other || other === el || el.contains(other) || other.contains(el)) continue;
        if (isIgnoredOverlay(other)) continue;
        const ocs = getComputedStyle(other);
        if (ocs.pointerEvents === 'none') continue;
        if (ocs.display === 'none' || ocs.visibility === 'hidden' || Number(ocs.opacity) < 0.2) continue;
        if (other.tagName === 'VIDEO' || other.tagName === 'CANVAS') {
          out.push({ kind: 'text-behind-media', el: label(el), hit: other.tagName });
          break;
        }
        if (hasVisiblePaint(ocs)) {
          out.push({ kind: 'text-behind-panel', el: label(el), hit: String(other.className || other.tagName).slice(0, 30) });
          break;
        }
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
