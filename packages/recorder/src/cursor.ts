// Fake cursor overlay. Headless Playwright videos never show the OS cursor,
// so this DOM overlay is the ONLY cursor visible in raw.webm.
//
// Injected via context.addInitScript (runs before any page script on every
// navigation) and re-positioned from Node after each load.
//
// Exposes on window:
//   __svpCursor.moveTo(x, y, ms)  -> Promise, rAF ease-in-out animation
//   __svpCursor.click()           -> ~420 ms expanding ring ripple at cursor pos
//   __svpCursor.beacon(k)         -> flip the sync beacon colour for step k
//   __svpCursor.pos()             -> { x, y }
//   __svpCursor.zoom(cx, cy, s, ms) -> Promise, animate the page zoom (CSS transform on <html>,
//                                    origin = viewport point cx,cy) to scale s; s = 1 ends the zoom
//   __svpCursor.zoomReset()       -> drop any zoom instantly (error path)
//
// ZOOM: a transform on <html> scales everything, including our position:fixed overlays, and makes
// <html> the containing block of fixed elements (they lay out at document coordinates, i.e. jump by
// -scrollY on a window-scrolled page). The overlay compensates for its own elements: the cursor is
// placed at (pos + scroll) and counter-scaled by 1/s around its hot spot, so it stays the normal size
// and sits exactly on the zoomed content point it pointed at; the beacon strip/square get the inverse
// transform, so the sync beacon never moves. The app's own fixed elements are NOT compensated – on a
// window-scrolled page they shift during the zoom (SPAs with inner scroll containers are unaffected).
// With the beacon on (recordVideo) the zoom paints on the same ~24 fps cadence as everything else;
// without it (CDP screencast) it paints on every animation frame for a smooth zoom.
//
// FRAME-RATE NOTE (important for A/V sync): Playwright's video writer emits
// max(1, round(25 * dt)) video frames per screencast frame. Anything that
// repaints faster than 25 fps therefore STRETCHES the video vs wall time.
// All overlay animation runs through one rAF loop that only paints on an
// alternating 2/3-vsync cadence (≈ 41.7 ms ≈ 24 fps), which keeps video time
// ≈ wall time. Do not "fix" this back to painting on every rAF tick.
//
// BEACON STRIP: the browser viewport is recorded BEACON_STRIP_PX taller than
// the recipe viewport. The bottom strip is an opaque, fixed, max-z-index bar
// that holds the sync beacon (BEACON_PX square, bottom-left). The assembler
// crops the strip away (timing.beacon_strip_px), so nothing of it reaches
// final.mp4. Page content may extend under the strip; that is by design.

export const CURSOR_ID = '__svp-cursor';
export const BEACON_ID = '__svp-beacon';
export const STRIP_ID = '__svp-strip';
export const BEACON_PX = 6;
/** Extra rows recorded below the recipe viewport; cropped away by the assembler. */
export const BEACON_STRIP_PX = 8;
export const CURSOR_PX = 28;

/**
 * Overlay init script. `beacon: false` (CDP screencast mode) never creates the beacon strip –
 * screencast timestamps make the beacon unnecessary and the page keeps its full viewport.
 */
export function cursorInitScript(opts: { beacon: boolean }): string {
  return CURSOR_INIT_TEMPLATE.replace('__SVP_BEACON_ON__', opts.beacon ? 'true' : 'false');
}

