// UltraBoard Pro: Повна версія (Живі імпульси, Pie Menu, Блоки коду, Інтерактивні чеклісти, URL-шаринг)
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const root = document.documentElement, board = $('.board-container'), ta = $('#text-editor'), badge = $('#size-badge'), pie = $('#pie-menu');
const cs = $('#canvas-static'), cl = $('#canvas-live'), mm = $('#minimap');
const sc = cs.getContext('2d'), lc = cl.getContext('2d'), mc = mm.getContext('2d');

const ZMIN = 0.08, ZMAX = 10;
const FONTS = {
  sans: s => `${s}px "Inter", system-ui, sans-serif`,
  hand: s => `${s}px "Comic Sans MS", "Chalkboard SE", cursive`,
  mono: s => `${s}px ui-monospace, "SFMono-Regular", Menlo, monospace`,
};

const TYPE_NAMES = {
  pen: 'Олівець', line: 'Лінія', arrow: 'Стрілка', rect: 'Прямокутник',
  ellipse: 'Еліпс', diamond: 'Ромб', cloud: 'Хмарка', bubble: 'Виноска',
  star: 'Зірка', sticky: 'Стікер', code: 'Блок коду', todo: 'Чекліст',
  text: 'Текст', frame: 'Фрейм', image: 'Зображення', multi: 'Група об\'єктів'
};

const CAPABILITIES = {
  pen:     ['stroke', 'width', 'dash', 'opacity', 'shadow'],
  line:    ['stroke', 'arrow', 'width', 'dash', 'rough', 'opacity'],
  arrow:   ['stroke', 'arrow', 'width', 'dash', 'rough', 'opacity'],
  rect:    ['stroke', 'fill', 'fillStyle', 'rough', 'width', 'dash', 'radius', 'opacity', 'shadow'],
  bubble:  ['stroke', 'fill', 'fillStyle', 'width', 'dash', 'radius', 'opacity', 'shadow'],
  ellipse: ['stroke', 'fill', 'fillStyle', 'width', 'dash', 'opacity', 'shadow'],
  diamond: ['stroke', 'fill', 'fillStyle', 'width', 'dash', 'opacity', 'shadow'],
  cloud:   ['stroke', 'fill', 'fillStyle', 'width', 'dash', 'opacity', 'shadow'],
  star:    ['stroke', 'fill', 'fillStyle', 'width', 'dash', 'opacity', 'shadow'],
  sticky:  ['fill', 'radius', 'font', 'opacity'],
  code:    ['radius', 'opacity', 'shadow'],
  todo:    ['stroke', 'fill', 'radius', 'font', 'opacity', 'shadow'],
  text:    ['stroke', 'width', 'font', 'opacity', 'shadow'],
  frame:   ['stroke', 'fill', 'radius', 'opacity'],
  image:   ['radius', 'opacity', 'shadow'],
  multi:   ['stroke', 'fill', 'width', 'opacity']
};

let els = [], sel = [], tool = 'select', draft = null, drag = null, space = false;
let W = 0, H = 0, dpr = 1, editing = null, snapTarget = null, pieWorld = [0, 0];
let laserPts = [], laserRaf = 0, flowRaf = 0;
let xrayMode = false, xrayFrames = 0, secretBuf = '';

let userName = localStorage.getItem('ub-user') || 'Учасник #' + Math.floor(100 + Math.random() * 900);
let boardsMeta = JSON.parse(localStorage.getItem('ub-boards') || '[{"id":"default","name":"Головна дошка","updated":0}]');
let currentBoardId = new URLSearchParams(location.search).get('room') || boardsMeta[0].id;
let roomBlobId = new URLSearchParams(location.search).get('cloud') || null;
const remoteCursors = new Map();
const myClientId = Math.random().toString(36).slice(2, 8);
const myCursorColor = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#7950f2'][Math.floor(Math.random() * 5)];

const cam = { x: 0, y: 0, z: 1 };
const cfg = { theme: 'light', accent: '#4f46e5', gridType: 'dots', gridSize: 20, snap: false, glass: 86, radius: 14, dock: 'top', minimap: true };
const style = {
  stroke: '#1e1e1e', fill: null, fillStyle: 'solid', width: 2, dash: 'solid',
  rough: 0, radius: 6, opacity: 1, font: 'sans', shadow: false,
  curve: 'curved', headStart: 'none', headEnd: 'arrow', flow: false
};
const ptrs = new Map(), imgCache = new Map(), patternCache = new Map();

// ---------- Динамічна панель властивостей ----------
function updateContextPanel() {
  const panel = $('#props-panel');
  const activeType = sel.length > 1 ? 'multi' : sel.length === 1 ? sel[0].type : (CAPABILITIES[tool] ? tool : null);
  if (!activeType) { panel.hidden = true; return; }
  panel.hidden = false;
  $('#context-badge').textContent = TYPE_NAMES[activeType] || 'Елемент';
  $('#lbl-stroke').textContent = activeType === 'text' ? 'Колір тексту' : activeType === 'frame' ? 'Колір рамки' : 'Контур / Лінія';
  $('#lbl-fill').textContent = activeType === 'sticky' ? 'Колір стікера' : activeType === 'frame' ? 'Фон фрейма' : 'Заливка';
  $('#lbl-width').textContent = activeType === 'text' ? 'Розмір тексту' : 'Товщина';

  const allowed = CAPABILITIES[activeType] || [];
  $$('#props-panel [data-cap]').forEach(sec => { sec.hidden = !allowed.includes(sec.dataset.cap); });
  $('#selection-actions').hidden = sel.length === 0;
  $('#align-bar').hidden = sel.length < 2;
  $('#btn-lock').textContent = sel.some(e => e.locked) ? 'Розблок.' : 'Блок';
}

// ---------- Рендеринг за запитом + Анімація імпульсів ----------
let raf = 0, dirtyS = false, dirtyL = false;
function inval(s = true, l = true) {
  dirtyS ||= s; dirtyL ||= l;
  raf ||= requestAnimationFrame(() => {
    const t0 = xrayMode ? performance.now() : 0;
    raf = 0;
    let culled = 0;
    if (dirtyS) { culled = paintStatic(); paintMinimap(); dirtyS = false; }
    if (dirtyL) { paintLive(); dirtyL = false; }
    if (xrayMode) {
      xrayFrames++;
      $('#xr-ms').textContent = (performance.now() - t0).toFixed(2) + ' ms';
      $('#xr-frames').textContent = xrayFrames;
      $('#xr-els').textContent = `${els.length} / ${els.length - culled}`;
    }
  });
  checkFlowLoop();
}

function checkFlowLoop() {
  const hasFlow = els.some(e => e.flow && !e._hide);
  if (hasFlow && !flowRaf) {
    const tick = () => {
      if (!els.some(e => e.flow && !e._hide)) { flowRaf = 0; return; }
      paintLive();
      flowRaf = requestAnimationFrame(tick);
    };
    flowRaf = requestAnimationFrame(tick);
  }
}

function resize() {
  dpr = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  for (const c of [cs, cl]) { c.width = W * dpr; c.height = H * dpr; }
  inval();
}
const setCam = g => g.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
const toW = (sx, sy) => [(sx - cam.x) / cam.z, (sy - cam.y) / cam.z];
const snapV = v => (cfg.snap ? Math.round(v / cfg.gridSize) * cfg.gridSize : v);
const ink = c => (c === '#1e1e1e' && ['dark', 'midnight', 'blueprint'].includes(cfg.theme) ? '#f1f5f9' : c);

// ---------- Геометрія кривих Безьє ----------
function getBendControl(e) {
  const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
  if (e.cx === undefined) return [mx, my];
  return [2 * e.cx - mx, 2 * e.cy - my];
}

function quadPt(e, t) {
  const [cpx, cpy] = getBendControl(e), mt = 1 - t;
  return [mt * mt * e.x1 + 2 * mt * t * cpx + t * t * e.x2, mt * mt * e.y1 + 2 * mt * t * cpy + t * t * e.y2];
}

function rawBBox(e) {
  if (e._b) return e._b;
  let b;
  if (e.pts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of e.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    b = { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) };
  } else if (e.type === 'text') {
    sc.font = (FONTS[e.font] || FONTS.sans)(e.size);
    const ls = (e.text || ' ').split('\n');
    b = { x: e.x, y: e.y, w: Math.max(24, ...ls.map(l => sc.measureText(l).width)), h: ls.length * e.size * 1.35 };
  } else if (e.type === 'line' || e.type === 'arrow') {
    const xs = [e.x1, e.x2], ys = [e.y1, e.y2];
    if (e.cx !== undefined) { xs.push(e.cx); ys.push(e.cy); }
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    b = { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) };
  } else {
    b = { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
  }
  return (e._b = b);
}

function bbox(e) {
  const b = rawBBox(e);
  if (!e.rot) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, cos = Math.abs(Math.cos(e.rot)), sin = Math.abs(Math.sin(e.rot));
  const nw = b.w * cos + b.h * sin, nh = b.w * sin + b.h * cos;
  return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
}

