// In-page collector, kept as a plain JS string so tsx/esbuild never rewrites it
// (esbuild's __name helpers break functions passed to page.evaluate).
//
// Returns a list of candidate elements with *candidate* selectors in policy order.
// The Node side (snapshot.ts) then proves each candidate with locator.count()===1
// AND that the single match is the very same element (expando __svpRef).

export const COLLECT_SCRIPT = String.raw`(opts) => {
  const gen = opts.gen;
  const max = opts.max || 150;
  const mode = opts.mode || 'snapshot';
  const vw = window.innerWidth, vh = window.innerHeight;
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  const INTERACTIVE_ROLES = new Set(['button','link','checkbox','radio','switch','tab','menuitem','menuitemcheckbox','menuitemradio','option','combobox','textbox','searchbox','listbox','slider','spinbutton','treeitem','gridcell']);
  const INFO_ROLES = new Set(['dialog','alertdialog','alert','status','tabpanel','heading','navigation','menu','tablist']);
  const SELECTABLE_ROLES = new Set(['button','link','checkbox','radio','switch','tab','menuitem','menuitemcheckbox','menuitemradio','option','combobox','textbox','searchbox','listbox','slider','spinbutton','treeitem','heading','dialog','alertdialog','img','cell','columnheader','row']);
  const NAME_FROM_CONTENT = new Set(['button','link','tab','menuitem','menuitemcheckbox','menuitemradio','option','heading','cell','columnheader','row','treeitem','switch','checkbox','radio','gridcell']);

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const q = (s) => JSON.stringify(s);

  function implicitRole(el) {
    const r = el.getAttribute('role');
    if (r) return r.split(' ')[0];
    const t = el.tagName;
    if (t === 'A') return el.hasAttribute('href') ? 'link' : null;
    if (t === 'BUTTON') return 'button';
    if (t === 'SUMMARY') return 'button';
    if (t === 'SELECT') return (el.multiple || el.size > 1) ? 'listbox' : 'combobox';
    if (t === 'TEXTAREA') return 'textbox';
    if (t === 'INPUT') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button','submit','reset','image'].includes(ty)) return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'range') return 'slider';
      if (ty === 'number') return 'spinbutton';
      if (ty === 'search') return 'searchbox';
      if (['text','email','tel','url',''].includes(ty)) return el.hasAttribute('list') ? 'combobox' : 'textbox';
      return null;
    }
    if (/^H[1-6]$/.test(t)) return 'heading';
    if (t === 'DIALOG') return 'dialog';
    if (t === 'NAV') return 'navigation';
    if (t === 'IMG') return el.getAttribute('alt') ? 'img' : null;
    if (t === 'TD') return 'cell';
    if (t === 'TH') return 'columnheader';
    if (t === 'TR') return 'row';
    if (t === 'LI') return 'listitem';
    return null;
  }

  function labelText(el) {
    const al = el.getAttribute('aria-label');
    if (al && norm(al)) return norm(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const s = lb.split(/\s+/).map(id => { const e = document.getElementById(id); return e ? e.textContent : ''; }).join(' ');
      if (norm(s)) return norm(s);
    }
    if (el.id) {
      try {
        const l = document.querySelector('label[for=' + CSS.escape(el.id) + ']');
        if (l && norm(l.textContent)) return norm(l.textContent);
      } catch (e) {}
    }
    const wrap = el.closest('label');
    if (wrap && norm(wrap.textContent)) return norm(wrap.textContent);
    return '';
  }

  function accName(el, role) {
    const l = labelText(el);
    if (l) return l;
    if (role && NAME_FROM_CONTENT.has(role)) {
      const tc = norm(el.textContent);
      if (tc) return tc;
    }
    if (el.tagName === 'INPUT' && ['button','submit','reset'].includes((el.type||'').toLowerCase()) && el.value) return norm(el.value);
    if (el.tagName === 'IMG') return norm(el.getAttribute('alt'));
    const ph = el.getAttribute('placeholder');
    if (ph && (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton')) return norm(ph);
    const ti = el.getAttribute('title');
    if (ti) return norm(ti);
    return '';
  }

  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
    return norm(s);
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  }

  function testAttr(el) {
    for (const a of TEST_ATTRS) { const v = el.getAttribute(a); if (v) return { attr: a, value: v }; }
    return null;
  }
  function testSel(t) {
    return /^[A-Za-z0-9_-]+$/.test(t.value) ? '[' + t.attr + '=' + t.value + ']' : '[' + t.attr + '=' + q(t.value) + ']';
  }

  function looksGenerated(id) {
    return !/^[A-Za-z][A-Za-z_-]*[A-Za-z]$/.test(id) || /^(ember|react|mui|radix|headlessui|mat-|cdk-|ng-)/i.test(id);
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && !looksGenerated(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let i = 1, s = cur;
      while ((s = s.previousElementSibling)) if (s.tagName === cur.tagName) i++;
      parts.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      cur = cur.parentElement;
    }
    return 'css=' + parts.join(' > ');
  }

  function isInteractive(el, role) {
    const t = el.tagName;
    if (t === 'INPUT') return (el.type || '').toLowerCase() !== 'hidden';
    if (['A','BUTTON','SELECT','TEXTAREA','SUMMARY'].includes(t)) return true;
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return true;
    if (el.hasAttribute('onclick')) return true;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) >= 0) return true;
    const cs = getComputedStyle(el);
    if (cs.cursor === 'pointer' && el.parentElement && getComputedStyle(el.parentElement).cursor !== 'pointer') return true;
    return false;
  }

  function candidates(el, role, name) {
    const c = [];
    const t = testAttr(el);
    if (t) c.push({ sel: testSel(t), tier: 1 });
    const roleSel = (role && SELECTABLE_ROLES.has(role) && name && name.length <= 80) ? 'role=' + role + '[name=' + q(name) + 's]' : null;
    if (roleSel) c.push({ sel: roleSel, tier: 2 });
    const txt = ownText(el) || (['A','BUTTON','LABEL','LI','TD','TH','SPAN'].includes(el.tagName) ? norm(el.textContent) : '');
    const textSel = (txt && txt.length <= 80) ? 'text=' + q(txt) : null;
    if (textSel) c.push({ sel: textSel, tier: 3 });
    // scoped by nearest ancestor with a test attribute
    let anc = el.parentElement;
    while (anc && !testAttr(anc)) anc = anc.parentElement;
    if (anc) {
      const a = testSel(testAttr(anc));
      if (roleSel) c.push({ sel: a + ' >> ' + roleSel, tier: 4 });
      if (textSel) c.push({ sel: a + ' >> ' + textSel, tier: 4 });
      if (!roleSel && !textSel && el.tagName !== 'DIV' && el.tagName !== 'SPAN') c.push({ sel: a + ' >> ' + el.tagName.toLowerCase(), tier: 4 });
    }
    c.push({ sel: cssPath(el), tier: 9 });
    return c;
  }

  const all = mode === 'marked'
    ? Array.from(document.querySelectorAll('*')).filter(e => e.__svpMark)
    : Array.from(document.querySelectorAll('body *'));
  const picked = [];
  let idx = 0;
  for (const el of all) {
    idx++;
    const t = el.tagName;
    if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','OPTION','BR','SVG','PATH','HTML','HEAD'].includes(t)) continue;
    const vis = visible(el);
    if (mode !== 'marked' && !vis) continue;
    const role = implicitRole(el);
    let prio;
    if (mode === 'marked') prio = 0;
    else if (isInteractive(el, role)) prio = 0;
    else if (testAttr(el) || (role && INFO_ROLES.has(role)) || t === 'LABEL') prio = 1;
    else if (ownText(el) && !el.closest('a,button,label,[role=button],[role=link],select')) prio = 2;
    else continue;
    const inv = inViewport(el);
    if (mode !== 'marked' && !inv) prio += 3;
    picked.push({ el, role, prio, idx, inv, vis });
  }
  const total = picked.length;
  const kept = mode === 'marked' ? picked : picked.slice().sort((a, b) => a.prio - b.prio || a.idx - b.idx).slice(0, max).sort((a, b) => a.idx - b.idx);
  const out = [];
  let n = 0;
  for (const p of kept) {
    n++;
    const el = p.el;
    el.__svpRef = gen + ':' + n;
    const name = accName(el, p.role);
    const t = testAttr(el);
    const item = {
      ref: n,
      key: gen + ':' + n,
      tag: el.tagName.toLowerCase(),
      role: p.role,
      name: name.slice(0, 80),
      text: (name || (el.tagName === 'SELECT' ? '' : (ownText(el) || norm(el.textContent)))).slice(0, 60),
      testid: t ? t.value : null,
      inViewport: p.inv,
      visible: p.vis,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      candidates: candidates(el, p.role, name),
    };
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      item.value = el.value;
      item.placeholder = el.getAttribute('placeholder') || undefined;
      if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked;
    }
    if (el.tagName === 'SELECT') {
      item.value = el.selectedOptions[0] ? norm(el.selectedOptions[0].textContent) : '';
      item.options = Array.from(el.options).slice(0, 12).map(o => norm(o.textContent));
    }
    out.push(item);
  }
  if (mode === 'marked') for (const e of all) delete e.__svpMark;
  return { url: location.href, title: document.title, total, items: out };
}`;