const CURSOR_INIT_TEMPLATE = `
(() => {
  if (window.__svpCursor) return;
  const BEACON_ON = __SVP_BEACON_ON__;
  const SIZE = ${CURSOR_PX};
  const HOT = { x: 4 * SIZE / 24, y: 2 * SIZE / 24 }; // arrow tip inside the svg box (path is in 24-unit space)
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 24 24">'
    + '<path d="M4 2 L4 19.5 L8.6 15.4 L11.6 22 L14.4 20.7 L11.5 14.3 L17.5 14.3 Z"'
    + ' fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const state = { x: (window.innerWidth || 1920) / 2, y: (window.innerHeight || 1080) / 2, el: null };
  const Z = '2147483647';

  // Keep an overlay element as the LAST child of <body>: with equal (max) z-index the
  // later sibling wins, so modals/toasts appended after us can never cover the cursor.
  function toTop(el) {
    if (document.body && document.body.lastElementChild !== el) document.body.appendChild(el);
  }

  let ensure = function () {
    if (!document.body) return null;
    let el = state.el && state.el.isConnected ? state.el : document.getElementById('${CURSOR_ID}');
    if (!el) {
      el = document.createElement('div');
      el.id = '${CURSOR_ID}';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;pointer-events:none;'
        + 'z-index:' + Z + ';filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.35));will-change:transform;';
      el.innerHTML = SVG;
      document.body.appendChild(el);
    }
    toTop(el);
    state.el = el;
    place();
    return el;
  };
  // zoom state (see ZOOM note above); s = current page scale, sx/sy = scroll at zoom start
  const zoomSt = { on: false, s: 1, cx: 0, cy: 0, sx: 0, sy: 0, prev: null, fixed: [] };
  function place() {
    if (!state.el) return;
    if (!zoomSt.on) { state.el.style.transformOrigin = ''; state.el.style.transform = 'translate(' + (state.x - HOT.x) + 'px,' + (state.y - HOT.y) + 'px)'; return; }
    state.el.style.transformOrigin = HOT.x + 'px ' + HOT.y + 'px';
    state.el.style.transform = 'translate(' + (state.x + zoomSt.sx - HOT.x) + 'px,' + (state.y + zoomSt.sy - HOT.y) + 'px) scale(' + (1 / zoomSt.s).toFixed(5) + ')';
  }
  const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  // --- shared throttled animation loop (paints on ticks 0,2 of every 5 => 2,3,2,3 vsyncs) ---
  const anims = new Set();
  let loopRunning = false, tick = 0;
  function loop(now) {
    tick++;
    const paint = (tick % 5 === 0) || (tick % 5 === 2);
    for (const a of Array.from(anims)) {
      if (!paint && !a.every) continue;
      const p = Math.min(1, (now - a.t0) / a.ms);
      a.render(p);
      if (p >= 1) { anims.delete(a); a.done(); }
    }
    if (anims.size) requestAnimationFrame(loop); else loopRunning = false;
  }
  function animate(ms, render, every) {
    return new Promise(done => {
      const a = { t0: performance.now(), ms, render, done, every: !!every };
      anims.add(a);
      if (!loopRunning) { loopRunning = true; requestAnimationFrame(loop); }
    });
  }

  function moveTo(x, y, ms) {
    ensure();
    const sx = state.x, sy = state.y;
    if (!ms || ms <= 0) { state.x = x; state.y = y; place(); return Promise.resolve(); }
    return animate(ms, p => {
      const e = ease(p);
      state.x = sx + (x - sx) * e;
      state.y = sy + (y - sy) * e;
      place();
    });
  }

  // Click ripple: ~420 ms (≈ 10 frames at 25 fps, 5 painted at the 24 fps cadence), a 56 px ring
  // plus a soft filled disc so it stays visible even when the ring lands on a busy background.
  function click() {
    if (!document.body) return Promise.resolve();
    const cx = state.x, cy = state.y, R = 28;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:0;top:0;width:' + (2 * R) + 'px;height:' + (2 * R) + 'px;border-radius:50%;'
      + 'border:3px solid rgba(59,130,246,.95);background:rgba(59,130,246,.22);box-sizing:border-box;pointer-events:none;'
      + 'z-index:' + Z + ';transform:translate(' + (cx - R) + 'px,' + (cy - R) + 'px) scale(0.25);opacity:1;';
    document.body.appendChild(ring);
    ensure(); // cursor back on top of the ring
    return animate(420, p => {
      ring.style.transform = 'translate(' + (cx - R) + 'px,' + (cy - R) + 'px) scale(' + (0.25 + 0.75 * p) + ')';
      ring.style.opacity = String(1 - p * p);
    }).then(() => ring.remove());
  }

  // --- sync beacon: BEACON_PX square in the bottom-left corner of an opaque strip that
  // sits in the extra BEACON_STRIP_PX rows below the recipe viewport. Colour changes at
  // every step start (0 = grey, odd = black, even = white); the recorder scans it in
  // raw.webm afterwards to map wall-clock step starts onto true video time. ---
  let beaconK = 0;
  function beacon(k) {
    beaconK = k;
    if (!BEACON_ON || !document.body) return;
    let strip = document.getElementById('${STRIP_ID}');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = '${STRIP_ID}';
      strip.setAttribute('aria-hidden', 'true');
      strip.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:${BEACON_STRIP_PX}px;background:#808080;'
        + 'pointer-events:none;z-index:' + Z + ';margin:0;padding:0;border:0;';
      document.body.appendChild(strip);
    }
    let b = document.getElementById('${BEACON_ID}');
    if (!b) {
      b = document.createElement('div');
      b.id = '${BEACON_ID}';
      b.setAttribute('aria-hidden', 'true');
      b.style.cssText = 'position:fixed;left:0;bottom:0;width:${BEACON_PX}px;height:${BEACON_PX}px;pointer-events:none;'
        + 'z-index:' + Z + ';margin:0;padding:0;border:0;';
      document.body.appendChild(b);
    }
    toTop(strip); toTop(b);
    b.style.background = k === 0 ? '#808080' : (k % 2 ? '#000' : '#fff');
  }
  const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // cubic ease-in-out
  function zoomApply(s) {
    const h = document.documentElement;
    zoomSt.s = s;
    h.style.transform = 'scale(' + s.toFixed(5) + ')';
    for (const f of zoomSt.fixed) {
      // inverse of the page zoom for our fixed overlay (beacon strip/square): renders at its normal place/size
      f.el.style.transformOrigin = (zoomSt.cx - f.r.left) + 'px ' + (zoomSt.cy - f.r.top) + 'px';
      f.el.style.transform = 'translate(' + zoomSt.sx + 'px,' + zoomSt.sy + 'px) scale(' + (1 / s).toFixed(5) + ')';
    }
    place();
  }
  function zoomReset() {
    if (!zoomSt.on) return;
    const h = document.documentElement, p = zoomSt.prev;
    h.style.transform = p.t; h.style.transformOrigin = p.o; h.style.willChange = p.w; h.style.overflowX = p.ox; h.style.overflowY = p.oy;
    for (const f of zoomSt.fixed) Object.assign(f.el.style, f.saved);
    zoomSt.on = false; zoomSt.s = 1; zoomSt.sx = zoomSt.sy = 0; zoomSt.fixed = [];
    place();
  }
  function zoom(cx, cy, target, ms) {
    const h = document.documentElement;
    if (!zoomSt.on) {
      if (target === 1) return Promise.resolve({ scrolled: false });
      zoomSt.prev = { t: h.style.transform, o: h.style.transformOrigin, w: h.style.willChange, ox: h.style.overflowX, oy: h.style.overflowY };
      // the scaled page overflows the viewport: suppress the scrollbars that would newly appear, keep existing
      // ones (hiding those would change the layout width mid-zoom)
      const hasV = window.innerWidth > h.clientWidth, hasH = window.innerHeight > h.clientHeight;
      if (!hasH) h.style.overflowX = 'hidden';
      if (!hasV) h.style.overflowY = 'hidden';
      zoomSt.cx = cx; zoomSt.cy = cy; zoomSt.sx = window.scrollX; zoomSt.sy = window.scrollY;
      // pin our fixed overlays by top/left: under a transformed <html> bottom/right would resolve against
      // the <html> box (document height), not the viewport
      zoomSt.fixed = ['${STRIP_ID}', '${BEACON_ID}'].map(id => document.getElementById(id)).filter(Boolean).map(el => {
        const r = el.getBoundingClientRect(), st = el.style;
        const f = { el, r, saved: { transform: st.transform, transformOrigin: st.transformOrigin, top: st.top, left: st.left, right: st.right, bottom: st.bottom, width: st.width, height: st.height } };
        Object.assign(st, { top: r.top + 'px', left: r.left + 'px', right: 'auto', bottom: 'auto', width: r.width + 'px', height: r.height + 'px' });
        return f;
      });
      zoomSt.on = true;
      h.style.transformOrigin = (cx + zoomSt.sx) + 'px ' + (cy + zoomSt.sy) + 'px'; // <html> coords = document coords
      h.style.willChange = 'transform';
    }
    ensure();
    const from = zoomSt.s, scrolled = !!(zoomSt.sx || zoomSt.sy);
    return animate(Math.max(1, ms), p => zoomApply(from + (target - from) * easeIO(p)), !BEACON_ON)
      .then(() => { if (target === 1) zoomReset(); return { scrolled }; });
  }

  const ensure0 = ensure;
  ensure = function () { beacon(beaconK); return ensure0(); }; // strip+beacon first, cursor last => cursor on top

  window.__svpCursor = { moveTo, click, ensure, beacon, zoom, zoomReset, pos: () => ({ x: state.x, y: state.y }) };
  if (document.body) ensure();
  else document.addEventListener('DOMContentLoaded', ensure, { once: true });
})();
`;

/** Original (launch + recordVideo) mode: overlay with the sync beacon strip. */
export const CURSOR_INIT_SCRIPT = cursorInitScript({ beacon: true });

// Highlight helper – 2 s outline pulse on an element (2 x 1 s, ~24 fps via the shared loop).
export const HIGHLIGHT_FN = `(el) => {
  const prev = el.style.outline, prevOff = el.style.outlineOffset;
  const anim = (p) => {
    const v = Math.sin(Math.PI * ((p * 2) % 1));           // 0..1..0 twice
    el.style.outline = (4 * v).toFixed(1) + 'px solid rgba(59,130,246,' + (0.95 * v).toFixed(2) + ')';
    el.style.outlineOffset = (2 + 2 * v).toFixed(1) + 'px';
  };
  const t0 = performance.now();
  let tick = 0;
  return new Promise(res => {
    const f = (now) => {
      tick++;
      if (tick % 5 === 0 || tick % 5 === 2) {
        const p = Math.min(1, (now - t0) / 2000);
        anim(p);
        if (p >= 1) { el.style.outline = prev; el.style.outlineOffset = prevOff; res(); return; }
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
}`;