function groupBBox(items) {
  if (!items.length) return null;
  if (items.length === 1 && items[0].rot) return rawBBox(items[0]);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const e of items) {
    const b = bbox(e);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function mapEl(e, f) {
  if (e.pts) e.pts = e.pts.map(([x, y]) => f(x, y));
  else if (e.type === 'text') [e.x, e.y] = f(e.x, e.y);
  else { [e.x1, e.y1] = f(e.x1, e.y1); [e.x2, e.y2] = f(e.x2, e.y2); if (e.cx !== undefined) [e.cx, e.cy] = f(e.cx, e.cy); }
  delete e._b;
}

function rotatePt(px, py, cx, cy, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function hit(e, x, y, tol) {
  const b = rawBBox(e), t = tol + (e.width || 2) / 2;
  if (e.rot) [x, y] = rotatePt(x, y, b.x + b.w / 2, b.y + b.h / 2, -e.rot);
  if (x < b.x - t || x > b.x + b.w + t || y < b.y - t || y > b.y + b.h + t) return false;
  if (e.type === 'frame') return y <= b.y + 28 || Math.abs(x - b.x) <= t || Math.abs(x - (b.x + b.w)) <= t || Math.abs(y - (b.y + b.h)) <= t;
  if (e.pts) {
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i], q = e.pts[i + 1] || p;
      if (distSeg(x, y, p[0], p[1], q[0], q[1]) <= t) return true;
    }
    return false;
  }
  if (e.type === 'line' || e.type === 'arrow') {
    if (e.curve === 'elbow') {
      const mx = e.cx ?? (e.x1 + e.x2) / 2;
      return distSeg(x, y, e.x1, e.y1, mx, e.y1) <= t || distSeg(x, y, mx, e.y1, mx, e.y2) <= t || distSeg(x, y, mx, e.y2, e.x2, e.y2) <= t;
    }
    let prev = [e.x1, e.y1];
    for (let i = 1; i <= 12; i++) {
      const curr = quadPt(e, i / 12);
      if (distSeg(x, y, prev[0], prev[1], curr[0], curr[1]) <= t) return true;
      prev = curr;
    }
    return false;
  }
  if (['text', 'sticky', 'code', 'todo', 'image', 'cloud', 'bubble', 'star'].includes(e.type)) return true;
  const rx = b.w / 2 || 1, ry = b.h / 2 || 1, dx = (x - b.x - rx) / rx, dy = (y - b.y - ry) / ry;
  const d = e.type === 'ellipse' ? Math.hypot(dx, dy) : e.type === 'diamond' ? Math.abs(dx) + Math.abs(dy) : Math.max(Math.abs(dx), Math.abs(dy));
  const k = t / Math.min(rx, ry);
  return e.fill ? d <= 1 + k : Math.abs(d - 1) <= k;
}

const pick = (x, y) => { for (let i = els.length - 1; i >= 0; i--) if (hit(els[i], x, y, 6 / cam.z)) return els[i]; return null; };

// ---------- Магнітні порти ----------
function getAnchors(e) {
  if (['line', 'arrow', 'pen', 'text', 'frame'].includes(e.type)) return [];
  const b = rawBBox(e), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const pts = [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]];
  return e.rot ? pts.map(([px, py]) => rotatePt(px, py, cx, cy, e.rot)) : pts;
}

function findSnapAnchor(wx, wy, ignoreId) {
  const rad = 16 / cam.z;
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.id === ignoreId) continue;
    const anchors = getAnchors(e);
    for (let idx = 0; idx < anchors.length; idx++) {
      const [ax, ay] = anchors[idx];
      if (Math.hypot(wx - ax, wy - ay) <= rad) return { elId: e.id, idx, x: ax, y: ay };
    }
  }
  return null;
}

function updateBindings() {
  for (const e of els) {
    if (e.type !== 'line' && e.type !== 'arrow') continue;
    const oldX1 = e.x1, oldY1 = e.y1, oldX2 = e.x2, oldY2 = e.y2;
    if (e.startBind) {
      const target = els.find(t => t.id === e.startBind.elId);
      const pts = target && getAnchors(target);
      if (pts?.[e.startBind.idx]) { [e.x1, e.y1] = pts[e.startBind.idx]; delete e._b; }
    }
    if (e.endBind) {
      const target = els.find(t => t.id === e.endBind.elId);
      const pts = target && getAnchors(target);
      if (pts?.[e.endBind.idx]) { [e.x2, e.y2] = pts[e.endBind.idx]; delete e._b; }
    }
    if (e.cx !== undefined && (oldX1 !== e.x1 || oldY1 !== e.y1 || oldX2 !== e.x2 || oldY2 !== e.y2)) {
      e.cx += ((e.x1 - oldX1) + (e.x2 - oldX2)) / 2;
      e.cy += ((e.y1 - oldY1) + (e.y2 - oldY2)) / 2;
    }
  }
}

// ---------- Pattern-штрихування та Рендеринг ----------
function getHatchPattern(g, color, type, lw) {
  const key = `${color}|${type}|${lw}`;
  if (patternCache.has(key)) return patternCache.get(key);
  const size = 12, pCanvas = document.createElement('canvas');
  pCanvas.width = size; pCanvas.height = size;
  const pCtx = pCanvas.getContext('2d');
  pCtx.strokeStyle = color; pCtx.lineWidth = Math.max(1.2, lw * 0.75);
  pCtx.beginPath(); pCtx.moveTo(-2, size + 2); pCtx.lineTo(size + 2, -2);
  if (type === 'cross') { pCtx.moveTo(-2, -2); pCtx.lineTo(size + 2, size + 2); }
  pCtx.stroke();
  const pat = g.createPattern(pCanvas, 'repeat');
  patternCache.set(key, pat);
  return pat;
}

