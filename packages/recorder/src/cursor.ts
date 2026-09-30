// Fake cursor overlay. Headless Playwright videos never show the OS cursor,
// so this DOM overlay is the ONLY cursor visible in raw.webm.
//
// Injected via context.addInitScript (runs before any page script on every
// navigation) and re-positioned from Node after each load.
//
// Exposes on window:
//   __svpCursor.moveTo(x, y, ms)  -> Promise, rAF ease-in-out animation
//   __svpCursor.click()           -> 300 ms expanding ring ripple at cursor pos
//   __svpCursor.pos()             -> { x, y }
//
// FRAME-RATE NOTE (important for A/V sync): Playwright's video writer emits
// max(1, round(25 * dt)) video frames per screencast frame. Anything that
// repaints faster than 25 fps therefore STRETCHES the video vs wall time.
// All overlay animation runs through one rAF loop that only paints on an
// alternating 2/3-vsync cadence (≈ 41.7 ms ≈ 24 fps), which keeps video time
// ≈ wall time. Do not "fix" this back to painting on every rAF tick.

export const CURSOR_ID = '__svp-cursor';
export const BEACON_ID = '__svp-beacon';
export const BEACON_PX = 6;

export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__svpCursor) return;
  const HOT = { x: 4, y: 2 }; // arrow tip inside the 24px svg box
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
    + '<path d="M4 2 L4 19.5 L8.6 15.4 L11.6 22 L14.4 20.7 L11.5 14.3 L17.5 14.3 Z"'
    + ' fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const state = { x: (window.innerWidth || 1920) / 2, y: (window.innerHeight || 1080) / 2, el: null };

  let ensure = function () {
    if (state.el && state.el.isConnected) return state.el;
    if (!document.body) return null;
    let el = document.getElementById('${CURSOR_ID}');
    if (!el) {
      el = document.createElement('div');
      el.id = '${CURSOR_ID}';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;pointer-events:none;'
        + 'z-index:2147483647;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));will-change:transform;';
      el.innerHTML = SVG;
      document.body.appendChild(el);
    }
    state.el = el;
    place();
    return el;
  };
  function place() {
    if (state.el) state.el.style.transform = 'translate(' + (state.x - HOT.x) + 'px,' + (state.y - HOT.y) + 'px)';
  }
  const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  // --- shared throttled animation loop (paints on ticks 0,2 of every 5 => 2,3,2,3 vsyncs) ---
  const anims = new Set();
  let loopRunning = false, tick = 0;
  function loop(now) {
    tick++;
    const paint = (tick % 5 === 0) || (tick % 5 === 2);
    if (paint) {
      for (const a of Array.from(anims)) {
        const p = Math.min(1, (now - a.t0) / a.ms);
        a.render(p);
        if (p >= 1) { anims.delete(a); a.done(); }
      }
    }
    if (anims.size) requestAnimationFrame(loop); else loopRunning = false;
  }
  function animate(ms, render) {
    return new Promise(done => {
      const a = { t0: performance.now(), ms, render, done };
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

  function click() {
    ensure();
    if (!document.body) return Promise.resolve();
    const cx = state.x, cy = state.y;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;border-radius:50%;'
      + 'border:3px solid rgba(59,130,246,.9);box-sizing:border-box;pointer-events:none;'
      + 'z-index:2147483646;transform:translate(' + (cx - 22) + 'px,' + (cy - 22) + 'px) scale(0.2);opacity:1;';
    document.body.appendChild(ring);
    return animate(300, p => {
      ring.style.transform = 'translate(' + (cx - 22) + 'px,' + (cy - 22) + 'px) scale(' + (0.2 + 0.8 * p) + ')';
      ring.style.opacity = String(1 - p);
    }).then(() => ring.remove());
  }

  // --- sync beacon: 6x6 px square in the bottom-left corner. Colour changes at every
  // step start (0 = grey, odd = black, even = white); the recorder scans it in raw.webm
  // afterwards to map wall-clock step starts onto true video time. ---
  let beaconK = 0;
  function beacon(k) {
    beaconK = k;
    if (!document.body) return;
    let b = document.getElementById('${BEACON_ID}');
    if (!b) {
      b = document.createElement('div');
      b.id = '${BEACON_ID}';
      b.setAttribute('aria-hidden', 'true');
      b.style.cssText = 'position:fixed;left:0;bottom:0;width:${BEACON_PX}px;height:${BEACON_PX}px;pointer-events:none;z-index:2147483647;';
      document.body.appendChild(b);
    }
    b.style.background = k === 0 ? '#808080' : (k % 2 ? '#000' : '#fff');
  }
  const ensure0 = ensure;
  ensure = function () { const r = ensure0(); if (r) beacon(beaconK); return r; };

  window.__svpCursor = { moveTo, click, ensure, beacon, pos: () => ({ x: state.x, y: state.y }) };
  if (document.body) ensure();
  else document.addEventListener('DOMContentLoaded', ensure, { once: true });
})();
`;

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
