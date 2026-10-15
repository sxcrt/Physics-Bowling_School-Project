// In-page composite snapshot for the browser build's audit: draws the WebGL
// canvas plus the DOM UI into one image and POSTs it to the local snapshot sink
// (tools/snap_server.py on port 8899).
//
//   await window.hellsSnap('name');            // full stage, 0.75 scale
//   await window.hellsSnapZoom('name', x, y, w, h, 3);   // magnified crop
//
// The UI layer is rasterised by handing the (cloned) UI markup to the browser
// through an SVG <foreignObject>, so the browser's own layout engine draws it.
// html2canvas is *not* used any more: it re-implements layout, which misplaced
// absolutely positioned panels and dropped spaces inside words, so snapshots
// could not be trusted for either layout or text.
//
// Loaded with: fetch('/tools/snapshot.js').then(r => r.text())
(() => {
  const UI_STYLE = 'position:absolute;left:0;top:0;width:1280px;height:720px;'
    + 'font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;color:#f5f5fc;';

  function cloneUi() {
    const clone = document.getElementById('ui-root').cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    clone.style.cssText = UI_STYLE;
    // <video> cannot live inside an SVG document; stand in a flat plate.
    for (const video of clone.querySelectorAll('video')) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'width:100%;height:100%;background:#1a1436;';
      video.replaceWith(placeholder);
    }
    return clone;
  }

  async function composite(withUi) {
    const { renderer, scene, camera } = await import('/src/scene/renderer.js');
    renderer.render(scene, camera);
    const base = document.createElement('canvas');
    base.width = 1280; base.height = 720;
    const ctx = base.getContext('2d');
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.drawImage(renderer.domElement, 0, 0, 1280, 720);
    if (withUi) {
      const html = new XMLSerializer().serializeToString(cloneUi());
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">'
        + '<foreignObject x="0" y="0" width="1280" height="720">' + html + '</foreignObject></svg>';
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('snapshot: UI rasterisation failed'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      ctx.drawImage(image, 0, 0, 1280, 720);
    }
    return base;
  }

  async function post(name, canvas, quality = 0.85) {
    const response = await fetch(`http://127.0.0.1:8899/${name}`, {
      method: 'POST', body: canvas.toDataURL('image/jpeg', quality),
    });
    return `${name}:${response.status}`;
  }

  window.hellsSnap = async function hellsSnap(name, scale = 0.75, withUi = true) {
    const base = await composite(withUi);
    const out = document.createElement('canvas');
    out.width = Math.round(1280 * scale);
    out.height = Math.round(720 * scale);
    out.getContext('2d').drawImage(base, 0, 0, out.width, out.height);
    return post(name, out);
  };

  window.hellsSnapZoom = async function hellsSnapZoom(name, x, y, w, h, scale = 3, withUi = false) {
    const base = await composite(withUi);
    const out = document.createElement('canvas');
    out.width = Math.round(w * scale);
    out.height = Math.round(h * scale);
    out.getContext('2d').drawImage(base, x, y, w, h, 0, 0, out.width, out.height);
    return post(name, out);
  };
})();