function jitter(seed, i) {
  const x = Math.sin(seed * 99.1 + i * 37.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2.6;
}
function sketchLine(g, x1, y1, x2, y2, seed) {
  const mx = (x1 + x2) / 2 + jitter(seed, 1), my = (y1 + y2) / 2 + jitter(seed, 2);
  g.moveTo(x1 + jitter(seed, 3) * 0.4, y1 + jitter(seed, 4) * 0.4);
  g.quadraticCurveTo(mx, my, x2 + jitter(seed, 5) * 0.4, y2 + jitter(seed, 6) * 0.4);
}
function fillShape(g, e) {
  if (!e.fill) return;
  g.fillStyle = (!e.fillStyle || e.fillStyle === 'solid') ? e.fill : getHatchPattern(g, e.fill, e.fillStyle, e.width || 2);
  g.fill();
}

function drawArrowHead(g, x, y, ang, type, lw, color) {
  if (!type || type === 'none') return;
  const s = 10 + lw * 2;
  g.save(); g.setLineDash([]); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'miter';
  g.translate(x, y); g.rotate(ang); g.beginPath();
  if (type === 'arrow') { g.moveTo(-s, -s * 0.48); g.lineTo(0, 0); g.lineTo(-s, s * 0.48); g.stroke(); }
  else if (type === 'triangle') { g.moveTo(-s * 1.15, -s * 0.5); g.lineTo(0, 0); g.lineTo(-s * 1.15, s * 0.5); g.closePath(); g.fill(); }
  else if (type === 'dot') { g.arc(-s * 0.35, 0, s * 0.38, 0, Math.PI * 2); g.fill(); }
  else if (type === 'diamond') { g.moveTo(0, 0); g.lineTo(-s * 0.65, -s * 0.4); g.lineTo(-s * 1.3, 0); g.lineTo(-s * 0.65, s * 0.4); g.closePath(); g.fill(); }
  else if (type === 'bar') { g.moveTo(-2, -s * 0.55); g.lineTo(-2, s * 0.55); g.stroke(); }
  g.restore();
}

function wrapText(g, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) { out.push(line); line = w; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawEl(g, e) {
  g.save();
  g.globalAlpha = e.opacity ?? 1;
  const lw = e.width || 2, color = ink(e.stroke);
  g.lineWidth = lw; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = color;
  g.setLineDash(e.dash === 'dashed' ? [lw * 4, lw * 3] : e.dash === 'dotted' ? [0.1, lw * 2.5] : []);
  if (e.shadow) { g.shadowColor = 'rgba(0,0,0,0.22)'; g.shadowBlur = 14; g.shadowOffsetY = 6; }

  const b = rawBBox(e);
  if (e.rot) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    g.translate(cx, cy); g.rotate(e.rot); g.translate(-cx, -cy);
  }

  if (e.pts) {
    const p = e.pts; g.beginPath(); g.moveTo(p[0][0], p[0][1]);
    if (p.length < 3) p.forEach(q => g.lineTo(q[0], q[1]));
    else {
      for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      g.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    }
    g.stroke();
  } else if (e.type === 'text') {
    g.font = (FONTS[e.font] || FONTS.sans)(e.size); g.fillStyle = color; g.textBaseline = 'top';
    e.text.split('\n').forEach((l, i) => g.fillText(l, e.x, e.y + i * e.size * 1.35));
  } else if (e.type === 'frame') {
    const { x, y, w, h } = b;
    g.fillStyle = e.fill || 'rgba(128,128,128,0.04)';
    g.beginPath(); g.roundRect(x, y, w, h, e.radius ?? 8); g.fill();
    g.setLineDash([6, 4]); g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
    g.setLineDash([]); g.fillStyle = color; g.font = '600 13px "Inter", sans-serif'; g.textBaseline = 'bottom';
    g.fillText(e.title || 'Фрейм', x + 4, y - 6);
  } else if (e.type === 'sticky') {
    const { x, y, w, h } = b;
    g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 14; g.shadowOffsetY = 6;
    g.fillStyle = e.fill || '#fef08a';
    g.beginPath(); g.roundRect(x, y, w, h, e.radius ?? 8); g.fill();
    g.shadowColor = 'transparent';
    if (e.text) {
      const fs = Math.max(12, Math.min(24, Math.min(w, h) * 0.11));
      g.font = (FONTS[e.font] || FONTS.sans)(fs); g.fillStyle = '#1e293b'; g.textBaseline = 'top';
      wrapText(g, e.text, w - 24).forEach((l, i) => { if (y + 14 + i * fs * 1.3 < y + h - 10) g.fillText(l, x + 12, y + 14 + i * fs * 1.3); });
    }
  } else if (e.type === 'code') {
    const { x, y, w, h } = b, r = e.radius ?? 10;
    g.shadowColor = 'rgba(0,0,0,0.28)'; g.shadowBlur = 18; g.shadowOffsetY = 8;
    g.fillStyle = '#0f172a';
    g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#334155'; g.lineWidth = 1; g.stroke();

    g.fillStyle = '#1e293b';
    g.beginPath(); g.roundRect(x, y, w, 28, [r, r, 0, 0]); g.fill();
    ['#ef4444', '#f59e0b', '#10b981'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(x + 14 + i * 14, y + 14, 4.5, 0, Math.PI * 2); g.fill(); });

    g.fillStyle = '#94a3b8'; g.font = '600 10px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(e._copied ? '✓ Скопійовано' : 'Copy', x + w - 10, y + 14);
    g.textAlign = 'left';

    g.save(); g.beginPath(); g.rect(x + 8, y + 32, w - 16, h - 38); g.clip();
    g.font = '13px ui-monospace, "SFMono-Regular", Menlo, monospace'; g.textBaseline = 'top';
    const lines = (e.text || '// Двічі клікніть, щоб ввести код').split('\n');
    const kw = /^(const|let|var|function|return|if|else|for|while|async|await|import|export|class)$/;
    lines.forEach((line, li) => {
      let cx = x + 12, cy = y + 36 + li * 19;
      if (line.trim().startsWith('//')) { g.fillStyle = '#64748b'; g.fillText(line, cx, cy); return; }
      for (const tok of line.split(/(\s+|[(){}[\].,;:=+\-*/"'`])/)) {
        if (!tok) continue;
        if (kw.test(tok)) g.fillStyle = '#c084fc';
        else if (/^["'`].*["'`]$/.test(tok)) g.fillStyle = '#4ade80';
        else if (/^\d+$/.test(tok)) g.fillStyle = '#fb923c';
        else g.fillStyle = '#e2e8f0';
        g.fillText(tok, cx, cy);
        cx += g.measureText(tok).width;
      }
    });
    g.restore();
  } else if (e.type === 'todo') {
    const { x, y, w, h } = b, r = e.radius ?? 10;
    g.shadowColor = 'rgba(0,0,0,0.12)'; g.shadowBlur = 14; g.shadowOffsetY = 5;
    g.fillStyle = e.fill || (['dark', 'midnight', 'blueprint'].includes(cfg.theme) ? '#1e293b' : '#ffffff');
    g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();

    const items = (e.text || 'Завдання 1\nЗавдання 2\nЗавдання 3').split('\n');
    const done = e.done || [];
    g.save(); g.beginPath(); g.rect(x + 10, y + 10, w - 20, h - 20); g.clip();
    g.font = (FONTS[e.font] || FONTS.sans)(14); g.textBaseline = 'middle';
    items.forEach((item, idx) => {
      const iy = y + 24 + idx * 28;
      if (iy > y + h - 12) return;
      const isDone = !!done[idx];
      g.strokeStyle = isDone ? cfg.accent : color; g.lineWidth = 1.8;
      g.beginPath(); g.roundRect(x + 14, iy - 8, 16, 16, 4);
      if (isDone) { g.fillStyle = cfg.accent; g.fill(); }
      g.stroke();
      if (isDone) {
        g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x + 17, iy); g.lineTo(x + 21, iy + 4); g.lineTo(x + 27, iy - 4); g.stroke();
      }
      g.fillStyle = isDone ? '#94a3b8' : color;
      g.fillText(item, x + 38, iy);
      if (isDone) {
        const tw = g.measureText(item).width;
        g.strokeStyle = '#94a3b8'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x + 38, iy); g.lineTo(x + 38 + tw, iy); g.stroke();
      }
    });
    g.restore();
  } else if (e.type === 'image') {
    const { x, y, w, h } = b;
    let img = imgCache.get(e.src);
    if (!img) { img = new Image(); img.src = e.src; img.onload = () => inval(true, false); imgCache.set(e.src, img); }
    if (img.complete && img.naturalWidth) {
      g.save(); g.beginPath(); g.roundRect(x, y, w, h, e.radius ?? 4); g.clip();
      g.drawImage(img, x, y, w, h); g.restore();
    }
  } else if (e.type === 'line' || e.type === 'arrow') {
    const curve = e.curve || 'curved', [cpx, cpy] = getBendControl(e);
    const hStart = e.headStart ?? 'none', hEnd = e.headEnd ?? (e.type === 'arrow' ? 'arrow' : 'none');
    let angStart, angEnd;
    if (curve === 'elbow') {
      const mx = e.cx ?? (e.x1 + e.x2) / 2;
      angStart = Math.atan2(0, e.x1 - mx); angEnd = Math.atan2(0, e.x2 - mx);
    } else if (curve === 'straight' || e.cx === undefined) {
      angStart = Math.atan2(e.y1 - e.y2, e.x1 - e.x2); angEnd = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
    } else {
      angStart = Math.atan2(e.y1 - cpy, e.x1 - cpx); angEnd = Math.atan2(e.y2 - cpy, e.x2 - cpx);
    }
    const s = 10 + lw * 2;
    const trimStart = ['triangle', 'diamond'].includes(hStart) ? s * 0.7 : 0;
    const trimEnd = ['triangle', 'diamond'].includes(hEnd) ? s * 0.7 : 0;
    const sx1 = e.x1 - Math.cos(angStart) * trimStart, sy1 = e.y1 - Math.sin(angStart) * trimStart;
    const sx2 = e.x2 - Math.cos(angEnd) * trimEnd, sy2 = e.y2 - Math.sin(angEnd) * trimEnd;

    g.beginPath();
    if (curve === 'elbow') {
      const mx = e.cx ?? (e.x1 + e.x2) / 2;
      g.moveTo(sx1, sy1); g.lineTo(mx, sy1); g.lineTo(mx, sy2); g.lineTo(sx2, sy2);
    } else if (curve === 'straight' || e.cx === undefined) {
      if (e.rough) { sketchLine(g, sx1, sy1, sx2, sy2, e.seed || 1); sketchLine(g, sx1, sy1, sx2, sy2, (e.seed || 1) + 7); }
      else { g.moveTo(sx1, sy1); g.lineTo(sx2, sy2); }
    } else {
      g.moveTo(sx1, sy1); g.quadraticCurveTo(cpx, cpy, sx2, sy2);
      if (e.rough) { g.moveTo(sx1 + jitter(e.seed, 1), sy1 + jitter(e.seed, 2)); g.quadraticCurveTo(cpx + jitter(e.seed, 3), cpy + jitter(e.seed, 4), sx2, sy2); }
    }
    g.stroke();
    drawArrowHead(g, e.x1, e.y1, angStart, hStart, lw, color);
    drawArrowHead(g, e.x2, e.y2, angEnd, hEnd, lw, color);
  } else {
    const { x, y, w, h } = b;
    g.beginPath();
    if (e.type === 'rect') g.roundRect(x, y, w, h, e.radius ?? 6);
    else if (e.type === 'ellipse') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (e.type === 'diamond') { g.moveTo(x + w / 2, y); g.lineTo(x + w, y + h / 2); g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h / 2); g.closePath(); }
    else if (e.type === 'star') {
      const cx = x + w / 2, cy = y + h / 2;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.42, ang = (i * Math.PI) / 5 - Math.PI / 2;
        const px = cx + (w / 2) * r * Math.cos(ang), py = cy + (h / 2) * r * Math.sin(ang);
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
    } else if (e.type === 'cloud') {
      g.moveTo(x + w * 0.25, y + h * 0.8);
      g.bezierCurveTo(x, y + h * 0.8, x, y + h * 0.45, x + w * 0.22, y + h * 0.42);
      g.bezierCurveTo(x + w * 0.25, y + h * 0.15, x + w * 0.65, y + h * 0.12, x + w * 0.72, y + h * 0.38);
      g.bezierCurveTo(x + w * 0.98, y + h * 0.35, x + w, y + h * 0.8, x + w * 0.78, y + h * 0.8);
      g.closePath();
    } else if (e.type === 'bubble') {
      const r = Math.min(14, w / 4, h / 4), bh = h * 0.8;
      g.roundRect(x, y, w, bh, r);
      g.moveTo(x + w * 0.22, y + bh); g.lineTo(x + w * 0.14, y + h); g.lineTo(x + w * 0.38, y + bh);
    }
    fillShape(g, e);
    g.stroke();
    if (e.rough && e.type === 'rect') {
      g.beginPath(); const s = e.seed || 1;
      sketchLine(g, x, y, x + w, y, s); sketchLine(g, x + w, y, x + w, y + h, s + 1);
      sketchLine(g, x + w, y + h, x, y + h, s + 2); sketchLine(g, x, y + h, x, y, s + 3);
      g.stroke();
    }
  }
  g.restore();
}

function paintStatic() {
  sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, cs.width, cs.height);
  setCam(sc);
  const vx = -cam.x / cam.z, vy = -cam.y / cam.z, vw = W / cam.z, vh = H / cam.z;
  let culled = 0;
  for (const e of els) {
    if (e._hide) continue;
    const b = bbox(e), m = (e.width || 2) + 32;
    if (b.x + b.w + m < vx || b.x - m > vx + vw || b.y + b.h + m < vy || b.y - m > vy + vh) { culled++; continue; }
    drawEl(sc, e);
  }
  return culled;
}

function paintLive() {
  lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, cl.width, cl.height);
  setCam(lc);

  const now = performance.now();
  for (const e of els) {
    if (!e.flow || e._hide || (e.type !== 'line' && e.type !== 'arrow')) continue;
    const t = (now % 1600) / 1600;
    const [px, py] = quadPt(e, t);
    lc.save();
    lc.fillStyle = cfg.accent;
    lc.shadowColor = cfg.accent; lc.shadowBlur = 12;
    lc.beginPath(); lc.arc(px, py, (4 + (e.width || 2)) / cam.z, 0, Math.PI * 2); lc.fill();
    lc.restore();
  }

  if (xrayMode && $('#xr-boxes').checked) {
    lc.save();
    for (const e of els) {
      const b = bbox(e);
      lc.strokeStyle = 'rgba(16, 185, 129, 0.55)'; lc.lineWidth = 1 / cam.z; lc.setLineDash([3 / cam.z, 3 / cam.z]);
      lc.strokeRect(b.x, b.y, b.w, b.h); lc.setLineDash([]);
      for (const [ax, ay] of getAnchors(e)) { lc.fillStyle = '#10b981'; lc.beginPath(); lc.arc(ax, ay, 3 / cam.z, 0, Math.PI * 2); lc.fill(); }
    }
    lc.restore();
  }

  if (draft) drawEl(lc, draft);

  if (snapTarget) {
    lc.save();
    lc.fillStyle = cfg.accent; lc.strokeStyle = '#fff'; lc.lineWidth = 2 / cam.z;
    lc.beginPath(); lc.arc(snapTarget.x, snapTarget.y, 6 / cam.z, 0, Math.PI * 2); lc.fill(); lc.stroke();
    lc.restore();
  }

  if (drag && drag.k === 'marquee') {
    const x = Math.min(drag.x1, drag.x2), y = Math.min(drag.y1, drag.y2), w = Math.abs(drag.x2 - drag.x1), h = Math.abs(drag.y2 - drag.y1);
    lc.save(); lc.fillStyle = 'rgba(79, 70, 229, 0.1)'; lc.strokeStyle = cfg.accent; lc.lineWidth = 1 / cam.z;
    lc.fillRect(x, y, w, h); lc.strokeRect(x, y, w, h); lc.restore();
  }

  const activeSel = sel.filter(e => !e._hide);
  if (activeSel.length) {
    lc.save();
    const single = activeSel.length === 1 ? activeSel[0] : null;
    if (single && (single.type === 'line' || single.type === 'arrow') && !single.locked) {
      const bx = single.cx ?? (single.x1 + single.x2) / 2, by = single.cy ?? (single.y1 + single.y2) / 2, r = 6 / cam.z;
      if (single.cx !== undefined && single.curve !== 'elbow') {
        const [cpx, cpy] = getBendControl(single);
        lc.strokeStyle = 'rgba(128,128,128,0.4)'; lc.lineWidth = 1 / cam.z; lc.setLineDash([4 / cam.z, 4 / cam.z]);
        lc.beginPath(); lc.moveTo(single.x1, single.y1); lc.lineTo(cpx, cpy); lc.lineTo(single.x2, single.y2); lc.stroke(); lc.setLineDash([]);
      }
      for (const [px, py] of [[single.x1, single.y1], [single.x2, single.y2]]) {
        lc.fillStyle = '#ffffff'; lc.strokeStyle = cfg.accent; lc.lineWidth = 2 / cam.z;
        lc.beginPath(); lc.arc(px, py, r, 0, Math.PI * 2); lc.fill(); lc.stroke();
      }
      lc.fillStyle = cfg.accent; lc.strokeStyle = '#ffffff'; lc.lineWidth = 2 / cam.z;
      lc.beginPath(); lc.arc(bx, by, r * 1.15, 0, Math.PI * 2); lc.fill(); lc.stroke();
    } else {
      const b = groupBBox(activeSel), p = 6 / cam.z, hs = 8 / cam.z, singleRot = single ? (single.rot || 0) : 0;
      if (singleRot) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; lc.translate(cx, cy); lc.rotate(singleRot); lc.translate(-cx, -cy); }
      lc.lineWidth = 1.5 / cam.z; lc.strokeStyle = cfg.accent;
      if (activeSel.some(e => e.locked)) lc.setLineDash([4 / cam.z, 4 / cam.z]);
      lc.strokeRect(b.x - p, b.y - p, b.w + 2 * p, b.h + 2 * p); lc.setLineDash([]);
      if (!activeSel.every(e => e.locked)) {
        lc.fillStyle = '#ffffff';
        for (const [cx, cy] of [[b.x - p, b.y - p], [b.x + b.w + p, b.y - p], [b.x + b.w + p, b.y + b.h + p], [b.x - p, b.y + b.h + p]]) {
          lc.fillRect(cx - hs / 2, cy - hs / 2, hs, hs); lc.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
        }
        if (single) {
          const rx = b.x + b.w / 2, ry = b.y - p - 20 / cam.z;
          lc.beginPath(); lc.moveTo(rx, b.y - p); lc.lineTo(rx, ry); lc.stroke();
          lc.beginPath(); lc.arc(rx, ry, 5 / cam.z, 0, Math.PI * 2); lc.fill(); lc.stroke();
        }
      }
    }
    lc.restore();
  }

  for (const [id, c] of remoteCursors) {
    if (now - c.t > 12000) { remoteCursors.delete(id); continue; }
    lc.save();
    lc.translate(c.x, c.y); lc.scale(1 / cam.z, 1 / cam.z);
    lc.fillStyle = c.color;
    lc.beginPath(); lc.moveTo(0, 0); lc.lineTo(14, 6); lc.lineTo(8, 9); lc.lineTo(5, 16); lc.closePath(); lc.fill();
    lc.font = '600 11px sans-serif';
    const tw = lc.measureText(c.name).width + 12;
    lc.beginPath(); lc.roundRect(10, 12, tw, 20, 6); lc.fill();
    lc.fillStyle = '#fff'; lc.fillText(c.name, 16, 26);
    lc.restore();
  }

  if (laserPts.length > 1) {
    lc.save(); lc.lineCap = 'round';
    for (let i = 1; i < laserPts.length; i++) {
      const age = now - laserPts[i].t;
      if (age > 650) continue;
      const alpha = 1 - age / 650;
      lc.strokeStyle = `rgba(239, 68, 68, ${alpha})`; lc.lineWidth = (6 * alpha) / cam.z;
      lc.beginPath(); lc.moveTo(laserPts[i - 1].x, laserPts[i - 1].y); lc.lineTo(laserPts[i].x, laserPts[i].y); lc.stroke();
    }
    lc.restore();
  }
}

