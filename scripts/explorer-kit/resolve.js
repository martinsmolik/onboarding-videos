// In-page selector resolver mirroring the Playwright subset allowed in recipes.
// Allowed forms:  1) plain CSS            e.g.  a[href="/app/my-profile/absence-overview"]
//                 2) CSS:text-is("Exact") e.g.  button:text-is("Request absence")
// :text-is = the element's WHOLE textContent, whitespace-normalised (recorder translates it to
// locator(css).filter({ hasText: /^\s*Exact\s*$/ }) – NOT Playwright's native deepest-element :text-is).
// textContent ignores CSS text-transform, so never match on uppercased labels.
// Usage (inside page): __svpResolve(sel) -> { count, visible, rect }
window.__svpResolve = function (sel) {
  const m = sel.match(/^(.*):text-is\("((?:[^"\\]|\\.)*)"\)$/);
  const css = m ? (m[1] || '*') : sel;
  const text = m ? m[2].replace(/\\"/g, '"') : null;
  let els = [...document.querySelectorAll(css)];
  if (text !== null) els = els.filter(e => (e.textContent || '').trim().replace(/\s+/g, ' ') === text);
  const vis = els.filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
  const r = vis[0]?.getBoundingClientRect();
  return { count: els.length, visible: vis.length, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null };
};