// ---------- Міні-карта ----------
function paintMinimap() {
  if (!cfg.minimap) return;
  const mw = mm.width, mh = mm.height;
  mc.clearRect(0, 0, mw, mh);
  if (!els.length) return;
  const all = groupBBox(els);
  const vx = -cam.x / cam.z, vy = -cam.y / cam.z, vw = W / cam.z, vh = H / cam.z;
  const x0 = Math.min(all.x, vx) - 100, y0 = Math.min(all.y, vy) - 100;
  const x1 = Math.max(all.x + all.w, vx + vw) + 100, y1 = Math.max(all.y + all.h, vy + vh) + 100;
  const s = Math.min(mw / (x1 - x0), mh / (y1 - y0));

  mc.save(); mc.scale(s, s); mc.translate(-x0, -y0);
  for (const e of els) {
    const b = bbox(e);
    mc.fillStyle = e.fill || ink(e.stroke); mc.globalAlpha = 0.7;
    mc.fillRect(b.x, b.y, Math.max(4 / s, b.w), Math.max(4 / s, b.h));
  }
  mc.globalAlpha = 1; mc.strokeStyle = cfg.accent; mc.lineWidth = 1.5 / s;
  mc.strokeRect(vx, vy, vw, vh); mc.restore();
}

mm.addEventListener('pointerdown', ev => {
  if (!els.length) return;
  const rect = mm.getBoundingClientRect(), all = groupBBox(els);
  const vx = -cam.x / cam.z, vy = -cam.y / cam.z, vw = W / cam.z, vh = H / cam.z;
  const x0 = Math.min(all.x, vx) - 100, y0 = Math.min(all.y, vy) - 100;
  const x1 = Math.max(all.x + all.w, vx + vw) + 100, y1 = Math.max(all.y + all.h, vy + vh) + 100;
  const s = Math.min(mm.width / (x1 - x0), mm.height / (y1 - y0));
  cam.x = W / 2 - (x0 + (ev.clientX - rect.left) / s) * cam.z;
  cam.y = H / 2 - (y0 + (ev.clientY - rect.top) / s) * cam.z;
  camChanged();
});

// ---------- Камера ----------
function camChanged() {
  $('#zoom-label').textContent = Math.round(cam.z * 100) + '%';
  const g = cfg.gridSize * cam.z;
  board.style.backgroundSize = `${g}px ${g}px`;
  board.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  inval(); save();
}
function zoomAt(sx, sy, f) {
  const z = Math.max(ZMIN, Math.min(ZMAX, cam.z * f)), k = z / cam.z;
  cam.x = sx - (sx - cam.x) * k; cam.y = sy - (sy - cam.y) * k; cam.z = z; camChanged();
}
function fitAll() {
  if (!els.length) { cam.x = 0; cam.y = 0; cam.z = 1; camChanged(); return; }
  const b = groupBBox(els), pad = 80;
  cam.z = Math.max(ZMIN, Math.min(1.5, Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h)));
  cam.x = W / 2 - (b.x + b.w / 2) * cam.z; cam.y = H / 2 - (b.y + b.h / 2) * cam.z;
  camChanged();
}
cl.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey || (Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) >= 40 && !ev.deltaX)) {
    zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
  } else { cam.x -= ev.deltaX; cam.y -= ev.deltaY; camChanged(); }
}, { passive: false });

// ---------- Синхронізація вкладок та Спільне посилання ----------
let hist = [], hi = -1, saveT = 0, lastVersion = 0;
const snap = () => JSON.stringify(els, (k, v) => (k[0] === '_' ? undefined : v));
const bc = new BroadcastChannel('ub_room_' + currentBoardId);

bc.onmessage = ev => {
  const msg = ev.data;
  if (msg.type === 'cursor') {
    remoteCursors.set(msg.id, { x: msg.x, y: msg.y, name: msg.name, color: msg.color, t: performance.now() });
    inval(false, true);
  } else if (msg.type === 'scene' && msg.ver > lastVersion) {
    lastVersion = msg.ver;
    els = JSON.parse(msg.els);
    inval();
  }
};

function broadcastScene() {
  lastVersion = Date.now();
  bc.postMessage({ type: 'scene', els: snap(), ver: lastVersion });
}

async function encodeSceneToHash(jsonStr) {
  const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decodeSceneFromHash(hashStr) {
  const b64 = hashStr.replace(/-/g, '+').replace(/_/g, '/');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

$('#btn-share-room').onclick = async () => {
  const btn = $('#share-label');
  try {
    const packed = await encodeSceneToHash(snap());
    const url = new URL(location.href);
    url.searchParams.set('room', currentBoardId);
    url.hash = 'scene=' + packed;
    history.replaceState(null, '', url);
    await navigator.clipboard.writeText(url.toString());
    btn.textContent = 'Лінк скопійовано!';
    setTimeout(() => { btn.textContent = 'Спільний доступ'; }, 2500);
  } catch {
    btn.textContent = 'Скопійовано!';
    setTimeout(() => { btn.textContent = 'Спільний доступ'; }, 2000);
  }
};

function commit() {
  hist = hist.slice(0, hi + 1); hist.push(snap());
  if (hist.length > 100) hist.shift();
  hi = hist.length - 1; updUndo(); updateContextPanel(); save(); broadcastScene();
}
function restore(i) { hi = i; els = JSON.parse(hist[i]); sel = []; updUndo(); updateContextPanel(); inval(); save(); broadcastScene(); }
function updUndo() {
  $('#btn-undo').style.opacity = hi > 0 ? 1 : 0.35;
  $('#btn-redo').style.opacity = hi < hist.length - 1 ? 1 : 0.35;
}

const idb = new Promise(res => {
  try { const r = indexedDB.open('ultraboard', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); }
});
async function put(k, v) { const d = await idb; if (d) d.transaction('kv', 'readwrite').objectStore('kv').put(v, k); }
async function get(k) {
  const d = await idb; if (!d) return;
  return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(); });
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => put('board_' + currentBoardId, { els: snap(), cam: { ...cam }, ver: lastVersion }), 350);
}

// ---------- Менеджер дошок (Профіль) ----------
function renderBoardsModal() {
  $('#user-name-input').value = userName;
  const list = $('#boards-list');
  list.innerHTML = '';
  boardsMeta.forEach(b => {
    const row = document.createElement('div');
    row.className = 'board-item' + (b.id === currentBoardId ? ' active' : '');
    row.innerHTML = `
      <div class="board-item-info">
        <span class="board-item-title">${b.name}</span>
        <span class="board-item-meta">ID: ${b.id}</span>
      </div>
      <div style="display:flex;gap:4px">
        <button type="button" class="mini-btn" data-ren="${b.id}">✎</button>
        ${boardsMeta.length > 1 ? `<button type="button" class="mini-btn danger" data-delb="${b.id}">✕</button>` : ''}
      </div>`;
    row.onclick = async ev => {
      if (ev.target.dataset.ren) {
        const nn = prompt('Назва дошки:', b.name);
        if (nn) { b.name = nn; localStorage.setItem('ub-boards', JSON.stringify(boardsMeta)); renderBoardsModal(); $('#current-board-name').textContent = nn; }
        return;
      }
      if (ev.target.dataset.delb) {
        boardsMeta = boardsMeta.filter(x => x.id !== b.id);
        localStorage.setItem('ub-boards', JSON.stringify(boardsMeta));
        renderBoardsModal(); return;
      }
      currentBoardId = b.id;
      $('#current-board-name').textContent = b.name;
      const saved = await get('board_' + currentBoardId);
      els = saved ? JSON.parse(saved.els) : [];
      if (saved?.cam) Object.assign(cam, saved.cam);
      sel = []; hist = [snap()]; hi = 0; updUndo(); camChanged();
      $('#boards-modal').hidden = true;
    };
    list.appendChild(row);
  });
}

$('#btn-open-boards').onclick = () => { renderBoardsModal(); $('#boards-modal').hidden = false; };
$('#btn-close-boards').onclick = () => { $('#boards-modal').hidden = true; };
$('#user-name-input').oninput = e => { userName = e.target.value || 'Гість'; localStorage.setItem('ub-user', userName); };
$('#btn-new-board').onclick = () => {
  const id = 'b_' + Math.random().toString(36).slice(2, 7);
  const name = 'Дошка #' + (boardsMeta.length + 1);
  boardsMeta.push({ id, name, updated: Date.now() });
  localStorage.setItem('ub-boards', JSON.stringify(boardsMeta));
  currentBoardId = id; els = []; sel = []; hist = ['[]']; hi = 0;
  $('#current-board-name').textContent = name;
  $('#boards-modal').hidden = true; commit(); inval();
};

// ---------- Радіальне меню (ПКМ) ----------
cl.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  pieWorld = toW(ev.clientX, ev.clientY);
  pie.style.left = ev.clientX + 'px';
  pie.style.top = ev.clientY + 'px';
  pie.hidden = false;
});
pie.addEventListener('click', ev => {
  const item = ev.target.closest('.pie-item');
  if (!item) return;
  const act = item.dataset.pie;
  pie.hidden = true;
  if (act === 'dup') { duplicateSel(); return; }
  const [wx, wy] = pieWorld;
  if (act === 'text') { openEditor(wx, wy); return; }
  if (act === 'sticky' || act === 'rect') {
    const el = mk(act, { x1: wx - 80, y1: wy - 80, x2: wx + 80, y2: wy + 80, text: act === 'sticky' ? '' : undefined });
    els.push(el); sel = [el]; setTool('select'); syncProps(el); updateContextPanel(); commit(); inval();
    if (act === 'sticky') openEditor(el.x1, el.y1, el);
    return;
  }
  setTool(act);
});

// ---------- Інструменти та Маніпуляції ----------
const CURSOR = { select: 'default', hand: 'grab', text: 'text', eraser: 'cell', laser: 'crosshair', eyedropper: 'copy' };
function setTool(t) {
  closeEditor(); pie.hidden = true; tool = t; snapTarget = null;
  if (t !== 'select') sel = [];
  $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  cl.style.cursor = CURSOR[t] || 'crosshair';
  updateContextPanel(); inval(false, true);
}
const mk = (type, extra) => ({
  id: Math.random().toString(36).slice(2), type,
  stroke: style.stroke, fill: type === 'sticky' ? (style.fill || '#fef08a') : style.fill,
  fillStyle: style.fillStyle, width: style.width, dash: style.dash,
  rough: style.rough, radius: style.radius, opacity: style.opacity,
  font: style.font, shadow: style.shadow, rot: 0, locked: false,
  curve: style.curve, headStart: style.headStart,
  headEnd: type === 'arrow' ? (style.headEnd === 'none' ? 'arrow' : style.headEnd) : 'none',
  flow: style.flow, seed: Math.floor(Math.random() * 1000), ...extra,
});

function getHandle(b, rot, x, y) {
  const p = 6 / cam.z, r = 10 / cam.z, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (rot) [x, y] = rotatePt(x, y, cx, cy, -rot);
  if (Math.hypot(x - cx, y - (b.y - p - 20 / cam.z)) <= r) return 'rot';
  for (const [name, hx, hy] of [['nw', b.x - p, b.y - p], ['ne', b.x + b.w + p, b.y - p], ['se', b.x + b.w + p, b.y + b.h + p], ['sw', b.x - p, b.y + b.h + p]]) {
    if (Math.abs(x - hx) <= r && Math.abs(y - hy) <= r) return name;
  }
  return null;
}

function showSizeBadge(sx, sy, w, h) {
  badge.hidden = false; badge.style.left = sx + 'px'; badge.style.top = sy + 'px';
  badge.textContent = `${Math.round(w)} × ${Math.round(h)}`;
}

cl.addEventListener('pointerdown', ev => {
  $('#export-menu').hidden = true; $('#custom-menu').hidden = true; pie.hidden = true;
  closeEditor(); cl.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);

  if (ptrs.size === 2) {
    draft = null; badge.hidden = true;
    const [a, b] = [...ptrs.values()], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    drag = { k: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: cam.z, wx: (mx - cam.x) / cam.z, wy: (my - cam.y) / cam.z };
    inval(false, true); return;
  }

  const sx = ev.clientX, sy = ev.clientY, [rx, ry] = toW(sx, sy);
  const x = snapV(rx), y = snapV(ry);
  if (ev.button === 1 || tool === 'hand' || space) { drag = { k: 'pan', sx, sy, cx: cam.x, cy: cam.y }; return; }
  if (ev.button !== 0) return;

  if (tool === 'laser') { drag = { k: 'laser' }; laserPts.push({ x: rx, y: ry, t: performance.now() }); startLaserLoop(); return; }
  if (tool === 'eyedropper') {
    const target = pick(rx, ry);
    if (target) { syncProps(target); Object.assign(style, { stroke: target.stroke, fill: target.fill, width: target.width || 2, dash: target.dash || 'solid', rough: target.rough || 0, fillStyle: target.fillStyle || 'solid' }); }
    setTool('select'); return;
  }

  if (tool === 'select') {
    const single = sel.length === 1 && !sel[0].locked ? sel[0] : null;
    if (single && (single.type === 'line' || single.type === 'arrow')) {
      const r = 11 / cam.z;
      const bx = single.cx ?? (single.x1 + single.x2) / 2, by = single.cy ?? (single.y1 + single.y2) / 2;
      if (Math.hypot(rx - bx, ry - by) <= r) { drag = { k: 'bend', el: single, changed: false }; return; }
      if (Math.hypot(rx - single.x1, ry - single.y1) <= r) { drag = { k: 'end1', el: single, changed: false }; return; }
      if (Math.hypot(rx - single.x2, ry - single.y2) <= r) { drag = { k: 'end2', el: single, changed: false }; return; }
    }
    if (sel.length && !sel.every(e => e.locked)) {
      const b = groupBBox(sel), h = getHandle(b, single ? single.rot : 0, rx, ry);
      if (h === 'rot') { drag = { k: 'rotate', cx: b.x + b.w / 2, cy: b.y + b.h / 2, changed: false }; return; }
      if (h) { drag = { k: 'resize', corner: h, orig: structuredClone(sel), b, changed: false }; return; }
    }

    const hitEl = pick(rx, ry);
    if (hitEl) {
      if (hitEl.type === 'todo' && !hitEl.locked) {
        const b = rawBBox(hitEl);
        if (rx >= b.x + 10 && rx <= b.x + 36) {
          const idx = Math.floor((ry - (b.y + 10)) / 28);
          const lines = (hitEl.text || 'Завдання 1\nЗавдання 2\nЗавдання 3').split('\n');
          if (idx >= 0 && idx < lines.length) {
            hitEl.done = hitEl.done || [];
            hitEl.done[idx] = !hitEl.done[idx];
            commit(); inval(); return;
          }
        }
      }
      if (hitEl.type === 'code') {
        const b = rawBBox(hitEl);
        if (ry >= b.y && ry <= b.y + 28 && rx >= b.x + b.w - 65) {
          navigator.clipboard?.writeText(hitEl.text || '');
          hitEl._copied = true; inval();
          setTimeout(() => { delete hitEl._copied; inval(); }, 1500);
          return;
        }
      }

      if (ev.shiftKey) sel = sel.includes(hitEl) ? sel.filter(e => e !== hitEl) : [...sel, hitEl];
      else if (!sel.includes(hitEl)) sel = [hitEl];
      if (sel.length === 1) syncProps(sel[0]);
      updateContextPanel();
      let moving = [...sel];
      for (const item of sel) {
        if (item.type === 'frame' && !item.locked) {
          const fb = bbox(item);
          for (const other of els) {
            if (other !== item && !moving.includes(other) && !other.locked) {
              const ob = bbox(other);
              if (ob.x >= fb.x && ob.y >= fb.y && ob.x + ob.w <= fb.x + fb.w && ob.y + ob.h <= fb.y + fb.h) moving.push(other);
            }
          }
        }
      }
      moving = moving.filter(e => !e.locked);
      drag = moving.length ? { k: 'move', items: moving, orig: structuredClone(moving), x, y, changed: false } : null;
    } else {
      if (!ev.shiftKey) sel = [];
      updateContextPanel();
      drag = { k: 'marquee', x1: rx, y1: ry, x2: rx, y2: ry };
    }
    inval(false, true); return;
  }

  if (tool === 'eraser') { drag = { k: 'erase', changed: false }; erase(rx, ry); return; }
  if (tool === 'text') { drag = { k: 'text', x, y }; return; }

  if (tool === 'pen') draft = mk('pen', { pts: [[rx, ry]] });
  else {
    const anchor = (tool === 'line' || tool === 'arrow') ? findSnapAnchor(rx, ry) : null;
    draft = mk(tool, {
      x1: anchor ? anchor.x : x, y1: anchor ? anchor.y : y,
      x2: anchor ? anchor.x : x, y2: anchor ? anchor.y : y,
      startBind: anchor ? { elId: anchor.elId, idx: anchor.idx } : null,
      text: ['sticky', 'code', 'todo'].includes(tool) ? '' : undefined,
      title: tool === 'frame' ? `Фрейм ${els.filter(e => e.type === 'frame').length + 1}` : undefined,
    });
  }
  drag = { k: 'draw' }; inval(false, true);
});

cl.addEventListener('pointermove', ev => {
  if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
  const [rx, ry] = toW(ev.clientX, ev.clientY);
  const x = snapV(rx), y = snapV(ry);

  bc.postMessage({ type: 'cursor', id: myClientId, x: rx, y: ry, name: userName, color: myCursorColor });

  if (!drag && (tool === 'line' || tool === 'arrow')) {
    const prev = snapTarget;
    snapTarget = findSnapAnchor(rx, ry);
    if (prev?.x !== snapTarget?.x || prev?.y !== snapTarget?.y) inval(false, true);
  }

  if (!drag) return;
  const d = drag;

  if (d.k === 'pinch') {
    if (ptrs.size < 2) return;
    const [a, b] = [...ptrs.values()], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    cam.z = Math.max(ZMIN, Math.min(ZMAX, d.z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d.d0));
    cam.x = mx - d.wx * cam.z; cam.y = my - d.wy * cam.z; camChanged();
  } else if (d.k === 'pan') {
    cam.x = d.cx + ev.clientX - d.sx; cam.y = d.cy + ev.clientY - d.sy; camChanged();
  } else if (d.k === 'laser') {
    laserPts.push({ x: rx, y: ry, t: performance.now() }); inval(false, true);
  } else if (d.k === 'bend') {
    d.el.cx = x; d.el.cy = y;
    if (d.el.curve === 'straight') d.el.curve = 'curved';
    delete d.el._b; d.changed = true; inval();
  } else if (d.k === 'end1' || d.k === 'end2') {
    snapTarget = findSnapAnchor(rx, ry, d.el.id);
    const tx = snapTarget ? snapTarget.x : x, ty = snapTarget ? snapTarget.y : y;
    if (d.k === 'end1') { d.el.x1 = tx; d.el.y1 = ty; d.el.startBind = snapTarget ? { elId: snapTarget.elId, idx: snapTarget.idx } : null; }
    else { d.el.x2 = tx; d.el.y2 = ty; d.el.endBind = snapTarget ? { elId: snapTarget.elId, idx: snapTarget.idx } : null; }
    delete d.el._b; d.changed = true; inval();
  } else if (d.k === 'marquee') {
    d.x2 = rx; d.y2 = ry;
    const mx0 = Math.min(d.x1, d.x2), my0 = Math.min(d.y1, d.y2), mx1 = Math.max(d.x1, d.x2), my1 = Math.max(d.y1, d.y2);
    sel = els.filter(e => { const b = bbox(e); return b.x >= mx0 && b.y >= my0 && b.x + b.w <= mx1 && b.y + b.h <= my1; });
    updateContextPanel(); inval(false, true);
  } else if (d.k === 'rotate') {
    let ang = Math.atan2(ry - d.cy, rx - d.cx) + Math.PI / 2;
    if (ev.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    sel[0].rot = ang; d.changed = true; updateBindings(); inval();
  } else if (d.k === 'move') {
    const dx = x - d.x, dy = y - d.y;
    d.items.forEach((e, idx) => { Object.assign(e, structuredClone(d.orig[idx])); mapEl(e, (px, py) => [px + dx, py + dy]); });
    updateBindings(); d.changed = true; inval();
  } else if (d.k === 'resize') {
    const b = d.b, p = 6 / cam.z;
    let nx0 = b.x, ny0 = b.y, nx1 = b.x + b.w, ny1 = b.y + b.h;
    if (d.corner.includes('e')) nx1 = Math.max(nx0 + 10, x - p);
    if (d.corner.includes('w')) nx0 = Math.min(nx1 - 10, x + p);
    if (d.corner.includes('s')) ny1 = Math.max(ny0 + 10, y - p);
    if (d.corner.includes('n')) ny0 = Math.min(ny1 - 10, y + p);
    let sx = b.w > 1 ? (nx1 - nx0) / b.w : 1, sy = b.h > 1 ? (ny1 - ny0) / b.h : 1;
    if (ev.shiftKey) sx = sy = Math.max(sx, sy);
    sel.forEach((e, idx) => {
      const orig = d.orig[idx]; Object.assign(e, structuredClone(orig));
      if (orig.type === 'text') e.size = Math.max(8, orig.size * sy);
      mapEl(e, (px, py) => [nx0 + (px - b.x) * sx, ny0 + (py - b.y) * sy]);
    });
    showSizeBadge(ev.clientX, ev.clientY, nx1 - nx0, ny1 - ny0);
    updateBindings(); d.changed = true; inval();
  } else if (d.k === 'erase') {
    erase(rx, ry);
  } else if (d.k === 'draw' && draft) {
    if (draft.pts) {
      const l = draft.pts[draft.pts.length - 1];
      if (Math.hypot(rx - l[0], ry - l[1]) > 1.5 / cam.z) draft.pts.push([rx, ry]);
    } else if (draft.type === 'line' || draft.type === 'arrow') {
      snapTarget = findSnapAnchor(rx, ry, draft.id);
      if (snapTarget) { draft.x2 = snapTarget.x; draft.y2 = snapTarget.y; draft.endBind = { elId: snapTarget.elId, idx: snapTarget.idx }; }
      else { draft.x2 = x; draft.y2 = y; draft.endBind = null; }
      delete draft._b;
      showSizeBadge(ev.clientX, ev.clientY, Math.abs(draft.x2 - draft.x1), Math.abs(draft.y2 - draft.y1));
    } else {
      if (ev.shiftKey) {
        const dx = x - draft.x1, dy = y - draft.y1, m = Math.max(Math.abs(dx), Math.abs(dy));
        draft.x2 = draft.x1 + Math.sign(dx) * m; draft.y2 = draft.y1 + Math.sign(dy) * m;
      } else { draft.x2 = x; draft.y2 = y; }
      delete draft._b;
      showSizeBadge(ev.clientX, ev.clientY, Math.abs(draft.x2 - draft.x1), Math.abs(draft.y2 - draft.y1));
    }
    inval(false, true);
  }
});

function erase(x, y) {
  const n = els.length;
  els = els.filter(e => e.locked || !hit(e, x, y, 8 / cam.z));
  if (els.length !== n) { drag.changed = true; sel = []; updateContextPanel(); inval(); }
}

function end(ev) {
  ptrs.delete(ev.pointerId); badge.hidden = true;
  if (!drag) return;
  const d = drag;
  if (d.k === 'pinch') { if (ptrs.size < 2) drag = null; return; }
  drag = null; snapTarget = null;

  if (d.k === 'draw' && draft) {
    const e = draft; draft = null;
    if (!e.pts) {
      const dist = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
      if (dist < 6 / cam.z) {
        const defW = (e.type === 'line' || e.type === 'arrow') ? 140 : (e.type === 'frame' ? 320 : e.type === 'code' ? 280 : 180);
        const defH = (e.type === 'line' || e.type === 'arrow') ? 0 : (e.type === 'frame' ? 220 : 160);
        if (e.type === 'line' || e.type === 'arrow') { e.x2 = e.x1 + defW; e.y2 = e.y1; }
        else { e.x1 -= defW / 2; e.y1 -= defH / 2; e.x2 = e.x1 + defW; e.y2 = e.y1 + defH; }
      }
      delete e._b;
    }
    if (e.type === 'frame') els.unshift(e); else els.push(e);
    commit();
    if (!e.pts) {
      setTool('select'); sel = [e]; syncProps(e); updateContextPanel();
      if (['sticky', 'code', 'todo'].includes(e.type)) openEditor(Math.min(e.x1, e.x2), Math.min(e.y1, e.y2), e);
    }
    inval();
  } else if (d.changed) commit();
  if (d.k === 'text') openEditor(d.x, d.y);
  inval(false, true);
}
cl.addEventListener('pointerup', end); cl.addEventListener('pointercancel', end);

cl.addEventListener('dblclick', ev => {
  const [x, y] = toW(ev.clientX, ev.clientY);
  if (sel.length === 1 && (sel[0].type === 'line' || sel[0].type === 'arrow')) {
    const bx = sel[0].cx ?? (sel[0].x1 + sel[0].x2) / 2, by = sel[0].cy ?? (sel[0].y1 + sel[0].y2) / 2;
    if (Math.hypot(x - bx, y - by) <= 14 / cam.z) { delete sel[0].cx; delete sel[0].cy; delete sel[0]._b; commit(); inval(); return; }
  }
  const t = pick(x, y);
  if (t && !t.locked && ['text', 'sticky', 'code', 'todo', 'frame'].includes(t.type)) {
    openEditor(t.type === 'text' ? t.x : t.x1, t.type === 'text' ? t.y : t.y1, t);
  } else if (!t) openEditor(x, y);
});

function startLaserLoop() {
  if (laserRaf) return;
  const step = () => {
    const now = performance.now();
    laserPts = laserPts.filter(p => now - p.t < 650);
    inval(false, true);
    if (laserPts.length) laserRaf = requestAnimationFrame(step); else laserRaf = 0;
  };
  laserRaf = requestAnimationFrame(step);
}

// ---------- Текст, Стікери, Код та Чеклісти ----------
const taSize = () => 14 + style.width * 2.5;
function openEditor(x, y, ex) {
  editing = { x, y, ex };
  const isCard = ['sticky', 'code', 'todo'].includes(ex?.type);
  const isFrame = ex?.type === 'frame';
  if (ex && !isCard && !isFrame) { ex._hide = true; inval(); }

  const size = isCard ? (ex.type === 'code' ? 13 : 15) : isFrame ? 14 : (ex ? ex.size : taSize());
  const topOffset = ex?.type === 'code' ? 32 : 8;
  const b = ex ? rawBBox(ex) : null;
  const isDarkTheme = ['dark', 'midnight', 'blueprint'].includes(cfg.theme);

  let bg = 'var(--bg-canvas)';
  let fg = ink(ex ? ex.stroke : style.stroke);
  if (ex?.type === 'sticky') { bg = ex.fill || '#fef08a'; fg = '#1e293b'; }
  else if (ex?.type === 'code') { bg = '#0f172a'; fg = '#f8fafc'; }
  else if (ex?.type === 'todo') { bg = ex.fill || (isDarkTheme ? '#1e293b' : '#ffffff'); }

  Object.assign(ta.style, {
    left: (isCard ? b.x + 8 : isFrame ? b.x : x) * cam.z + cam.x + 'px',
    top: (isCard ? b.y + topOffset : isFrame ? b.y - 28 : y) * cam.z + cam.y + 'px',
    width: isCard ? (b.w - 16) * cam.z + 'px' : 'auto',
    height: isCard ? (b.h - topOffset - 8) * cam.z + 'px' : 'auto',
    fontSize: size * cam.z + 'px',
    fontFamily: ex?.type === 'code' ? 'monospace' : isFrame ? 'sans-serif' : (FONTS[ex?.font || style.font])(10).replace('10px ', ''),
    background: bg,
    color: fg,
  });

  ta.value = ex ? (isFrame ? ex.title : ex.text) || '' : '';
  ta.hidden = false;
  if (!isCard) fit();
  setTimeout(() => ta.focus(), 0);
}

function fit() {
  if (['sticky', 'code', 'todo'].includes(editing?.ex?.type)) return;
  ta.style.width = '0'; ta.style.height = 'auto';
  ta.style.width = Math.max(90, ta.scrollWidth + 14) + 'px';
  ta.style.height = ta.scrollHeight + 'px';
}

function closeEditor() {
  if (!editing) return;
  const { x, y, ex } = editing, t = ta.value.replace(/\s+$/, '');
  editing = null; ta.hidden = true;
  if (ex) {
    delete ex._hide;
    if (ex.type === 'frame') ex.title = t || 'Фрейм';
    else if (['sticky', 'code', 'todo'].includes(ex.type)) { ex.text = t; delete ex._b; }
    else if (t) { ex.text = t; delete ex._b; }
    else { els = els.filter(e => e !== ex); sel = []; }
    commit();
  } else if (t) { els.push(mk('text', { x, y, text: t, size: taSize(), fill: null })); commit(); }
  inval();
}
ta.addEventListener('input', fit);
ta.addEventListener('blur', closeEditor);
ta.addEventListener('keydown', ev => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); closeEditor(); } });

// ---------- Зображення ----------
function addImageFromFile(file, wx, wy) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 380 / Math.max(img.width, img.height)), w = img.width * s, h = img.height * s;
      const [cx, cy] = wx !== undefined ? [wx, wy] : toW(W / 2, H / 2);
      const el = mk('image', { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, src: reader.result });
      els.push(el); setTool('select'); sel = [el]; syncProps(el); updateContextPanel(); commit(); inval();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
$('#btn-image').onclick = () => $('#img-loader').click();
$('#img-loader').onchange = e => { addImageFromFile(e.target.files[0]); e.target.value = ''; };
board.addEventListener('dragover', e => e.preventDefault());
board.addEventListener('drop', e => { e.preventDefault(); const [wx, wy] = toW(e.clientX, e.clientY); addImageFromFile(e.dataTransfer.files[0], wx, wy); });
addEventListener('paste', e => {
  if (e.target === ta) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) addImageFromFile(item.getAsFile());
});

// ---------- Кастомізація властивостей ----------
function setProp(k, v, shouldCommit = false) {
  const numKeys = ['width', 'rough', 'radius'];
  const val = numKeys.includes(k) ? +v : k === 'opacity' ? +v / 100 : v === 'none' && !['headStart', 'headEnd'].includes(k) ? null : v;
  style[k] = val;
  if (k === 'width') $('#width-val').textContent = val;
  if (k === 'radius') $('#radius-val').textContent = val;
  if (k === 'opacity') $('#opacity-val').textContent = Math.round(val * 100) + '%';
  if (sel.length) {
    sel.forEach(e => {
      e[k] = val;
      if (k === 'width' && e.type === 'text') e.size = 14 + val * 2.5;
      delete e._b;
    });
    inval();
    if (shouldCommit) commit();
  }
}

function syncProps(e) {
  $('#prop-stroke').value = e.stroke;
  $('#prop-width').value = e.width || 2; $('#width-val').textContent = e.width || 2;
  $('#prop-radius').value = e.radius ?? 6; $('#radius-val').textContent = e.radius ?? 6;
  $('#prop-dash').value = e.dash || 'solid';
  $('#prop-rough').value = e.rough || 0;
  $('#prop-fill-style').value = e.fillStyle || 'solid';
  $('#prop-font').value = e.font || 'sans';
  $('#prop-curve').value = e.curve || 'curved';
  $('#prop-head-start').value = e.headStart || 'none';
  $('#prop-head-end').value = e.headEnd || (e.type === 'arrow' ? 'arrow' : 'none');
  const op = Math.round((e.opacity ?? 1) * 100);
  $('#prop-opacity').value = op; $('#opacity-val').textContent = op + '%';
  if (e.fill) $('#prop-fill').value = e.fill;
  $('#btn-shadow').setAttribute('aria-pressed', !!e.shadow);
  $('#btn-shadow').textContent = e.shadow ? 'Тінь: Увімкнено' : 'Тінь: Вимкнено';
  $('#btn-flow').setAttribute('aria-pressed', !!e.flow);
  $('#btn-flow').textContent = e.flow ? '⚡ Потік імпульсів: Увімк' : '⚡ Потік імпульсів: Вимк';
  updateSwatchUI('stroke', e.stroke); updateSwatchUI('fill', e.fill || 'none');
}

function updateSwatchUI(target, color) {
  $$(`.swatches[data-target="${target}"] .swatch`).forEach(s => s.classList.toggle('active', s.dataset.color === color));
}

$$('.swatches').forEach(group => {
  const target = group.dataset.target;
  group.addEventListener('click', ev => {
    const btn = ev.target.closest('.swatch');
    if (!btn) return;
    const c = btn.dataset.color;
    updateSwatchUI(target, c);
    if (c !== 'none') $('#prop-' + target).value = c;
    setProp(target, c, true);
  });
});

for (const [id, k] of [
  ['stroke', 'stroke'], ['fill', 'fill'], ['fill-style', 'fillStyle'], ['width', 'width'],
  ['dash', 'dash'], ['rough', 'rough'], ['radius', 'radius'], ['opacity', 'opacity'],
  ['font', 'font'], ['curve', 'curve'], ['head-start', 'headStart'], ['head-end', 'headEnd']
]) {
  const el = $('#prop-' + id);
  el.addEventListener('input', () => { if (id === 'stroke' || id === 'fill') updateSwatchUI(id, el.value); setProp(k, el.value, false); });
  el.addEventListener('change', () => { if (sel.length) commit(); });
}

$('#btn-reset-bend').onclick = () => { if (!sel.length) return; sel.forEach(e => { delete e.cx; delete e.cy; delete e._b; }); commit(); inval(); };
$('#btn-flow').onclick = () => {
  style.flow = !style.flow;
  $('#btn-flow').setAttribute('aria-pressed', style.flow);
  $('#btn-flow').textContent = style.flow ? '⚡ Потік імпульсів: Увімк' : '⚡ Потік імпульсів: Вимк';
  if (sel.length) { sel.forEach(e => (e.flow = style.flow)); commit(); inval(); }
};
$('#btn-shadow').onclick = () => {
  style.shadow = !style.shadow;
  $('#btn-shadow').setAttribute('aria-pressed', style.shadow);
  $('#btn-shadow').textContent = style.shadow ? 'Тінь: Увімкнено' : 'Тінь: Вимкнено';
  if (sel.length) { sel.forEach(e => (e.shadow = style.shadow)); commit(); inval(); }
};

// ---------- Шари, Блокування, Вирівнювання ----------
function bringFront() { if (!sel.length) return; els = [...els.filter(e => !sel.includes(e)), ...sel]; commit(); inval(); }
function sendBack() { if (!sel.length) return; els = [...sel, ...els.filter(e => !sel.includes(e))]; commit(); inval(); }
function toggleLock() { if (!sel.length) return; const next = !sel.some(e => e.locked); sel.forEach(e => (e.locked = next)); updateContextPanel(); commit(); inval(false, true); }
function duplicateSel() {
  if (!sel.length) return;
  const copies = sel.map(e => { const c = structuredClone(e); c.id = Math.random().toString(36).slice(2); c.locked = false; mapEl(c, (x, y) => [x + 24, y + 24]); return c; });
  els.push(...copies); sel = copies; commit(); inval();
}
function deleteSel() { if (!sel.length) return; els = els.filter(e => !sel.includes(e) || e.locked); sel = sel.filter(e => e.locked); commit(); inval(); }

$('#btn-front').onclick = bringFront; $('#btn-back').onclick = sendBack;
$('#btn-lock').onclick = toggleLock; $('#btn-dup').onclick = duplicateSel; $('#btn-del').onclick = deleteSel;

$$('[data-align]').forEach(btn => btn.onclick = () => {
  if (sel.length < 2) return;
  const gb = groupBBox(sel), mode = btn.dataset.align;
  for (const e of sel) {
    if (e.locked) continue;
    const b = bbox(e);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = gb.x - b.x;
    if (mode === 'center') dx = gb.x + gb.w / 2 - (b.x + b.w / 2);
    if (mode === 'right') dx = gb.x + gb.w - (b.x + b.w);
    if (mode === 'top') dy = gb.y - b.y;
    if (mode === 'middle') dy = gb.y + gb.h / 2 - (b.y + b.h / 2);
    if (mode === 'bottom') dy = gb.y + gb.h - (b.y + b.h);
    mapEl(e, (px, py) => [px + dx, py + dy]);
  }
  updateBindings(); commit(); inval();
});

// ---------- X-Ray & Демо-онбординг ----------
function toggleXRay() { xrayMode = !xrayMode; $('#xray-hud').hidden = !xrayMode; inval(); }
$('#btn-toggle-xray').onclick = () => { $('#custom-menu').hidden = true; toggleXRay(); };
$('#xr-boxes').onchange = () => inval(false, true);
$('#zoom-label').ondblclick = toggleXRay;

function buildDemoScene() {
  const cx = -cam.x / cam.z + W / (2 * cam.z), cy = -cam.y / cam.z + H / (2 * cam.z);
  const f = mk('frame', { x1: cx - 360, y1: cy - 210, x2: cx + 360, y2: cy + 210, title: 'UltraBoard Pro — Інтерактивна візитівка' });
  const r1 = mk('code', { x1: cx - 320, y1: cy - 110, x2: cx - 70, y2: cy + 30, text: 'const fps = 120;\n// 0% CPU у спокої\nexport function render() {\n  return "Ultra Fast";\n}' });
  const r2 = mk('todo', { x1: cx + 80, y1: cy - 110, x2: cx + 320, y2: cy + 30, text: 'Живі стрілки\nРадіальне меню (ПКМ)\nURL-шаринг без сервера', done: [true, true, false] });
  const t2 = mk('text', { x: cx - 310, y: cy + 145, text: '💡 Клікни по галочках у чеклісті, натисни ПКМ для Pie Menu або ~ для X-Ray', size: 13, font: 'sans' });
  const a1 = mk('arrow', { x1: cx - 70, y1: cy - 40, x2: cx + 80, y2: cy - 40, cx: cx + 5, cy: cy - 95, curve: 'curved', headStart: 'dot', headEnd: 'arrow', flow: true, startBind: { elId: r1.id, idx: 1 }, endBind: { elId: r2.id, idx: 3 } });
  els.push(f, r1, r2, t2, a1);
}
$('#btn-demo-scene').onclick = () => { buildDemoScene(); commit(); inval(); };

// ---------- Кастомізація Дошки та UI ----------
function applyConfig() {
  root.dataset.theme = cfg.theme;
  root.style.setProperty('--accent-color', cfg.accent);
  root.style.setProperty('--panel-alpha', cfg.glass / 100);
  root.style.setProperty('--panel-radius', cfg.radius + 'px');

  board.classList.toggle('grid-lines', cfg.gridType === 'lines');
  board.classList.toggle('grid-iso', cfg.gridType === 'iso');
  board.classList.toggle('grid-none', cfg.gridType === 'none');
  
  $('#minimap-wrap').hidden = !cfg.minimap;
  $('#btn-toggle-minimap').textContent = cfg.minimap ? 'Показана' : 'Схована';

  $('#ui-accent').value = cfg.accent; $('#ui-grid-type').value = cfg.gridType;
  $('#ui-grid-size').value = cfg.gridSize; $('#grid-size-val').textContent = cfg.gridSize;
  $('#ui-snap').checked = cfg.snap; $('#ui-glass').value = cfg.glass;
  $('#ui-radius').value = cfg.radius;

  localStorage.setItem('ub-cfg', JSON.stringify(cfg));
  camChanged();
}

$$('[data-set-theme]').forEach(b => b.onclick = () => { cfg.theme = b.dataset.setTheme; applyConfig(); });
$('#ui-accent').oninput = e => { cfg.accent = e.target.value; applyConfig(); };
$('#ui-grid-type').onchange = e => { cfg.gridType = e.target.value; applyConfig(); };
$('#ui-grid-size').oninput = e => { cfg.gridSize = +e.target.value; applyConfig(); };
$('#ui-snap').onchange = e => { cfg.snap = e.target.checked; applyConfig(); };
$('#ui-glass').oninput = e => { cfg.glass = +e.target.value; applyConfig(); };
$('#ui-radius').oninput = e => { cfg.radius = +e.target.value; applyConfig(); };

$('#btn-toggle-minimap').onclick = () => { cfg.minimap = !cfg.minimap; applyConfig(); };

// ---------- Кнопки та Експорт ----------
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
const undo = () => hi > 0 && restore(hi - 1), redo = () => hi < hist.length - 1 && restore(hi + 1);
$('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
$('#btn-zoom-in').onclick = () => zoomAt(W / 2, H / 2, 1.25);
$('#btn-zoom-out').onclick = () => zoomAt(W / 2, H / 2, 0.8);
$('#zoom-label').onclick = () => zoomAt(W / 2, H / 2, 1 / cam.z);
$('#btn-fit').onclick = fitAll;

$('#btn-theme').onclick = () => {
  const order = ['light', 'paper', 'dark', 'blueprint', 'midnight'];
  cfg.theme = order[(order.indexOf(cfg.theme) + 1) % order.length];
  applyConfig();
};

$('#btn-export-menu').onclick = ev => { ev.stopPropagation(); $('#custom-menu').hidden = true; $('#export-menu').hidden = !$('#export-menu').hidden; };
$('#btn-custom-menu').onclick = ev => { ev.stopPropagation(); $('#export-menu').hidden = true; $('#custom-menu').hidden = !$('#custom-menu').hidden; };
$('#custom-menu').onclick = ev => ev.stopPropagation();
document.addEventListener('click', () => { $('#export-menu').hidden = true; $('#custom-menu').hidden = true; pie.hidden = true; });

$('#btn-export').onclick = () => {
  if (!els.length) return;
  const b = groupBBox(els), pad = 36, x0 = b.x - pad, y0 = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
  const s = Math.min(2, 8192 / Math.max(w, h)), c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const g = c.getContext('2d');
  g.fillStyle = getComputedStyle(document.body).backgroundColor; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s); els.forEach(e => drawEl(g, e));
  c.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ultraboard.png'; a.click(); });
};

$('#btn-export-svg').onclick = () => {
  if (!els.length) return;
  const b = groupBBox(els), pad = 24;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}">`;
  for (const e of els) {
    const st = ink(e.stroke), fl = e.fill || 'none', lw = e.width || 2;
    if (e.pts) svg += `<polyline fill="none" stroke="${st}" stroke-width="${lw}" stroke-linecap="round" points="${e.pts.map(p => p.join(',')).join(' ')}"/>`;
    else if (['rect', 'sticky', 'frame', 'code', 'todo'].includes(e.type)) svg += `<rect x="${Math.min(e.x1, e.x2)}" y="${Math.min(e.y1, e.y2)}" width="${Math.abs(e.x2 - e.x1)}" height="${Math.abs(e.y2 - e.y1)}" rx="${e.radius || 6}" fill="${fl}" stroke="${st}" stroke-width="${lw}"/>`;
    else if (e.type === 'ellipse') svg += `<ellipse cx="${(e.x1 + e.x2) / 2}" cy="${(e.y1 + e.y2) / 2}" rx="${Math.abs(e.x2 - e.x1) / 2}" ry="${Math.abs(e.y2 - e.y1) / 2}" fill="${fl}" stroke="${st}" stroke-width="${lw}"/>`;
    else if (e.type === 'line' || e.type === 'arrow') {
      const [cpx, cpy] = getBendControl(e);
      svg += `<path d="M ${e.x1} ${e.y1} Q ${cpx} ${cpy} ${e.x2} ${e.y2}" fill="none" stroke="${st}" stroke-width="${lw}"/>`;
    } else if (e.type === 'text') svg += `<text x="${e.x}" y="${e.y + e.size}" fill="${st}" font-size="${e.size}" font-family="sans-serif">${e.text}</text>`;
  }
  svg += '</svg>';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = 'ultraboard.svg'; a.click();
};

$('#btn-save-json').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([snap()], { type: 'application/json' })); a.download = 'ultraboard.json'; a.click(); };
$('#btn-load-json').onclick = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => { const r = new FileReader(); r.onload = () => { try { els = JSON.parse(r.result); sel = []; commit(); inval(); } catch {} }; r.readAsText(inp.files[0]); };
  inp.click();
};
$('#btn-clear').onclick = () => { if (confirm('Очистити всю дошку?')) { els = []; sel = []; commit(); inval(); } };

// ---------- Гарячі клавіші + Секретний код ----------
const KEYS = { v: 'select', h: 'hand', f: 'frame', p: 'pen', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', d: 'diamond', c: 'cloud', b: 'bubble', w: 'star', s: 'sticky', m: 'code', q: 'todo', t: 'text', g: 'eyedropper', e: 'eraser', k: 'laser' };
addEventListener('keydown', ev => {
  if (ev.target === ta || ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;

  if (ev.key === '`' || ev.key === '~' || ev.key === 'ё' || ev.key === 'Ё') { ev.preventDefault(); toggleXRay(); return; }
  if (!mod && k.length === 1) {
    secretBuf = (secretBuf + k).slice(-4);
    if (secretBuf === 'xray') { secretBuf = ''; toggleXRay(); return; }
  }

  if (k === ' ') { space = true; cl.style.cursor = 'grab'; ev.preventDefault(); }
  else if (ev.shiftKey && ev.code === 'Digit1') { ev.preventDefault(); fitAll(); }
  else if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { ev.preventDefault(); redo(); }
  else if (mod && k === 'a') { ev.preventDefault(); sel = [...els]; updateContextPanel(); inval(false, true); }
  else if (mod && k === 'd') { ev.preventDefault(); duplicateSel(); }
  else if (mod && k === 'l') { ev.preventDefault(); toggleLock(); }
  else if (k === 'delete' || k === 'backspace') deleteSel();
  else if (k === ']') bringFront();
  else if (k === '[') sendBack();
  else if (k === 'i' && !mod) $('#img-loader').click();
  else if (k === 'escape') { sel = []; pie.hidden = true; $('#boards-modal').hidden = true; updateContextPanel(); setTool('select'); }
  else if (!mod && KEYS[k]) setTool(KEYS[k]);
});
addEventListener('keyup', ev => { if (ev.key === ' ') { space = false; setTool(tool); } });
addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => document.hidden && save());

// ---------- Старт ----------
(async function init() {
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('ub-cfg') || '{}')); } catch {}
  applyConfig();
  resize(); cl.style.cursor = 'default';

  const activeBoard = boardsMeta.find(b => b.id === currentBoardId);
  if (activeBoard) $('#current-board-name').textContent = activeBoard.name;

  try {
    const localScene = await get('board_' + currentBoardId);
    if (location.hash.startsWith('#scene=')) {
      const unpacked = await decodeSceneFromHash(location.hash.slice(7));
      els = JSON.parse(unpacked);
    } else if (localScene) {
      els = JSON.parse(localScene.els);
      lastVersion = localScene.ver || 0;
      if (localScene.cam) Object.assign(cam, localScene.cam);
    } else {
      buildDemoScene();
    }
  } catch {}

  commit(); camChanged();
})();