/* กินให้ขึ้น — frontend (vanilla JS) */
'use strict';

const API_URL = (window.APP_CONFIG || {}).API_URL || '';

// ======================= utils =======================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtKg = n => (n == null ? '–' : Number(n).toFixed(1));
const pad = n => String(n).padStart(2, '0');
const toISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseISO = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const todayISO = () => toISO(new Date());
const thDate = (s, opt) => parseISO(s).toLocaleDateString('th-TH', opt || { day: 'numeric', month: 'short' });
const WD_SHORT = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const WD_LONG = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const thFull = s => thDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
const mondayOf = s => addDays(s, -((parseISO(s).getDay() + 6) % 7));
const qtyText = q => (q === 1 ? '' : ' <span class="muted">×' + q + '</span>');

// ======================= state =======================
const S = {
  token: sessionStorage.getItem('ct_token'),
  init: null,
  tab: 'today',
  date: todayISO(),
  day: null,
  weekDate: todayISO(),
  week: null,
  insights: null,
  weights: null,
  weightsRange: 90,
  photos: null,
  photoCache: {},
  compareMode: false,
  compareSel: [],
  planSel: null,
  wDate: null,
  anchorDraft: null,
  cal: null,
  days: {},        // แคชข้อมูลรายวัน (date → day)
  weeks: {},       // แคชสรุปรายสัปดาห์ (monday → week)
  weekFetching: {},
  fillOpts: [],
  pin: ''
};
let P = null;          // state ของตัวเลือกเมนู
let busyCount = 0;

const view = () => $('#view');

// ======================= API =======================
async function api(action, payload, opt) {
  opt = opt || {};
  if (opt.wait) waitOn(opt.wait);
  else if (!opt.quiet) setBusy(1);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, token: S.token }, payload || {}))
    });
    let j;
    try { j = await res.json(); } catch (_) {
      const e = new Error('API ตอบกลับผิดรูปแบบ ลอง Deploy เป็น New version และตั้ง Who has access เป็น Anyone');
      e.code = 'BAD_API';
      throw e;
    }
    if (!j.ok) {
      const e = new Error(j.error || 'เกิดข้อผิดพลาด');
      e.code = j.code;
      throw e;
    }
    return j.data;
  } catch (e) {
    if (e.code === 'AUTH') { logoutLocal(e.message); throw e; }
    if (!e.code) e.message = navigator.onLine ? 'ติดต่อ API ไม่ได้ เช็กการ Deploy (Anyone) และ URL ใน config.js' : 'ไม่มีอินเทอร์เน็ต';
    if (!opt.silent) toast(e.message, true);
    throw e;
  } finally {
    if (opt.wait) waitOff();
    else if (!opt.quiet) setBusy(-1);
  }
}

// ======================= popup กลางจอ (งานที่ต้องรอ) =======================
let waitCount = 0, waitTimer = null;
function waitOn(msg) {
  let el = $('#wait');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wait';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-live', 'assertive');
    el.innerHTML = '<div class="wait-card"><span class="spinner" aria-hidden="true"></span><p id="wait-msg"></p></div>';
    document.body.appendChild(el);
  }
  waitCount++;
  $('#wait-msg').textContent = msg;
  clearTimeout(waitTimer);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
}
function waitOff() {
  waitCount = Math.max(0, waitCount - 1);
  if (waitCount) return;
  const el = $('#wait');
  if (!el) return;
  el.classList.remove('show');
  waitTimer = setTimeout(() => { if (!waitCount) el.hidden = true; }, 180);
}
async function withWait(msg, fn) {
  waitOn(msg);
  try { return await fn(); } finally { waitOff(); }
}

// ======================= คิวบันทึก (หน้าจอเปลี่ยนก่อน แล้วส่งเบื้องหลัง + ออฟไลน์) =======================
const Q = { list: [], running: null, offline: false, retry: null };
try { Q.list = JSON.parse(localStorage.getItem('ct_queue') || '[]') || []; } catch (e) { Q.list = []; }

const tmpId = () => 'tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pendingFor = date => Q.list.some(o => o.date === date);

function qSave() {
  try { localStorage.setItem('ct_queue', JSON.stringify(Q.list)); } catch (e) { /* เต็มหรือถูกปิด */ }
  renderSync();
}

function enqueue(action, payload, meta) {
  Q.list.push(Object.assign({ id: tmpId(), action: action, payload: payload }, meta || {}));
  qSave();
  runQueue();
}

function runQueue() {
  if (Q.running) return Q.running;
  if (!S.token || !Q.list.length) { renderSync(); return Promise.resolve(); }
  Q.running = (async () => {
    while (Q.list.length && S.token) {
      const op = Q.list[0];
      let data;
      try {
        data = await api(op.action, op.payload, { silent: true, quiet: true });
      } catch (e) {
        if (!e.code || e.code === 'BUSY') {          // ไม่มีเน็ต / ระบบยุ่ง → รอแล้วลองใหม่
          Q.offline = !e.code;
          clearTimeout(Q.retry);
          Q.retry = setTimeout(runQueue, e.code ? 3000 : 15000);
          break;
        }
        if (e.code === 'AUTH') break;                // ใส่ PIN ใหม่แล้วค่อยส่งต่อ
        Q.list.shift(); qSave();                     // ชีทปฏิเสธจริง → ทิ้งรายการนี้ แล้วดึงข้อมูลจริงกลับมา
        toast('บันทึกไม่สำเร็จ: ' + e.message, true);
        if (op.date) await refreshDay(op.date);
        if (op.kind === 'weight') await refreshWeights();
        continue;
      }
      Q.offline = false;
      Q.list.shift(); qSave();
      onOpDone(op, data);
    }
  })().finally(() => {
    Q.running = null;
    renderSync();
    if (!Q.list.length) afterQueueDrained();
  });
  renderSync();
  return Q.running;
}

function onOpDone(op, data) {
  if (op.reloadInit) loadInit(true).catch(() => {});
  if (op.kind === 'day' && data && data.date === op.date && !pendingFor(op.date)) {
    setDay(data);
    if (S.tab === 'today' && S.date === op.date) renderToday();
  }
  if (op.kind === 'weight' && !Q.list.some(o => o.kind === 'weight')) refreshWeights();
}

function afterQueueDrained() {
  if (S.tab === 'summary') loadSummary();
}

async function refreshDay(date) {
  try { setDay(await api('getDay', { date: date }, { silent: true, quiet: true })); } catch (e) { return; }
  if (S.tab === 'today' && S.date === date) renderToday();
}

async function refreshWeights() {
  try { S.weights = await api('getWeights', { days: S.weightsRange }, { silent: true, quiet: true }); } catch (e) { return; }
  if (S.tab === 'progress') renderProgress();
}

let syncHide = null, syncWas = 0, syncDoneUntil = 0;
function renderSync() {
  let el = $('#sync');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.appendChild(el);
  }
  const n = Q.list.length;
  if (n) {
    clearTimeout(syncHide);
    syncDoneUntil = 0;
    el.hidden = false;
    el.className = 'show ' + (Q.offline ? 'off' : 'saving');
    el.innerHTML = Q.offline
      ? '<span class="sy-ico">📴</span>ออฟไลน์ · รอส่ง ' + n + ' รายการ'
      : '<span class="spinner sm" aria-hidden="true"></span>กำลังบันทึก…';
  } else if (syncWas) {                    // เพิ่งส่งเสร็จ → โชว์ "บันทึกแล้ว" แป๊บนึง
    clearTimeout(syncHide);
    el.hidden = false;
    el.className = 'show done';
    el.innerHTML = '<span class="sy-ico">✓</span>บันทึกแล้ว';
    syncDoneUntil = Date.now() + 1500;
    syncHide = setTimeout(() => {
      el.classList.remove('show');
      syncHide = setTimeout(() => { el.hidden = true; }, 220);
    }, 1500);
  } else if (Date.now() >= syncDoneUntil) {
    el.hidden = true;
  }
  syncWas = n;
}

window.addEventListener('online', () => { Q.offline = false; runQueue(); });

// ---------- แคชข้อมูลรายวัน ----------
function setDay(d) {
  S.days[d.date] = d;
  if (S.date === d.date) S.day = d;
}

function invalidateDays() {
  S.days = {};
  S.day = null;
}

function recompute(d) {
  d.total = d.logs.reduce((a, l) => a + l.kcal_total, 0);
  d.remaining = d.target != null ? d.target - d.total : null;
}

function dayTargetFromSettings(d, type) {
  const st = S.init.settings;
  return Number(d.weekday <= 5 && type !== 'home' ? st.weekday_target_kcal : st.home_day_target_kcal) || 0;
}

function bumpUsage(items, date) {
  const u = S.init.usage = S.init.usage || {};
  items.forEach(it => {
    if (!it.food_id) return;
    const x = u[it.food_id] = u[it.food_id] || { n: 0, last: '' };
    x.n++;
    if (date > x.last) x.last = date;
  });
}

/** แปลงรายการ (จากแผน/ตะกร้า) เป็นแถวบันทึกในเครื่อง */
function toLogs(slot, items, source) {
  return items.map(x => ({
    log_id: tmpId(), slot: slot, food_id: x.food_id || '', name: x.name, qty: x.qty,
    kcal_unit: x.kcal_unit, kcal_total: Math.round(x.kcal_unit * x.qty),
    source: source || (x.food_id ? 'db' : 'custom')
  }));
}

/** วันหยุดที่เริ่มบันทึกอาหาร → ตั้งเป็น "อยู่บ้าน" ให้อัตโนมัติ */
function ensureHomeDay(d) {
  if (d.weekday > 5 && !d.day_type && d.logs.length) {
    d.day_type = 'home';
    enqueue('setDayType', { date: d.date, day_type: 'home' }, { kind: 'day', date: d.date });
  }
}

/** จำมื้อที่เพิ่งบันทึก ไว้ให้การ์ดโชว์ติ๊กเขียวเด้ง */
function markSaved(date, slots) {
  S.justSaved = { date: date, slots: slots, until: Date.now() + 1200 };
}

function commitDay(d) {
  recompute(d);
  setDay(d);
  if (S.tab === 'today' && S.date === d.date) renderToday();
}

function setBusy(d) {
  busyCount = Math.max(0, busyCount + d);
  document.body.classList.toggle('is-busy', busyCount > 0);
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, isErr ? 3500 : 2200);
}

// ======================= boot / PIN =======================
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(API_URL.trim())) {
    const why = !API_URL || API_URL.indexOf('PASTE') !== -1 ? 'ยังไม่ได้ใส่ URL'
      : API_URL.indexOf('googleusercontent.com') !== -1 ? 'URL นี้เป็นหน้า redirect (echo) ไม่ใช่ URL ของ API'
      : /\/dev$/.test(API_URL) ? 'URL ลงท้าย /dev ใช้ได้เฉพาะตอนล็อกอินบัญชีเจ้าของ'
      : 'รูปแบบ URL ไม่ถูกต้อง';
    document.body.innerHTML = '<div class="setup-msg"><h1>ตั้งค่า API ไม่ถูกต้อง</h1><p>' + why + '</p>' +
      '<p>เปิด Apps Script → Deploy → Manage deployments แล้วคัดลอก Web app URL ที่ขึ้นต้นด้วย ' +
      '<code>https://script.google.com/macros/s/</code> และลงท้ายด้วย <code>/exec</code> ไปใส่ใน <code>config.js</code></p></div>';
    return;
  }
  buildKeypad();
  renderSync();
  if (!S.token) return showPin();
  try {
    await runQueue();
    await loadBundle();
    showApp();
  } catch (e) {
    if (e.code !== 'AUTH') showPin(navigator.onLine ? 'เชื่อมต่อไม่ได้ ลองใส่ PIN ใหม่' : 'ไม่มีอินเทอร์เน็ต ต่อเน็ตแล้วใส่ PIN');
  }
}

function buildKeypad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  $('#keypad').innerHTML = keys.map(k => {
    if (!k) return '<button class="blank" tabindex="-1" aria-hidden="true"></button>';
    if (k === 'del') return '<button class="del" data-act="key" data-k="del" aria-label="ลบ">⌫</button>';
    return '<button data-act="key" data-k="' + k + '">' + k + '</button>';
  }).join('');
}

function showPin(msg) {
  S.pin = '';
  $('#app').hidden = true;
  $('#pin').hidden = false;
  $('#pin-msg').textContent = msg || '';
  drawDots();
}

function drawDots() {
  $('#pin-dots').innerHTML = Array.from({ length: 6 }, (_, i) =>
    '<i class="' + (i < S.pin.length ? 'on' : '') + '"></i>').join('');
  $('#pin-dots').setAttribute('aria-label', 'ใส่แล้ว ' + S.pin.length + ' จาก 6 หลัก');
}

function pressKey(k) {
  if (busyCount) return;
  if (k === 'del') S.pin = S.pin.slice(0, -1);
  else if (S.pin.length < 6) S.pin += k;
  drawDots();
  if (S.pin.length === 6) submitPin();
}

async function submitPin() {
  $('#pin-msg').textContent = '';
  try {
    const r = await api('login', { pin: S.pin }, { silent: true, wait: 'กำลังตรวจ PIN…' });
    S.token = r.token;
    sessionStorage.setItem('ct_token', r.token);
    await runQueue();            // มีของค้างส่งจากก่อนหน้า → ส่งก่อน
    await loadBundle();
    showApp();
  } catch (e) {
    S.pin = '';
    drawDots();
    $('#pin-msg').textContent = e.message;
    const box = $('.pin-box');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  }
}

function logoutLocal(msg) {
  S.token = null;
  sessionStorage.removeItem('ct_token');
  closeSheet();
  showPin(msg);
}

async function loadInit(quiet) {
  S.init = await api('getInit', {}, quiet ? { silent: true, quiet: true } : {});
}

/** โหลดทุกอย่างในครั้งเดียวหลังใส่ PIN → สลับหน้าได้ทันทีไม่ต้องรอ */
async function loadBundle() {
  $('#pin').hidden = true;
  $('#app').hidden = false;
  view().innerHTML = skeleton(S.tab === 'settings' ? 'today' : S.tab);
  const r = await api('getBundle', { date: S.date, weight_days: S.weightsRange });
  S.init = r.init;
  setDay(r.day);
  S.weeks[r.week.week_start] = r.week;
  S.insights = r.insights;
  S.weights = r.weights;
  S.photos = r.photos;
}

// ======================= skeleton (โครงหน้าตอนโหลด) =======================
const SK = {
  bar: (w, h) => '<span class="sk" style="width:' + w + ';height:' + (h || 14) + 'px"></span>',
  card: inner => '<div class="sk-card">' + inner + '</div>'
};
function skeleton(tab) {
  const b = SK.bar;
  const slip = SK.card('<div class="sk-row"><span class="sk sk-ico"></span>' + b('38%', 18) + '<span class="sk-gap"></span>' + b('16%', 18) + '</div>' +
    b('80%') + b('62%') + '<div class="sk-row">' + b('28%', 34) + b('28%', 34) + '</div>');
  if (tab === 'today') {
    return '<section class="hero sk-hero"><div class="sk-center">' + b('34%', 26) + b('46%', 18) +
      '<span class="sk sk-plate"></span>' + b('58%', 30) + '</div></section>' +
      SK.card('<div class="sk-row">' + b('30%') + '<span class="sk-gap"></span>' + b('34%', 18) + '</div>' + b('100%', 10) + b('70%')) +
      slip + slip + slip;
  }
  if (tab === 'progress') {
    return '<section class="hero hero-sm sk-hero">' + b('40%', 30) + b('55%') + '</section>' +
      SK.card('<div class="sk-row">' + b('48%', 46) + b('48%', 46) + '</div>' + b('100%', 44)) +
      SK.card(b('30%', 18) + '<span class="sk sk-chart"></span>') + SK.card(b('100%') + b('100%') + b('100%'));
  }
  if (tab === 'summary') {
    return '<section class="hero hero-week sk-hero"><div class="sk-center">' + b('40%', 24) + b('52%') + '</div></section>' +
      SK.card('<div class="sk-row">' + b('35%') + '<span class="sk-gap"></span>' + b('40%', 26) + '</div>' + b('100%', 12) + b('80%')) +
      '<div class="stats">' + [1, 2, 3, 4].map(() => SK.card(b('55%', 26) + b('75%', 12))).join('') + '</div>' +
      SK.card([1, 2, 3, 4, 5, 6, 7].map(() => '<div class="sk-row">' + b('14%') + b('64%', 10) + b('14%') + '</div>').join(''));
  }
  return '';
}

function showApp() {
  $('#pin').hidden = true;
  $('#app').hidden = false;
  goTab(S.tab, true);
}

// ======================= navigation =======================
/** เด้งไปบนสุด (ทำซ้ำหลังวาดหน้าเสร็จ กันมือถือบางรุ่นค้างตำแหน่งเดิม) */
function toTop() {
  const go = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };
  go();
  requestAnimationFrame(() => { go(); setTimeout(go, 60); });
}

function goTab(tab, force) {
  const same = S.tab === tab;
  S.tab = tab;
  $$('#nav button').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  closeSheet();
  if (tab === 'today') loadDay(S.date);
  if (tab === 'progress') { S.wShow = 7; loadProgress(); }
  if (tab === 'summary') loadSummary();
  if (tab === 'settings') renderSettings();
  toTop();
}

// ======================= วันนี้ =======================
async function loadDay(date) {
  S.date = date;
  const cached = S.days[date];
  S.day = cached || null;
  if (cached) renderToday();
  else view().innerHTML = skeleton(S.tab);
  if (pendingFor(date)) return;                       // มีของรอส่ง ใช้ข้อมูลในเครื่องไปก่อน
  let d;
  try { d = await api('getDay', { date: date }, cached ? { silent: true, quiet: true } : {}); }
  catch (e) {
    if (!cached && S.tab === 'today' && S.date === date) view().innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    return;
  }
  if (pendingFor(date)) return;
  setDay(d);
  if (S.tab === 'today' && S.date === date) renderToday();
}

/** ดึงสรุปสัปดาห์เงียบ ๆ (ใช้กับบรรทัดงบสัปดาห์ในหน้าวันนี้) */
async function fetchWeekQuiet(date) {
  const mon = mondayOf(date);
  if (S.weekFetching[mon]) return;
  S.weekFetching[mon] = true;
  try { const w = await api('getWeek', { date: mon }, { silent: true, quiet: true }); S.weeks[w.week_start] = w; }
  catch (e) { return; } finally { S.weekFetching[mon] = false; }
  if (S.tab === 'today' && S.day && mondayOf(S.day.date) === mon) renderToday();
}

function plateSVG(total, target) {
  const r = 96, C = 2 * Math.PI * r;
  const pct = target ? Math.min(total / target, 1) : 0;
  const done = target && total >= target;
  return '<svg viewBox="0 0 220 220" class="plate' + (done ? ' done' : '') + '" aria-hidden="true">' +
    '<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#FFF4B8"/><stop offset=".45" stop-color="#FFD54A"/><stop offset="1" stop-color="#FFB300"/>' +
    '</linearGradient></defs>' +
    '<circle cx="110" cy="110" r="' + r + '" class="rim-track"/>' +
    '<circle cx="110" cy="110" r="' + r + '" class="rim-fill" stroke-dasharray="' + C.toFixed(1) +
    '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '" transform="rotate(-90 110 110)"/>' +
    '<circle cx="110" cy="110" r="80" class="plate-disk"/></svg>';
}

// ======================= แอนิเมชันจาน + พลุ =======================
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let plateAnim = null;

/** เลขในจานวิ่ง + วงแหวนหมุนเติม เมื่อแคลของวันเดียวกันเปลี่ยน, ถึงเป้าครั้งแรก → พลุ */
function animatePlate(d) {
  const prev = S.plateShown;
  const target = d.target != null ? d.target : (Number(S.init.settings.home_day_target_kcal) || 0);
  S.plateShown = { date: d.date, total: d.total, target: target, party: d.day_type === 'party' };
  if (!prev || prev.date !== d.date || prev.party || d.day_type === 'party' || prev.total === d.total) return;

  const svg = $('.plate'), num = $('.plate-total'), ring = $('.rim-fill');
  if (!svg || !num || !ring) return;
  const crossed = target > 0 && prev.total < target && d.total >= target;
  if (reduceMotion()) { if (crossed) celebrate(); return; }

  const C = 2 * Math.PI * 96;
  const pct = v => (target ? Math.min(v / target, 1) : 0);
  const to = ring.getAttribute('stroke-dashoffset');
  ring.style.transition = 'none';
  ring.setAttribute('stroke-dashoffset', (C * (1 - pct(prev.total))).toFixed(1));
  if (crossed) svg.classList.remove('done');
  void ring.getBoundingClientRect();
  ring.style.transition = '';
  requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', to));

  cancelAnimationFrame(plateAnim);
  const from = prev.total, end = d.total, t0 = performance.now(), dur = 900;
  const step = now => {
    const t = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    num.textContent = fmtN(from + (end - from) * e);
    if (t < 1) plateAnim = requestAnimationFrame(step);
    else if (crossed) { svg.classList.add('done', 'just-done'); celebrate(); }
  };
  num.classList.add('counting');
  plateAnim = requestAnimationFrame(step);
  setTimeout(() => num.classList.remove('counting'), dur);
}

/** คอนเฟตติ (canvas เต็มจอ ~2.5 วิ) */
function celebrate() {
  toast('🎉 ถึงเป้าวันนี้แล้ว!');
  if (reduceMotion()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  document.body.appendChild(cv);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const ctx = cv.getContext('2d');
  const colors = ['#E8461F', '#F2711C', '#F9A826', '#FFD54A', '#16A34A', '#4F46E5', '#FF5C8A'];
  const plate = $('.plate'), r = plate ? plate.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
  const ox = (r.left + r.width / 2) * dpr, oy = (r.top + r.height / 2) * dpr;
  const parts = Array.from({ length: 140 }, () => {
    const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.3, v = (7 + Math.random() * 10) * dpr;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: (5 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
      rot: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)], round: Math.random() < .3 };
  });
  const t0 = performance.now();
  const frame = now => {
    const el = now - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = el > 1800 ? Math.max(0, 1 - (el - 1800) / 700) : 1;
    parts.forEach(p => {
      p.vy += .32 * dpr; p.vx *= .985; p.vy *= .985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 2);
      ctx.restore();
    });
    if (el < 2500) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}

function renderToday() {
  const d = S.day;
  if (!d) return;
  const today = todayISO();
  const isToday = d.date === today;

  const head = '<header class="day-head">' +
    '<button class="icon-btn" data-act="day-go" data-d="-1" aria-label="วันก่อนหน้า">‹</button>' +
    '<div><h1>' + (isToday ? 'วันนี้' : 'วัน' + WD_LONG[d.weekday]) + '</h1>' +
    '<div class="day-sub"><button class="date-btn" data-act="cal-open" data-mode="day" aria-label="เลือกวันจากปฏิทิน">' +
    esc(thDate(d.date, { day: 'numeric', month: 'long' })) + '</button>' +
    (d.plan ? '<span class="plan-chip">แผน ' + esc(d.plan) + '</span>' : '<span class="plan-chip">วันหยุด</span>') + '</div></div>' +
    '<button class="icon-btn" data-act="day-go" data-d="1" aria-label="วันถัดไป"' + (d.date >= today ? ' disabled' : '') + '>›</button>' +
    '</header>' +
    (isToday ? '' : '<button class="link-btn back-today" data-act="day-today">กลับไปวันนี้</button>');

  const isParty = d.day_type === 'party';
  const seg = '<button class="party-toggle" data-act="party-toggle" aria-pressed="' + isParty + '">🍻 ' +
    (isToday ? 'วันนี้' : 'วันนั้น') + 'ไปปาร์ตี้' + (isParty ? ' (แตะเพื่อยกเลิก)' : '') + '</button>';

  let hero = '';
  if (d.day_type === 'party') {
    hero = '<div class="day-card"><div class="big">🍻</div><h2>วันปาร์ตี้</h2>' +
      '<p>ไม่ต้องบันทึกอะไร ระบบไม่เอาวันนี้ไปคิดค่าเฉลี่ย</p></div>';
  } else {
    const target = d.target != null ? d.target : (Number(S.init.settings.home_day_target_kcal) || 0);
    const rem = target - d.total;
    const note = rem > 0
      ? '<div class="plate-actions"><p class="plate-note">ยังขาดอีก <b class="num">' + fmtN(rem) + '</b> kcal</p>' +
        '<button class="fill-btn" data-act="fill-open">💡 เติมอะไรดี?</button></div>'
      : '<div class="plate-actions"><p class="plate-note ok">' + (rem === 0 ? '🎉 ถึงเป้าพอดี' : '🎉 ถึงเป้าแล้ว เกินมา <b class="num">' + fmtN(-rem) + '</b>') + '</p></div>';
    hero = '<div class="plate-wrap">' + plateSVG(d.total, target) +
      '<div class="plate-center"><div class="plate-total num">' + fmtN(d.total) + '</div>' +
      '<div class="plate-sub">จาก ' + fmtN(target) + ' kcal</div></div></div>' + note;
  }
  const below = weekLineHTML(d) +
    (!isParty && d.plan && d.planned_total ? '<p class="plan-hint">กินตามแผน ' + esc(d.plan) + ' ครบ จะได้ประมาณ <b class="num">' + fmtN(d.planned_total) + '</b> kcal</p>' : '');

  let slips = '';
  if (!isParty) {
    const unlogged = Object.keys(d.planned).filter(s => !d.logs.some(l => l.slot === s));
    if (unlogged.length > 1) {
      slips += '<button class="btn btn-ok plan-all" data-act="plan-day">กินตามแผนทุกมื้อที่เหลือ</button>';
    }
    slips += d.slots.map(slot => slipHTML(slot, d)).join('');
  }

  view().innerHTML = '<section class="hero">' + head + seg + hero + '</section>' + below + slips;
  animatePlate(d);
  S.justSaved = null;          // ติ๊กเขียวเด้งแค่ครั้งเดียว
}

function slotIcon(slot) {
  return ({ 'เช้า': '🌅', 'สาย': '🥐', 'เที่ยง': '🍛', 'บ่าย': '🧋', 'ว่างบ่าย': '🧋', 'เย็น': '🍲', 'ดึก': '🌙', 'ก่อนนอน': '🌙', 'เสริม': '🥛' })[slot] || '🍽️';
}

function slipHTML(slot, d) {
  const logs = d.logs.filter(l => l.slot === slot);
  const planned = d.planned[slot] || [];
  const logged = logs.length > 0;
  const sum = logs.reduce((a, l) => a + l.kcal_total, 0);
  const pSum = planned.reduce((a, x) => a + x.kcal_total, 0);
  const fromPlan = logged && logs.every(l => l.source === 'plan');
  const s = esc(slot);

  let body;
  if (logged) {
    body = '<ul class="items">' + logs.map(l =>
      '<li><span>' + esc(l.name) + qtyText(l.qty) + '</span><span class="num">' + fmtN(l.kcal_total) + '</span>' +
      '<button class="x" data-act="del-log" data-id="' + esc(l.log_id) + '" aria-label="ลบ ' + esc(l.name) + '">✕</button></li>'
    ).join('') + '</ul>';
  } else if (planned.length) {
    body = '<ul class="items planned">' + planned.map(p =>
      '<li><span>' + esc(p.name) + (p.qty === 1 ? '' : ' ×' + p.qty) + '</span><span class="num">' + fmtN(p.kcal_total) + '</span></li>'
    ).join('') + '</ul>';
  } else {
    body = '<p class="muted small">ยังไม่ได้บันทึก</p>';
  }

  const right = logged
    ? '<span class="slip-kcal num">' + fmtN(sum) + '</span>'
    : (planned.length ? '<span class="muted small">ตามแผน ~' + fmtN(pSum) + '</span>' : '');

  const actions = [];
  if (!logged && planned.length) actions.push('<button class="btn btn-ok" data-act="plan-slot" data-slot="' + s + '">กินตามแผน</button>');
  actions.push('<button class="btn btn-ghost" data-act="change-slot" data-slot="' + s + '">' + (logged ? 'แก้มื้อนี้' : 'กินอย่างอื่น') + '</button>');
  if (logged) actions.push('<button class="btn btn-ghost" data-act="add-slot" data-slot="' + s + '">เพิ่ม</button>');

  const js = S.justSaved;
  const pop = js && js.date === d.date && js.slots.indexOf(slot) !== -1 && Date.now() < js.until;
  return '<article class="slip' + (logged ? ' is-done' : '') + (pop ? ' pop' : '') + '">' +
    (pop ? '<span class="slip-check" aria-hidden="true">✓</span>' : '') +
    '<header class="slip-head"><span class="slip-ico" aria-hidden="true">' + slotIcon(slot) + '</span>' +
    '<h3>' + s + (fromPlan ? ' <span class="src-tag">ตามแผน</span>' : (logged ? ' <span class="src-tag">✓</span>' : '')) + '</h3>' + right + '</header>' +
    body + '<div class="slip-actions">' + actions.join('') + '</div></article>';
}

async function toggleParty() {
  const d = S.day;
  const toParty = d.day_type !== 'party';
  if (toParty && d.logs.length && !confirm('วันนี้มีบันทึกอาหารอยู่ ถ้าเป็นวันปาร์ตี้จะไม่ถูกนับในค่าเฉลี่ย ตกลงไหม?')) return;
  const next = toParty ? 'party' : (d.weekday > 5 ? 'home' : 'normal');
  d.day_type = next;
  d.target = toParty ? null : dayTargetFromSettings(d, next);
  commitDay(d);
  enqueue('setDayType', { date: d.date, day_type: next }, { kind: 'day', date: d.date });
}

// ======================= ตัวเลือกเมนู (picker) =======================
const SORTS = [['freq', 'กินบ่อยสุด'], ['recent', 'กินล่าสุด'], ['least', 'กินน้อยสุด / ไม่เคยกิน'],
  ['az', 'ก–ฮ'], ['kcal_desc', 'แคลมาก → น้อย'], ['kcal_asc', 'แคลน้อย → มาก']];

function openPicker(opt) {
  const sort = SORTS.some(x => x[0] === S.init.settings.food_sort) ? S.init.settings.food_sort : 'freq';
  P = Object.assign({ q: '', cat: 'fav', sort: sort, cart: [], custom: false, customName: '' }, opt);
  openSheet(opt.title,
    '<input class="search" type="search" placeholder="ค้นหาเมนู เช่น กะเพรา" data-input="pk-q" aria-label="ค้นหาเมนู" autocomplete="off">' +
    '<div class="row2 pk-cat-field"><label class="field"><span>หมวด</span><select id="pk-cats" data-input="pk-cat" aria-label="เลือกหมวด"></select></label>' +
    '<label class="field"><span>เรียงตาม</span><select id="pk-sort" data-input="pk-sort" aria-label="เรียงตาม">' +
    SORTS.map(x => '<option value="' + x[0] + '"' + (x[0] === P.sort ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
    '</select></label></div>' +
    '<ul class="food-list" id="pk-list"></ul>' +
    (P.mode === 'plan' ? '' : '<div id="pk-custom"></div>') +
    '<div class="cart" id="pk-cart"></div>');
  renderPicker();
}

function pickerFoods() {
  const q = P.q.trim().toLowerCase();
  let list = S.init.foods.filter(f => f.active);
  if (q) list = list.filter(f => f.name.toLowerCase().indexOf(q) !== -1);
  else if (P.cat === 'fav') list = list.filter(f => f.favorite);
  else if (P.cat !== 'all') list = list.filter(f => f.category === P.cat);
  return sortFoods(list, P.sort);
}

function sortFoods(list, sort) {
  const u = S.init.usage || {};
  const n = f => (u[f.id] ? u[f.id].n : 0);
  const last = f => (u[f.id] ? u[f.id].last : '');
  const az = (a, b) => a.name.localeCompare(b.name, 'th');
  const cmp = {
    fav: (a, b) => (b.favorite - a.favorite) || az(a, b),
    freq: (a, b) => (n(b) - n(a)) || az(a, b),
    recent: (a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : 0) || az(a, b),
    least: (a, b) => (n(a) - n(b)) || az(a, b),
    az: az,
    kcal_desc: (a, b) => (b.kcal - a.kcal) || az(a, b),
    kcal_asc: (a, b) => (a.kcal - b.kcal) || az(a, b)
  }[sort] || az;
  return list.sort(cmp);
}

function usageMeta(f, sort) {
  const x = (S.init.usage || {})[f.id];
  if (['freq', 'recent', 'least'].indexOf(sort || (P && P.sort)) === -1) return '';
  return x ? ' | กินแล้ว ' + x.n + ' ครั้ง ล่าสุด ' + thDate(x.last) : ' | ยังไม่เคยกิน';
}

function categories() {
  const seen = [];
  S.init.foods.forEach(f => { if (f.active && seen.indexOf(f.category) === -1) seen.push(f.category); });
  return seen;
}

function renderPicker() {
  const cats = [['fav', '⭐ โปรด'], ['all', 'ทั้งหมด']].concat(categories().map(c => [c, c]));
  const count = c => S.init.foods.filter(f => f.active && (c === 'all' || (c === 'fav' ? f.favorite : f.category === c))).length;
  $('#pk-cats').innerHTML = cats.map(c =>
    '<option value="' + esc(c[0]) + '"' + (P.cat === c[0] ? ' selected' : '') + '>' + esc(c[1]) + ' (' + count(c[0]) + ')</option>'
  ).join('');
  $('#pk-cats').disabled = !!P.q.trim();

  const list = pickerFoods();
  const inCart = P.cart.filter(c => c.food_id).map(c => c.food_id);
  $('#pk-list').innerHTML = list.length
    ? list.map(f =>
      '<li><button class="food-row' + (inCart.indexOf(f.id) !== -1 ? ' in-cart' : '') + '" data-act="pk-add" data-id="' + esc(f.id) + '">' +
      '<span>' + esc(f.name) + '<span class="meta">ต่อ 1 ' + esc(f.unit) + (f.note ? ' | ' + esc(f.note) : '') + esc(usageMeta(f)) + '</span></span>' +
      '<span class="k num">' + fmtN(f.kcal) + '</span></button></li>').join('')
    : '<li class="empty">ไม่เจอ "' + esc(P.q) + '" ในคลัง' +
      (P.mode === 'plan' ? '' : '<br><button class="link-btn" data-act="pk-custom-open">เพิ่มเป็นเมนูใหม่</button>') + '</li>';

  renderCustom();
  renderCart();
}

function renderCustom() {
  const box = $('#pk-custom');
  if (!box) return;
  if (!P.custom) {
    box.innerHTML = '<button class="link-btn" data-act="pk-custom-open">+ เมนูที่ไม่มีในคลัง</button>';
    return;
  }
  const cats = categories();
  box.innerHTML = '<div class="custom-box">' +
    '<label class="field"><span>ชื่อเมนู</span><input id="ck-name" value="' + esc(P.customName) + '" placeholder="เช่น ข้าวผัดพริกแกงหมู"></label>' +
    '<div class="row2"><label class="field"><span>kcal ต่อหน่วย</span><input id="ck-kcal" type="number" inputmode="numeric" min="0"></label>' +
    '<label class="field"><span>หน่วย</span><input id="ck-unit" value="จาน"></label></div>' +
    '<div class="row2"><label class="field"><span>หมวด</span><select id="ck-cat">' +
    cats.map(c => '<option' + (c === 'จานหลัก' ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '</select></label><label class="field"><span>จำนวน</span><input id="ck-qty" type="number" inputmode="decimal" min="0.5" step="any" value="1"></label></div>' +
    '<label class="check"><input type="checkbox" id="ck-save" checked> บันทึกเข้าคลังด้วย ครั้งหน้าจะได้กดเลือก</label>' +
    '<p class="muted small">ไม่รู้แคล ลองเทียบกับเมนูที่ใกล้เคียงในคลัง ถ้าเป็นของแพ็กดูจากฉลาก</p>' +
    '<button class="btn btn-ghost btn-block" data-act="pk-custom-add">ใส่ลงรายการ</button></div>';
}

function renderCart() {
  const total = P.cart.reduce((a, c) => a + c.kcal_unit * c.qty, 0);
  const label = P.mode === 'plan' ? 'บันทึกแผน' : P.mode === 'add' ? 'เพิ่มเข้ามื้อ' + P.slot : 'บันทึกมื้อ' + P.slot;
  const emptyLabel = P.mode === 'plan' ? 'ล้างมื้อนี้ในแผน' : (P.mode === 'replace' && P.hadLogs ? 'ล้างมื้อนี้' : 'เลือกเมนูก่อน');
  $('#pk-cart').innerHTML =
    (P.cart.length
      ? '<ul>' + P.cart.map((c, i) =>
        '<li><span>' + esc(c.name) + '</span><span class="step">' +
        '<button data-act="pk-qty" data-i="' + i + '" data-d="-1" aria-label="ลด">−</button><span class="num">' + c.qty + '</span>' +
        '<button data-act="pk-qty" data-i="' + i + '" data-d="1" aria-label="เพิ่ม">+</button></span>' +
        '<span class="num">' + fmtN(c.kcal_unit * c.qty) + '</span></li>').join('') + '</ul>'
      : '<p class="muted small">แตะเมนูด้านบนเพื่อเลือก เลือกได้หลายอย่าง' +
        (P.planned && P.planned.length ? '<br><button class="link-btn" data-act="pk-use-plan">หรือใช้เมนูตามแผนมาแก้ต่อ</button>' : '') + '</p>') +
    '<div class="cart-total"><span>รวม</span><span class="num">' + fmtN(total) + ' kcal</span></div>' +
    '<button class="btn btn-block" data-act="pk-save"' + (!P.cart.length && (P.mode === 'add' || (P.mode === 'replace' && !P.hadLogs)) ? ' disabled' : '') + '>' +
    esc(P.cart.length ? label : emptyLabel) + '</button>';
}

function pickerAdd(id) {
  const f = S.init.foods.find(x => x.id === id);
  if (!f) return;
  const ex = P.cart.find(c => c.food_id === id);
  if (ex) ex.qty += 1;
  else P.cart.push({ food_id: f.id, name: f.name, kcal_unit: f.kcal, qty: 1 });
  renderPicker();
}

function pickerQty(i, d) {
  const c = P.cart[i];
  c.qty = Math.round((c.qty + d) * 100) / 100;
  if (c.qty < 1) P.cart.splice(i, 1);          // เหลือน้อยกว่า 1 → เอาออกจากรายการ
  renderPicker();
}

function pickerCustomAdd() {
  const name = $('#ck-name').value.trim();
  const kcal = Number($('#ck-kcal').value);
  const qty = Number($('#ck-qty').value) || 1;
  if (!name) return toast('ใส่ชื่อเมนูก่อน', true);
  if (!($('#ck-kcal').value !== '' && kcal >= 0)) return toast('ใส่ kcal ก่อน', true);
  P.cart.push({
    name: name, kcal_unit: kcal, qty: qty, custom: true,
    unit: $('#ck-unit').value.trim() || 'ที่', category: $('#ck-cat').value, save_to_db: $('#ck-save').checked
  });
  P.custom = false; P.customName = '';
  renderPicker();
}

async function pickerSave() {
  const items = P.cart.map(c => c.food_id
    ? { food_id: c.food_id, qty: c.qty }
    : { name: c.name, kcal: c.kcal_unit, qty: c.qty, unit: c.unit, category: c.category, save_to_db: !!c.save_to_db });
  try {
    if (P.mode === 'plan') {
      const r = await api('updatePlanSlot', { plan: P.plan, weekday: P.weekday, slot: P.slot, items: items }, { wait: 'กำลังบันทึกแผน…' });
      S.init.plans = r.plans;
      invalidateDays();
      closeSheet();
      renderSettings();
      toast('บันทึกแผนแล้ว ✓');
    } else {
      const d = S.days[P.date] || S.day;
      const slot = P.slot, date = P.date, mode = P.mode;
      if (mode === 'replace') d.logs = d.logs.filter(l => l.slot !== slot);
      d.logs = d.logs.concat(toLogs(slot, P.cart));
      bumpUsage(P.cart, date);
      enqueue(mode === 'add' ? 'addLog' : 'replaceSlot', { date: date, slot: slot, items: items },
        { kind: 'day', date: date, reloadInit: items.some(i => i.save_to_db) });
      ensureHomeDay(d);
      closeSheet();
      if (items.length) markSaved(date, [slot]);
      commitDay(d);
    }
  } catch (e) { /* toast แสดงแล้ว */ }
}

// ======================= ตัวช่วยเติมแคล =======================
function openFill() {
  const d = S.day;
  const rem = (d.target || 0) - d.total;
  // ใส่ลง "เสริม" เป็นค่าเริ่มต้น (ไม่ไปทับมื้อที่มีแผนรอกินอยู่) ถึงไม่มีในตั้งค่าก็สร้างใบให้เอง
  const slots = d.slots.slice();
  if (slots.indexOf('เสริม') === -1) slots.push('เสริม');
  const defSlot = 'เสริม';
  const unlogged = Object.keys(d.planned || {}).filter(s => !d.logs.some(l => l.slot === s));
  const planLeft = unlogged.reduce((a, s) => a + d.planned[s].reduce((b, x) => b + x.kcal_total, 0), 0);
  const gap = rem - planLeft;

  let html = '';
  if (planLeft > 0) {
    html += '<p class="fill-plan">ยังมีมื้อตามแผนที่ยังไม่ได้กิน <b>' + unlogged.map(esc).join(', ') + '</b> (~' + fmtN(planLeft) + ' kcal)' +
      (gap <= 0 ? '<br>กินตามแผนให้ครบก็ถึงเป้าแล้ว 👍' : '<br>กินตามแผนแล้วยังขาดอีก ~<b class="num">' + fmtN(gap) + '</b> kcal') + '</p>';
  }
  if (gap <= 0) { openSheet('เติมให้ครบ', html); return; }

  S.fillOpts = fillOptions(gap);
  html += '<p class="muted small">ขาด ~' + fmtN(gap) + ' kcal ลองชุดนี้ (เลือกจากของในคลังที่กินบ่อย/ติดดาว)</p>' +
    '<label class="field"><span>ใส่ลงมื้อ</span><select id="fill-slot">' +
    slots.map(s => '<option' + (s === defSlot ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label>';
  html += S.fillOpts.length
    ? S.fillOpts.map((o, i) => '<div class="fill-opt"><div><b>' + o.items.map(x => esc(x.name) + (x.qty > 1 ? ' ×' + x.qty : '')).join(' + ') +
        '</b><span class="muted small"> ≈ ' + fmtN(o.total) + ' kcal</span></div>' +
        '<button class="btn" data-act="fill-add" data-i="' + i + '">ใส่</button></div>').join('')
    : '<p class="empty">ยังไม่มีของว่าง/เครื่องดื่ม/ผลไม้ในคลังที่เหมาะ ลองเพิ่มในคลังเมนูก่อน</p>';
  openSheet('เติมให้ครบ', html);
}

/** หาชุดของว่าง 1–2 อย่าง (อย่างละ 1–3) ที่แคลใกล้ส่วนที่ขาด */
function fillOptions(gap) {
  const u = S.init.usage || {};
  const skip = gap >= 600 ? ['ท็อปปิ้ง'] : ['จานหลัก', 'ท็อปปิ้ง'];
  const pref = f => (f.favorite ? 30 : 0) + Math.min((u[f.id] ? u[f.id].n : 0) * 5, 50);
  const cands = S.init.foods.filter(f => f.active && f.kcal >= 50 && skip.indexOf(f.category) === -1)
    .sort((a, b) => pref(b) - pref(a)).slice(0, 15);
  const combos = [];
  const push = items => {
    const total = items.reduce((a, x) => a + x.f.kcal * x.qty, 0);
    if (total < gap * 0.85 || total > gap + 300) return;
    const qtyPen = items.reduce((a, x) => a + (x.qty - 1) * 15, 0);
    const score = (total < gap ? (gap - total) * 2 : total - gap) + qtyPen - items.reduce((a, x) => a + pref(x.f), 0) / items.length;
    combos.push({ score: score, total: total, items: items.map(x => ({ food_id: x.f.id, name: x.f.name, kcal_unit: x.f.kcal, qty: x.qty })) });
  };
  cands.forEach((a, i) => {
    for (let qa = 1; qa <= 3; qa++) {
      push([{ f: a, qty: qa }]);
      cands.slice(i + 1).forEach(b => { for (let qb = 1; qb <= 2; qb++) push([{ f: a, qty: qa }, { f: b, qty: qb }]); });
    }
  });
  combos.sort((a, b) => a.score - b.score);
  const out = [], seen = {};
  combos.forEach(c => {
    const key = c.items.map(x => x.food_id).sort().join('+');
    if (out.length < 3 && !seen[key]) { seen[key] = 1; out.push(c); }
  });
  return out;
}

function addFill(i) {
  const o = S.fillOpts[i];
  if (!o) return;
  const d = S.day;
  const slot = $('#fill-slot').value;
  if (d.slots.indexOf(slot) === -1) d.slots.push(slot);
  d.logs = d.logs.concat(toLogs(slot, o.items));
  bumpUsage(o.items, d.date);
  enqueue('addLog', { date: d.date, slot: slot, items: o.items.map(x => ({ food_id: x.food_id, qty: x.qty })) }, { kind: 'day', date: d.date });
  ensureHomeDay(d);
  closeSheet();
  markSaved(d.date, [slot]);
  commitDay(d);
}

// ======================= น้ำหนัก + รูป =======================
async function loadProgress() {
  const cached = !!S.weights;
  if (!cached) view().innerHTML = skeleton(S.tab);
  else renderProgress();
  if (Q.list.some(o => o.kind === 'weight')) return;
  try {
    const o = cached ? { silent: true, quiet: true } : {};
    const r = await Promise.all([api('getWeights', { days: S.weightsRange }, o), api('listPhotos', {}, o)]);
    S.weights = r[0]; S.photos = r[1];
  } catch (e) { return; }
  if (S.tab === 'progress') renderProgress();
}

function weightChart(ws) {
  if (ws.length < 2) return '<p class="empty">ชั่งน้ำหนักอย่างน้อย 2 วัน กราฟจะขึ้นตรงนี้</p>';
  const W = 340, H = 180, pl = 34, pr = 8, pt = 10, pb = 22;
  const t0 = parseISO(ws[0].date).getTime(), t1 = parseISO(ws[ws.length - 1].date).getTime();
  const span = Math.max(t1 - t0, 86400000);
  const vals = [];
  ws.forEach(w => { vals.push(w.weight_kg); if (w.avg7 != null) vals.push(w.avg7); });
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  lo -= 0.2; hi += 0.2;
  const x = d => pl + (parseISO(d).getTime() - t0) / span * (W - pl - pr);
  const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);

  let g = '';
  [hi - 0.2, (hi + lo) / 2, lo + 0.2].forEach(v => {
    g += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
      '<text class="lbl" x="' + (pl - 5) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
  });
  const avg = ws.filter(w => w.avg7 != null).map(w => x(w.date).toFixed(1) + ',' + y(w.avg7).toFixed(1)).join(' ');
  const dots = ws.map(w => '<circle cx="' + x(w.date).toFixed(1) + '" cy="' + y(w.weight_kg).toFixed(1) + '" r="3.2" class="' +
    (w.flag === 'post_party' ? 'dot-party' : 'dot') + '"/>').join('');
  const dl = '<text class="lbl" x="' + pl + '" y="' + (H - 5) + '">' + esc(thDate(ws[0].date)) + '</text>' +
    '<text class="lbl" x="' + (W - pr) + '" y="' + (H - 5) + '" text-anchor="end">' + esc(thDate(ws[ws.length - 1].date)) + '</text>';

  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="กราฟน้ำหนัก">' + g + dl +
    '<polyline class="avg" points="' + avg + '"/>' + dots + '</svg>' +
    '<div class="legend"><span><i class="lg-dot"></i>น้ำหนักจริง</span><span><i class="lg-line"></i>เฉลี่ย 7 วัน</span>' +
    '<span><i class="lg-party"></i>วันหลังปาร์ตี้ (ไม่นับ)</span></div>';
}

function wDateHTML() {
  return '<button class="icon-btn" data-act="w-date" data-d="-1" aria-label="วันก่อนหน้า">‹</button>' +
    '<b>' + esc(S.wDate === todayISO() ? 'วันนี้' : thFull(S.wDate)) + '</b>' +
    '<button class="icon-btn" data-act="w-date" data-d="1" aria-label="วันถัดไป"' + (S.wDate >= todayISO() ? ' disabled' : '') + '>›</button>';
}

function renderProgress() {
  if (!S.wDate || S.wDate > todayISO()) S.wDate = todayISO();
  const ws = S.weights || [];
  const onDate = ws.find(w => w.date === S.wDate);
  const last = onDate || ws[ws.length - 1];
  const photos = S.photos || [];

  const gallery = photos.length
    ? '<div class="gallery">' + photos.map(p => {
      const src = S.photoCache[p.file_id + ':thumb'];
      return '<button class="ph' + (S.compareSel.indexOf(p.file_id) !== -1 ? ' sel' : '') + '" data-act="ph-open" data-id="' + esc(p.file_id) + '">' +
        (src ? '<img alt="" src="' + src + '">' : '<img alt="" data-thumb="' + esc(p.file_id) + '">') +
        '<span class="cap">' + esc(thDate(p.date)) + (p.weight_kg ? ' | ' + fmtKg(p.weight_kg) + ' กก.' : '') + '</span></button>';
    }).join('') + '</div>'
    : '<p class="empty">ยังไม่มีรูป ถ่ายเก็บไว้เดือนละครั้งก็พอ จะเห็นความต่างชัดกว่าดูทุกวัน</p>';

  view().innerHTML =
    '<section class="hero hero-sm"><h1 class="view-title">⚖️ น้ำหนัก</h1>' +
    '<p class="hero-sub">' + (ws.length ? 'ล่าสุด <b class="num">' + fmtKg(ws[ws.length - 1].weight_kg) + '</b> กก. · ' + esc(thDate(ws[ws.length - 1].date)) : 'ยังไม่มีข้อมูล เริ่มชั่งได้เลย') + '</p></section>' +
    '<section class="weigh"><div class="row2">' +
    '<label class="field"><span>น้ำหนัก (กก.)</span><input id="w-kg" type="number" inputmode="decimal" step="0.1" min="20" max="300" value="' + (last ? last.weight_kg : '') + '"></label>' +
    '<div class="field"><span>วันที่</span><div class="date-step" id="w-date">' + wDateHTML() + '</div></div></div>' +
    '<button class="btn btn-block" data-act="w-save">บันทึกน้ำหนัก</button>' +
    '<p class="muted small">ชั่งตอนเช้าหลังเข้าห้องน้ำ ก่อนกินอะไร ตัวเลขจะเทียบกันได้แม่นสุด</p></section>' +

    '<section><div class="sec-head"><h2>แนวโน้ม</h2><div class="chips">' +
    [30, 90, 180].map(n => '<button class="chip" data-act="w-range" data-days="' + n + '" aria-pressed="' + (S.weightsRange === n) + '">' + n + ' วัน</button>').join('') +
    '</div></div>' + weightChart(ws) + '</section>' +

    '<section><h2>รูป progress</h2><div class="ph-actions">' +
    '<button class="btn" data-act="ph-pick">ถ่ายหรือเลือกรูป</button>' +
    (photos.length >= 2 ? '<button class="btn btn-ghost" data-act="ph-compare" aria-pressed="' + S.compareMode + '">' + (S.compareMode ? 'ยกเลิกการเทียบ' : 'เทียบ 2 รูป') + '</button>' : '') +
    '<input type="file" id="ph-file" accept="image/*" hidden></div>' +
    (S.compareMode ? '<p class="muted small">แตะเลือก 2 รูปที่อยากเทียบ</p>' : '') + gallery + '</section>' +

    '<section><h2>บันทึกล่าสุด</h2>' + (ws.length
      ? '<ul class="wlist">' + ws.slice(-(S.wShow || 7)).reverse().map(w =>
        '<li><span>' + esc(thDate(w.date, { weekday: 'short', day: 'numeric', month: 'short' })) +
        (w.flag === 'post_party' ? '<span class="flag">หลังปาร์ตี้</span>' : '') + '</span>' +
        '<span class="num">' + fmtKg(w.weight_kg) + ' กก.</span>' +
        '<button class="x" data-act="w-del" data-date="' + w.date + '" aria-label="ลบน้ำหนักวันที่ ' + w.date + '">✕</button></li>').join('') + '</ul>' +
        (ws.length > (S.wShow || 7) ? '<button class="link-btn" data-act="w-more">ดูเพิ่มอีก 7 รายการ</button>' : '')
      : '<p class="empty">ยังไม่มีข้อมูล เริ่มชั่งพรุ่งนี้เช้าได้เลย</p>') + '</section>';

  $('#ph-file').addEventListener('change', onPhotoFile);
  loadThumbs();
}

async function saveWeight() {
  const kg = Number($('#w-kg').value);
  const date = S.wDate;
  if (!(kg >= 20 && kg <= 300)) return toast('ใส่น้ำหนักให้ถูกต้อง', true);
  const prev = S.days[addDays(date, -1)];
  const flag = prev && prev.day_type === 'party' ? 'post_party' : '';
  const ws = (S.weights || []).filter(w => w.date !== date);
  const old = (S.weights || []).find(w => w.date === date);
  ws.push({ date: date, weight_kg: kg, flag: flag, note: '', avg7: old ? old.avg7 : null });
  ws.sort((a, b) => (a.date < b.date ? -1 : 1));
  S.weights = ws;
  enqueue('logWeight', { date: date, weight_kg: kg }, { kind: 'weight' });
  renderProgress();
  if (flag) toast('วันหลังปาร์ตี้ น้ำหนักวันนี้ไม่นับเทียบ');
}

async function loadThumbs() {
  const imgs = $$('img[data-thumb]');
  for (const img of imgs) {
    const id = img.dataset.thumb;
    const key = id + ':thumb';
    if (!S.photoCache[key]) {
      try {
        const r = await api('getPhoto', { file_id: id, size: 'thumb' }, { silent: true });
        S.photoCache[key] = 'data:' + r.mime + ';base64,' + r.data;
      } catch (e) { continue; }
    }
    const el = $('img[data-thumb="' + id + '"]');
    if (el) { el.src = S.photoCache[key]; el.removeAttribute('data-thumb'); }
  }
}

async function getFullPhoto(id) {
  const key = id + ':full';
  if (!S.photoCache[key]) {
    const r = await api('getPhoto', { file_id: id, size: 'full' }, { wait: 'กำลังโหลดรูป…' });
    S.photoCache[key] = 'data:' + r.mime + ';base64,' + r.data;
  }
  return S.photoCache[key];
}

function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้ ลองเลือกรูป JPG หรือ PNG')); };
    img.src = url;
  });
}

async function onPhotoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await withWait('กำลังอัปโหลดรูป…', async () => {
      const data = await resizeImage(file, 1280, 0.82);
      await api('uploadPhoto', { date: todayISO(), data: data, mime: 'image/jpeg' }, { quiet: true });
      S.photos = await api('listPhotos', {}, { quiet: true });
    });
    toast('อัปโหลดรูปแล้ว ✓');
    renderProgress();
  } catch (err) {
    if (!err.code) toast(err.message, true);
  }
}

async function openPhoto(id) {
  if (S.compareMode) {
    const i = S.compareSel.indexOf(id);
    if (i !== -1) S.compareSel.splice(i, 1);
    else S.compareSel.push(id);
    if (S.compareSel.length === 2) return openCompare();
    return renderProgress();
  }
  const p = S.photos.find(x => x.file_id === id);
  openSheet(thDate(p.date, { day: 'numeric', month: 'long' }), '<p class="empty">กำลังโหลดรูป…</p>');
  try {
    const src = await getFullPhoto(id);
    $('#sheet-body').innerHTML = '<div class="viewer"><img alt="รูป progress วันที่ ' + esc(p.date) + '" src="' + src + '"></div>' +
      (p.weight_kg ? '<p class="diff-line">' + fmtKg(p.weight_kg) + ' กก.</p>' : '') +
      '<button class="btn btn-danger btn-block" style="margin-top:14px" data-act="ph-del" data-id="' + esc(id) + '">ลบรูปนี้</button>';
  } catch (e) { closeSheet(); }
}

async function openCompare() {
  const ps = S.compareSel.map(id => S.photos.find(x => x.file_id === id))
    .sort((a, b) => a.date < b.date ? -1 : 1);
  openSheet('เทียบรูป', '<p class="empty">กำลังโหลดรูป…</p>');
  try {
    const srcs = await Promise.all(ps.map(p => getFullPhoto(p.file_id)));
    const days = Math.round((parseISO(ps[1].date) - parseISO(ps[0].date)) / 86400000);
    const diff = ps[0].weight_kg && ps[1].weight_kg ? ps[1].weight_kg - ps[0].weight_kg : null;
    $('#sheet-body').innerHTML = '<div class="compare">' + ps.map((p, i) =>
      '<figure><img alt="" src="' + srcs[i] + '"><figcaption>' + esc(thDate(p.date, { day: 'numeric', month: 'short', year: '2-digit' })) +
      (p.weight_kg ? '<br><b>' + fmtKg(p.weight_kg) + ' กก.</b>' : '') + '</figcaption></figure>').join('') + '</div>' +
      '<p class="diff-line">ห่างกัน ' + days + ' วัน' + (diff != null ? (diff >= 0 ? ' ขึ้น +' : ' ลง ') + diff.toFixed(1) + ' กก.' : '') + '</p>';
  } catch (e) { closeSheet(); }
  S.compareSel = []; S.compareMode = false;
}

// ======================= สรุป =======================
async function loadSummary() {
  const mon = mondayOf(S.weekDate);
  S.week = S.weeks[mon] || null;
  if (S.week) renderSummary();
  else view().innerHTML = skeleton(S.tab);
  let r;
  try {
    const o = S.week ? { silent: true, quiet: true } : {};
    r = await Promise.all([api('getWeek', { date: mon }, o), api('getInsights', { weeks: 8 }, { silent: true, quiet: true })]);
  } catch (e) { return; }
  S.weeks[r[0].week_start] = r[0];
  S.insights = r[1];
  if (S.tab === 'summary' && mondayOf(S.weekDate) === r[0].week_start) { S.week = r[0]; renderSummary(); }
}

/** รวมข้อมูลในเครื่องที่ใหม่กว่าเข้ากับสรุปสัปดาห์ */
function mergedDays(w) {
  return w.days.map(x => {
    const L = S.days[x.date];
    return L ? { date: x.date, weekday: x.weekday, day_type: L.day_type, total: L.total, target: L.target } : x;
  });
}

function weekBudget(w) {
  const today = todayISO();
  const thisWeek = w.week_start <= today && today <= w.week_end;
  const days = mergedDays(w);
  let eaten = 0, target = 0, futureDays = 0, workDays = 0, homeDays = 0, todayCounts = false;
  days.forEach(d => {
    if (d.day_type === 'party') return;
    const counted = d.weekday <= 5 || d.day_type === 'home' || d.total > 0;
    if (!counted) return;
    if (d.weekday <= 5) workDays++; else homeDays++;
    eaten += d.total;
    target += d.target || 0;
    if (thisWeek && d.date > today && d.weekday <= 5) futureDays++;
    if (d.date === today) todayCounts = true;
  });
  const left = target - eaten;
  const daysLeft = thisWeek ? futureDays + (todayCounts ? 1 : 0) : 0;
  return { thisWeek: thisWeek, eaten: eaten, target: target, left: left, daysLeft: daysLeft,
    perDay: daysLeft ? left / daysLeft : null, workDays: workDays, homeDays: homeDays };
}

function weekLineHTML(d) {
  const w = S.weeks[mondayOf(d.date)];
  if (!w) { fetchWeekQuiet(d.date); return ''; }
  const b = weekBudget(w);
  if (!b.target) return '';
  const pct = Math.min(b.eaten / b.target, 1) * 100;
  return '<button class="week-line" data-act="week-open" data-date="' + d.date + '">' +
    '<span class="wl-top"><span>' + (b.thisWeek ? 'สัปดาห์นี้' : 'สัปดาห์นั้น') + '</span><span class="num"><b>' + fmtN(b.eaten) + '</b> / ' + fmtN(b.target) + '</span></span>' +
    '<span class="bar"><i class="' + (b.left <= 0 ? 'hit' : '') + '" style="width:' + pct.toFixed(0) + '%"></i></span>' +
    '<span class="wl-sub">' + (b.left <= 0 ? 'ถึงเป้าทั้งสัปดาห์แล้ว 🎉'
      : 'ขาดอีก ' + fmtN(b.left) + (b.perDay ? ' · เฉลี่ยวันละ ' + fmtN(b.perDay) + ' (' + b.daysLeft + ' วันทำงาน)' : '')) + ' ›</span></button>';
}

/** กราฟรายสัปดาห์ 2 แผงแกนเดียวกัน: แคลรวม (แท่ง + ขีดเป้า) และน้ำหนักเฉลี่ย (เส้น) */
function weekChartHTML(ins) {
  const cur = Object.assign({}, ins.current, { current: true });
  const w = S.weeks[cur.week_start];
  if (w) { const b = weekBudget(w); cur.kcal_total = b.eaten; cur.target_total = b.target; }
  const weeks = ins.weeks.slice(-7).concat([cur]);
  if (!weeks.some(x => x.kcal_total > 0 || x.weight_avg != null)) {
    return '<p class="empty">ใช้ไปสักสัปดาห์ กราฟแคลกับน้ำหนักจะขึ้นตรงนี้</p>';
  }
  S.chartWeeks = weeks;
  const W = 340, pl = 36, pr = 8, n = weeks.length, band = (W - pl - pr) / n, bw = Math.min(22, band * 0.55);
  const cx = i => pl + band * i + band / 2;

  // แผงบน: แคล
  const H1 = 120, t1 = 18, b1 = H1 - 4;
  const kmax = Math.max.apply(null, weeks.map(x => Math.max(x.kcal_total || 0, x.target_total || 0)).concat([1000])) * 1.05;
  const y1 = v => b1 - v / kmax * (b1 - t1);
  const kfmt = v => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : String(Math.round(v)));
  let g1 = '<text class="lbl ptitle" x="0" y="11">แคลรวมต่อสัปดาห์</text>';
  [0, kmax / 2, kmax / 1.05].forEach(v => {
    g1 += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y1(v).toFixed(1) + '" y2="' + y1(v).toFixed(1) + '"/>' +
      '<text class="lbl" x="' + (pl - 5) + '" y="' + (y1(v) + 3).toFixed(1) + '" text-anchor="end">' + kfmt(v) + '</text>';
  });
  weeks.forEach((x, i) => {
    const v = x.kcal_total || 0;
    if (v > 0) {
      const top = y1(v), x0 = cx(i) - bw / 2, r = Math.min(4, (b1 - top) / 2);
      g1 += '<path class="wk-bar' + (x.target_total && v >= x.target_total ? ' hit' : '') + (x.current ? ' cur' : '') + '" d="M' + x0.toFixed(1) + ',' + b1 +
        ' V' + (top + r).toFixed(1) + ' Q' + x0.toFixed(1) + ',' + top.toFixed(1) + ' ' + (x0 + r).toFixed(1) + ',' + top.toFixed(1) +
        ' H' + (x0 + bw - r).toFixed(1) + ' Q' + (x0 + bw).toFixed(1) + ',' + top.toFixed(1) + ' ' + (x0 + bw).toFixed(1) + ',' + (top + r).toFixed(1) +
        ' V' + b1 + ' Z"/>';
    }
    if (x.target_total && (v > 0 || x.current)) {
      g1 += '<line class="wk-target" x1="' + (cx(i) - bw / 2 - 3).toFixed(1) + '" x2="' + (cx(i) + bw / 2 + 3).toFixed(1) +
        '" y1="' + y1(x.target_total).toFixed(1) + '" y2="' + y1(x.target_total).toFixed(1) + '"/>';
    }
  });

  // แผงล่าง: น้ำหนัก
  const H2 = 96, t2 = 20, b2 = H2 - 18, off = H1 + 6;
  const ws = weeks.map(x => x.weight_avg).filter(v => v != null);
  let lo = ws.length ? Math.min.apply(null, ws) : 50, hi = ws.length ? Math.max.apply(null, ws) : 60;
  if (hi - lo < 0.6) { const m = (hi + lo) / 2; lo = m - 0.3; hi = m + 0.3; }
  const y2 = v => off + t2 + (hi - v) / (hi - lo) * (b2 - t2);
  let g2 = '<text class="lbl ptitle" x="0" y="' + (off + 11) + '">น้ำหนักเฉลี่ย (กก.)</text>';
  [hi, lo].forEach(v => {
    g2 += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y2(v).toFixed(1) + '" y2="' + y2(v).toFixed(1) + '"/>' +
      '<text class="lbl" x="' + (pl - 5) + '" y="' + (y2(v) + 3).toFixed(1) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
  });
  let seg = [], lines = '';
  weeks.forEach((x, i) => {
    if (x.weight_avg != null) seg.push(cx(i).toFixed(1) + ',' + y2(x.weight_avg).toFixed(1));
    if (x.weight_avg == null || i === n - 1) { if (seg.length > 1) lines += '<polyline class="avg" points="' + seg.join(' ') + '"/>'; seg = x.weight_avg == null ? [] : seg; }
  });
  g2 += lines + weeks.map((x, i) => x.weight_avg == null ? '' :
    '<circle class="wk-dot" cx="' + cx(i).toFixed(1) + '" cy="' + y2(x.weight_avg).toFixed(1) + '" r="4"/>').join('');
  g2 += weeks.map((x, i) => (i % 2 === (n - 1) % 2) ?
    '<text class="lbl" x="' + cx(i).toFixed(1) + '" y="' + (off + H2 - 3) + '" text-anchor="middle">' + (x.current ? 'นี้' : esc(thDate(x.week_start))) + '</text>' : '').join('');

  const hits = weeks.map((x, i) => '<rect class="hit-area" data-act="wk-tip" data-i="' + i + '" x="' + (pl + band * i).toFixed(1) +
    '" y="0" width="' + band.toFixed(1) + '" height="' + (H1 + 6 + H2) + '"/>').join('');

  return '<svg class="chart wk-chart" viewBox="0 0 ' + W + ' ' + (H1 + 6 + H2) + '" role="img" aria-label="กราฟแคลรวมและน้ำหนักเฉลี่ยรายสัปดาห์">' +
    g1 + g2 + hits + '</svg>' +
    '<div class="legend"><span><i class="lg-bar"></i>แคลรวม</span><span><i class="lg-bar hit"></i>ถึงเป้า</span><span><i class="lg-tick"></i>เป้าสัปดาห์</span>' +
    '<span><i class="lg-line"></i>น้ำหนักเฉลี่ย</span></div>' +
    '<p class="wk-tip" id="wk-tip">' + weekTipText(n - 1) + '</p>';
}

function weekTipText(i) {
  const x = (S.chartWeeks || [])[i];
  if (!x) return '';
  return '<b>' + (x.current ? 'สัปดาห์นี้' : 'สัปดาห์ ' + esc(thDate(x.week_start))) + '</b> · แผน ' + esc(x.plan) +
    ' · กิน ' + (x.kcal_total ? fmtN(x.kcal_total) : '–') + (x.target_total ? ' / ' + fmtN(x.target_total) : '') + ' kcal' +
    ' · น้ำหนัก ' + fmtKg(x.weight_avg) + ' กก.' + (x.party_days ? ' · 🍻 ' + x.party_days + ' วัน' : '') +
    '<br><span class="muted small">แตะแท่งอื่นเพื่อดูสัปดาห์นั้น</span>';
}

function renderSummary() {
  const w = S.week, ins = S.insights;
  if (!w) return;
  const thisWeek = w.week_start <= todayISO() && todayISO() <= w.week_end;
  const wd = w.weight.diff;
  const diffTxt = wd == null ? 'ยังเทียบไม่ได้'
    : wd > 0 ? '📈 +' + wd.toFixed(2) + ' กก.' : wd < 0 ? '📉 ' + wd.toFixed(2) + ' กก.' : '➖ เท่าเดิม';

  const bars = mergedDays(w).map(d => {
    const party = d.day_type === 'party';
    const pct = d.target ? Math.min(d.total / d.target, 1) * 100 : 0;
    const hit = d.target && d.total >= d.target;
    return '<li><span>' + WD_SHORT[d.weekday] + ' ' + esc(thDate(d.date, { day: 'numeric' })) + '</span>' +
      '<div class="bar' + (party ? ' party' : '') + '">' + (party ? '' : '<i class="' + (hit ? 'hit' : '') + '" style="width:' + pct.toFixed(0) + '%"></i>') + '</div>' +
      '<span class="num">' + (party ? '🍻' : d.total ? fmtN(d.total) : '–') + '</span></li>';
  }).join('');

  let tip = '';
  if (ins) {
    const sg = ins.suggestion;
    tip = (ins.current ? '<section><h2>แคล vs น้ำหนัก รายสัปดาห์</h2>' + weekChartHTML(ins) + '</section>' : '') +
      '<section><h2>คำแนะนำ</h2><div class="tip ' + esc(sg.type) + '"><p>' + esc(sg.message) + '</p>' +
      (sg.new_target ? '<button class="btn" data-act="ins-apply" data-v="' + sg.new_target + '">ปรับเป้าเป็น ' + fmtN(sg.new_target) + ' kcal</button>' : '') +
      '</div>' +
      '<table class="tbl"><thead><tr><th>สัปดาห์</th><th>แผน</th><th>น้ำหนักเฉลี่ย</th><th>กินเฉลี่ย</th><th>🍻</th></tr></thead><tbody>' +
      ins.weeks.slice(-6).reverse().map(x => '<tr><td>' + esc(thDate(x.week_start)) + '</td><td>' + esc(x.plan) + '</td>' +
        '<td class="num">' + fmtKg(x.weight_avg) + '</td><td class="num">' + (x.kcal_avg ? fmtN(x.kcal_avg) : '–') + '</td>' +
        '<td class="num">' + (x.party_days || '') + '</td></tr>').join('') +
      '</tbody></table></section>';
  }

  const weekHTML = weekBudgetHTML(w);

  view().innerHTML =
    '<section class="hero hero-week"><header class="week-head"><button class="icon-btn" data-act="wk-go" data-d="-7" aria-label="สัปดาห์ก่อน">‹</button>' +
    '<div><h1><button class="date-btn" data-act="cal-open" data-mode="week" aria-label="เลือกสัปดาห์จากปฏิทิน">' +
    (thisWeek ? 'สัปดาห์นี้' : esc(thDate(w.week_start)) + ' ถึง ' + esc(thDate(w.week_end))) + '</button></h1>' +
    '<div class="day-sub">' + (thisWeek ? '<span>' + esc(thDate(w.week_start)) + ' ถึง ' + esc(thDate(w.week_end)) + '</span>' : '') +
    '<span class="plan-chip">แผน ' + esc(w.plan) + '</span></div></div>' +
    '<button class="icon-btn" data-act="wk-go" data-d="7" aria-label="สัปดาห์ถัดไป"' + (thisWeek ? ' disabled' : '') + '>›</button></header>' +
    '</section>' + weekHTML +
    '<div class="stats">' +
    '<div class="stat"><b class="num">' + (w.kcal.avg ? fmtN(w.kcal.avg) : '–') + '</b><span>🔥 kcal เฉลี่ยต่อวัน</span></div>' +
    '<div class="stat"><b class="num">' + w.kcal.hit_days + '/' + w.kcal.counted_days + '</b><span>🎯 วันที่ถึงเป้า</span></div>' +
    '<div class="stat"><b class="num">' + fmtKg(w.weight.avg) + '</b><span>⚖️ น้ำหนักเฉลี่ย (กก.)</span></div>' +
    '<div class="stat"><b class="fit num">' + diffTxt + '</b><span>📊 เทียบสัปดาห์ก่อน</span></div>' +
    '<div class="stat wide"><b class="fit">' + (w.party_days ? '🍻 ' + w.party_days + ' วัน' : 'ไม่ได้ไปปาร์ตี้ สัปดาห์กำไร 🎉') + '</b><span>วันปาร์ตี้</span></div>' +
    '</div>' +
    '<section><h2>รายวัน</h2><ul class="bars">' + bars + '</ul></section>' + tip;
}

/** งบแคลทั้งสัปดาห์ = รวมเป้าของแต่ละวัน (วันทำงาน + วันหยุดที่อยู่บ้าน, วันปาร์ตี้ไม่นับ) */
function weekBudgetHTML(w) {
  const b = weekBudget(w);
  const pct = b.target ? Math.min(b.eaten / b.target, 1) * 100 : 0;
  let note;
  if (b.left <= 0) note = '<p class="wb-note ok">ถึงเป้าทั้งสัปดาห์แล้ว 🎉 เกินมา ' + fmtN(-b.left) + ' kcal</p>';
  else if (b.thisWeek) {
    note = '<p class="wb-note">ยังขาดอีก <b class="num">' + fmtN(b.left) + '</b> kcal' +
      (b.daysLeft ? ' | วันทำงานที่เหลือ ' + b.daysLeft + ' วัน ≈ วันละ <b class="num">' + fmtN(b.perDay) + '</b>' : '') + '</p>';
  } else note = '<p class="wb-note">ขาดไป <b class="num">' + fmtN(b.left) + '</b> kcal จากเป้าสัปดาห์</p>';
  return '<div class="week-budget"><div class="wb-top"><span>กินรวมทั้งสัปดาห์</span>' +
    '<span class="num"><b>' + fmtN(b.eaten) + '</b> / ' + fmtN(b.target) + ' kcal</span></div>' +
    '<div class="bar wb-bar"><i class="' + (b.left <= 0 ? 'hit' : '') + '" style="width:' + pct.toFixed(0) + '%"></i></div>' + note +
    '<p class="muted small" style="margin:4px 0 0">เป้า = รวมเป้าของ ' + b.workDays + ' วันทำงาน' +
    (b.homeDays ? ' + ' + b.homeDays + ' วันหยุดที่อยู่บ้าน' : '') + ' (วันปาร์ตี้ไม่นับ)</p></div>';
}

async function applyTarget(v) {
  if (!confirm('ปรับเป้าวันปกติเป็น ' + fmtN(v) + ' kcal?')) return;
  try {
    const r = await api('updateSettings', { values: { weekday_target_kcal: v } }, { wait: 'กำลังปรับเป้า…' });
    S.init.settings = r.settings;
    invalidateDays(); S.weeks = {};
    toast('ปรับเป้าแล้ว ✓');
    loadSummary();
  } catch (e) { /* toast แล้ว */ }
}

// ======================= ตั้งค่า =======================
function rotationPlans() {
  const rot = String(S.init.settings.plan_rotation || 'A').split(',').map(s => s.trim()).filter(Boolean);
  const all = rot.concat(S.init.plans.map(p => p.plan));
  return all.filter((p, i) => all.indexOf(p) === i).sort();
}

function anchorHTML() {
  return '<button class="icon-btn" data-act="anchor-step" data-d="-7" aria-label="สัปดาห์ก่อน">‹</button>' +
    '<b>' + esc(thFull(S.anchorDraft)) + '</b>' +
    '<button class="icon-btn" data-act="anchor-step" data-d="7" aria-label="สัปดาห์ถัดไป">›</button>';
}

function anchorHint() {
  const el = $('[data-input="rot"]');
  const rot = String(el ? el.value : S.init.settings.plan_rotation || 'A').toUpperCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!rot.length) return '';
  const planOf = date => {
    const weeks = Math.round((parseISO(mondayOf(date)) - parseISO(S.anchorDraft)) / (7 * 86400000));
    return rot[((weeks % rot.length) + rot.length) % rot.length];
  };
  const thisMon = mondayOf(todayISO());
  const nextMon = addDays(thisMon, 7);
  return 'สัปดาห์นี้ = แผน ' + esc(planOf(thisMon)) + ' | สัปดาห์หน้า (' + esc(thDate(nextMon)) + ') = แผน ' + esc(planOf(nextMon));
}

function renderSettings() {
  const st = S.init.settings;
  if (!S.anchorDraft) {
    S.anchorDraft = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(st.rotation_anchor || '') ? st.rotation_anchor : todayISO());
  }
  const plans = rotationPlans();
  if (!S.planSel || plans.indexOf(S.planSel.plan) === -1 && !S.planSel.isNew) S.planSel = { plan: plans[0] || 'A', weekday: 1 };
  const ps = S.planSel;
  const foodsById = {};
  S.init.foods.forEach(f => { foodsById[f.id] = f; });

  const slotRows = S.init.slots.map(slot => {
    const rows = S.init.plans.filter(p => p.plan === ps.plan && p.weekday === ps.weekday && p.slot === slot);
    const sum = rows.reduce((a, p) => a + (foodsById[p.food_id] ? foodsById[p.food_id].kcal * p.qty : 0), 0);
    return { slot: slot, rows: rows, sum: sum };
  });
  const dayTotal = slotRows.reduce((a, r) => a + r.sum, 0);
  const target = Number(st.weekday_target_kcal) || 0;
  const compare = String(st.weigh_compare_days || '').split(',').map(Number);
  const nextLetter = String.fromCharCode(Math.max.apply(null, plans.map(p => p.charCodeAt(0)).concat(64)) + 1);

  view().innerHTML =
    '<section class="hero hero-flat"><h1 class="view-title">⚙️ ตั้งค่า</h1><p class="hero-sub">แผนการกิน เป้าหมาย และคลังเมนู</p></section>' +

    '<section><h2>แผนการกิน</h2><div class="group">' +
    '<div class="chips">' + plans.map(p => '<button class="chip" data-act="plan-sel" data-plan="' + esc(p) + '" aria-pressed="' + (p === ps.plan) + '">แผน ' + esc(p) + '</button>').join('') +
    (nextLetter <= 'Z' ? '<button class="chip" data-act="plan-sel" data-plan="' + nextLetter + '" data-new="1">+ แผน ' + nextLetter + '</button>' : '') + '</div>' +
    '<div class="chips">' + [1, 2, 3, 4, 5, 6, 7].map(n => '<button class="chip" data-act="plan-wd" data-wd="' + n + '" aria-pressed="' + (n === ps.weekday) + '">' + WD_SHORT[n] + '</button>').join('') + '</div>' +
    slotRows.map(r => '<div class="plan-slot"><div><h3>' + esc(r.slot) + '</h3><p>' +
      (r.rows.length ? r.rows.map(p => esc(foodsById[p.food_id] ? foodsById[p.food_id].name : '?') + (p.qty !== 1 ? ' ×' + p.qty : '')).join(' + ') + ' <span class="num">(' + fmtN(r.sum) + ')</span>' : 'ไม่มี') +
      '</p></div><button class="btn btn-ghost" data-act="plan-edit" data-slot="' + esc(r.slot) + '">แก้</button></div>').join('') +
    '<div class="plan-total"><span>รวม' + WD_LONG[ps.weekday] + '</span><span class="num">' + fmtN(dayTotal) +
    (target && ps.weekday <= 5 ? (dayTotal >= target ? ' ✅' : ' (ขาด ' + fmtN(target - dayTotal) + ')') : '') + '</span></div>' +
    (String(st.plan_rotation || '').split(',').indexOf(ps.plan) === -1 ? '<p class="muted small">แผนใหม่จะถูกใช้เมื่อใส่ชื่อแผนในช่อง "ลำดับการสลับแผน" ด้านล่าง</p>' : '') +
    '</div></section>' +

    '<section><h2>เป้าหมาย</h2><div class="group">' +
    '<div class="row2"><label class="field"><span>เป้าวันปกติ (kcal)</span><input data-key="weekday_target_kcal" type="number" inputmode="numeric" value="' + esc(st.weekday_target_kcal) + '"></label>' +
    '<label class="field"><span>เป้าวันอยู่บ้าน (kcal)</span><input data-key="home_day_target_kcal" type="number" inputmode="numeric" value="' + esc(st.home_day_target_kcal) + '"></label></div>' +
    '<div class="row2"><label class="field"><span>อยากขึ้นสัปดาห์ละ (กก.)</span><input data-key="gain_rate_kg_week" type="number" inputmode="decimal" step="0.05" value="' + esc(st.gain_rate_kg_week) + '"></label>' +
    '<label class="field"><span>ปรับเป้าครั้งละ (kcal)</span><input data-key="adjust_step_kcal" type="number" inputmode="numeric" value="' + esc(st.adjust_step_kcal) + '"></label></div>' +
    '<div class="row2"><label class="field"><span>น้ำหนักเป้าหมาย (กก.)</span><input data-key="target_weight_kg" type="number" inputmode="decimal" step="0.1" value="' + esc(st.target_weight_kg) + '"></label>' +
    '<label class="field"><span>ส่วนสูง (ซม.)</span><input data-key="height_cm" type="number" inputmode="numeric" value="' + esc(st.height_cm) + '"></label></div>' +
    '</div></section>' +

    '<section><h2>มื้อและการสลับแผน</h2><div class="group">' +
    '<label class="field"><span>ช่องมื้อ (คั่นด้วย ,)</span><input data-key="meal_slots" value="' + esc(st.meal_slots) + '"></label>' +
    '<label class="field"><span>ลำดับการสลับแผน</span><input data-key="plan_rotation" data-input="rot" value="' + esc(st.plan_rotation) + '"></label>' +
    '<div class="field"><span>เริ่มนับแผนแรกจากวันจันทร์ที่</span><div class="date-step" id="anchor-step">' + anchorHTML() + '</div>' +
    '<input type="hidden" data-key="rotation_anchor" id="anchor-val" value="' + esc(S.anchorDraft) + '">' +
    '<p class="muted small" id="anchor-hint">' + anchorHint() + '</p></div>' +
    '<div class="field"><span>วันที่ใช้เทียบน้ำหนักแต่ละสัปดาห์</span><div class="days-pick">' +
    [1, 2, 3, 4, 5, 6, 7].map(n => '<label><input type="checkbox" data-wd-cmp="' + n + '"' + (compare.indexOf(n) !== -1 ? ' checked' : '') + '><span>' + WD_SHORT[n] + '</span></label>').join('') +
    '</div></div>' +
    '<button class="btn btn-block" data-act="st-save">บันทึกการตั้งค่า</button></div></section>' +

    '<section><h2>คลังเมนู</h2><div class="group"><p class="muted small">มีทั้งหมด ' + S.init.foods.length + ' เมนู แก้ kcal แล้วประวัติเก่าไม่เปลี่ยน</p>' +
    '<button class="btn btn-ghost btn-block" data-act="lib-open">เปิดคลังเมนู</button></div></section>' +

    '<section><h2>ความปลอดภัย</h2><div class="group" style="padding-top:14px">' +
    '<button class="btn btn-ghost btn-block" data-act="reload-all">โหลดข้อมูลใหม่ทั้งหมด</button>' +
    '<p class="muted small">ใช้เมื่อไปแก้ข้อมูลใน Google Sheets ตรง ๆ แล้วแอปยังไม่เห็น</p>' +
    '<button class="btn btn-ghost btn-block" data-act="pin-change">เปลี่ยน PIN</button>' +
    '<button class="btn btn-danger btn-block" style="margin-top:10px" data-act="logout">ออกจากระบบ</button></div></section>';
}

async function saveSettings() {
  const values = {};
  $$('[data-key]').forEach(el => { values[el.dataset.key] = el.value.trim(); });
  values.weigh_compare_days = $$('[data-wd-cmp]').filter(el => el.checked).map(el => el.dataset.wdCmp).join(',');
  if (!(Number(values.weekday_target_kcal) > 0)) return toast('เป้าวันปกติต้องมากกว่า 0', true);
  if (!values.meal_slots) return toast('ต้องมีอย่างน้อย 1 มื้อ', true);
  if (!/^[A-Za-z](\s*,\s*[A-Za-z])*$/.test(values.plan_rotation)) return toast('ลำดับแผนต้องเป็นตัวอักษร เช่น A,B', true);
  values.plan_rotation = values.plan_rotation.toUpperCase().replace(/\s/g, '');
  try {
    const r = await api('updateSettings', { values: values }, { wait: 'กำลังบันทึกการตั้งค่า…' });
    S.init.settings = r.settings;
    S.anchorDraft = null;
    S.init.slots = values.meal_slots.split(',').map(s => s.trim()).filter(Boolean);
    invalidateDays(); S.weeks = {};
    toast('บันทึกการตั้งค่าแล้ว ✓');
    renderSettings();
  } catch (e) { /* toast แล้ว */ }
}

// ---------- คลังเมนู ----------
let libQ = '', libCat = 'all', libSort = 'az';
function openLibrary() {
  libQ = '';
  libSort = SORTS.some(x => x[0] === S.init.settings.food_sort) ? S.init.settings.food_sort : 'az';
  const cats = [];
  S.init.foods.forEach(f => { if (cats.indexOf(f.category) === -1) cats.push(f.category); });
  if (['all', 'fav', 'hidden'].indexOf(libCat) === -1 && cats.indexOf(libCat) === -1) libCat = 'all';
  const count = c => S.init.foods.filter(f => c === 'all' || (c === 'fav' ? f.favorite : c === 'hidden' ? !f.active : f.category === c)).length;
  const catOpts = [['all', 'ทั้งหมด'], ['fav', '⭐ โปรด']].concat(cats.map(c => [c, c])).concat([['hidden', '🙈 ที่ซ่อนอยู่']]);
  openSheet('คลังเมนู',
    '<input class="search" type="search" placeholder="ค้นหาเมนู" data-input="lib-q" aria-label="ค้นหาเมนู" autocomplete="off">' +
    '<div class="row2 pk-cat-field"><label class="field"><span>หมวด</span><select data-input="lib-cat" aria-label="เลือกหมวด">' +
    catOpts.map(c => '<option value="' + esc(c[0]) + '"' + (c[0] === libCat ? ' selected' : '') + '>' + esc(c[1]) + ' (' + count(c[0]) + ')</option>').join('') +
    '</select></label><label class="field"><span>เรียงตาม</span><select data-input="lib-sort" aria-label="เรียงตาม">' +
    SORTS.map(x => '<option value="' + x[0] + '"' + (x[0] === libSort ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
    '</select></label></div>' +
    '<button class="btn btn-block" style="margin:4px 0 10px" data-act="food-new">+ เพิ่มเมนูใหม่</button>' +
    '<ul class="food-list" id="lib-list"></ul>');
  renderLibrary();
}

function renderLibrary() {
  const q = libQ.trim().toLowerCase();
  let list = S.init.foods.slice();
  if (q) list = list.filter(f => f.name.toLowerCase().indexOf(q) !== -1);       // ค้นหา = ค้นทุกหมวด
  else if (libCat === 'fav') list = list.filter(f => f.favorite);
  else if (libCat === 'hidden') list = list.filter(f => !f.active);
  else if (libCat !== 'all') list = list.filter(f => f.category === libCat);
  list = sortFoods(list, libSort);
  if (libCat !== 'hidden') list.sort((a, b) => b.active - a.active);              // เมนูที่ซ่อนไว้ล่างสุด (sort คงลำดับเดิม)
  $('#lib-list').innerHTML = list.map(f =>
    '<li><button class="food-row' + (f.active ? '' : ' off') + '" data-act="food-edit" data-id="' + esc(f.id) + '">' +
    '<span>' + (f.favorite ? '⭐ ' : '') + esc(f.name) + '<span class="meta">' + esc(f.category) + ' | ต่อ 1 ' + esc(f.unit) +
    (f.active ? '' : ' | ซ่อนอยู่') + esc(usageMeta(f, libSort)) + '</span></span><span class="k num">' + fmtN(f.kcal) + '</span></button></li>').join('') ||
    '<li class="empty">' + (q ? 'ไม่เจอเมนูนี้' : 'หมวดนี้ยังไม่มีเมนู') + '</li>';
}

function openFoodForm(id) {
  const f = id ? S.init.foods.find(x => x.id === id) : { name: '', kcal: '', unit: 'จาน', category: 'จานหลัก', favorite: false, active: true, note: '' };
  const cats = categories();
  openSheet(id ? 'แก้เมนู' : 'เพิ่มเมนูใหม่',
    '<label class="field"><span>ชื่อเมนู</span><input id="ff-name" value="' + esc(f.name) + '"></label>' +
    '<div class="row2"><label class="field"><span>kcal ต่อหน่วย</span><input id="ff-kcal" type="number" inputmode="numeric" min="0" value="' + esc(f.kcal) + '"></label>' +
    '<label class="field"><span>หน่วย</span><input id="ff-unit" value="' + esc(f.unit) + '"></label></div>' +
    '<label class="field"><span>หมวด</span><select id="ff-cat" data-input="ff-cat-sel">' +
    cats.concat(cats.indexOf(f.category) === -1 ? [f.category] : []).map(c =>
      '<option' + (c === f.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '<option value="__new">+ สร้างหมวดใหม่…</option></select></label>' +
    '<label class="field" id="ff-cat-new" hidden><span>ชื่อหมวดใหม่</span><input id="ff-cat-name" placeholder="เช่น ขนม"></label>' +
    '<label class="field"><span>โน้ต</span><input id="ff-note" value="' + esc(f.note) + '" placeholder="เช่น ดูฉลาก"></label>' +
    '<label class="check"><input type="checkbox" id="ff-fav"' + (f.favorite ? ' checked' : '') + '> เมนูโปรด (ขึ้นก่อนในรายการ)</label>' +
    '<label class="check"><input type="checkbox" id="ff-active"' + (f.active ? ' checked' : '') + '> แสดงในรายการให้เลือก</label>' +
    '<button class="btn btn-block" data-act="food-save" data-id="' + esc(id || '') + '">' + (id ? 'บันทึกเมนู' : 'เพิ่มเมนู') + '</button>');
}

async function saveFood(id) {
  const fields = {
    name: $('#ff-name').value.trim(), kcal: Number($('#ff-kcal').value), unit: $('#ff-unit').value.trim() || 'ที่',
    category: ($('#ff-cat').value === '__new' ? $('#ff-cat-name').value.trim() : $('#ff-cat').value) || 'อื่นๆ', note: $('#ff-note').value.trim(),
    favorite: $('#ff-fav').checked, active: $('#ff-active').checked
  };
  if (!fields.name) return toast('ใส่ชื่อเมนูก่อน', true);
  if (!($('#ff-kcal').value !== '' && fields.kcal >= 0)) return toast('ใส่ kcal ก่อน', true);
  try {
    const w = { wait: 'กำลังบันทึกเมนู…' };
    const r = id ? await api('updateFood', { id: id, fields: fields }, w) : await api('addFood', fields, w);
    S.init.foods = r.foods;
    invalidateDays();
    toast(id ? 'บันทึกเมนูแล้ว' : 'เพิ่มเมนูแล้ว');
    openLibrary();
  } catch (e) { /* toast แล้ว */ }
}

// ---------- PIN ----------
function openPinChange() {
  openSheet('เปลี่ยน PIN',
    '<label class="field"><span>PIN เดิม</span><input id="pc-old" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>' +
    '<label class="field"><span>PIN ใหม่ (6 หลัก)</span><input id="pc-new" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>' +
    '<label class="field"><span>ใส่ PIN ใหม่อีกครั้ง</span><input id="pc-new2" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>' +
    '<button class="btn btn-block" data-act="pin-change-save">เปลี่ยน PIN</button>');
}

async function savePinChange() {
  const o = $('#pc-old').value, n = $('#pc-new').value, n2 = $('#pc-new2').value;
  if (!/^\d{6}$/.test(n)) return toast('PIN ใหม่ต้องเป็นตัวเลข 6 หลัก', true);
  if (n !== n2) return toast('PIN ใหม่ 2 ช่องไม่ตรงกัน', true);
  try {
    await api('changePin', { old_pin: o, new_pin: n }, { wait: 'กำลังเปลี่ยน PIN…' });
    closeSheet();
    toast('เปลี่ยน PIN แล้ว');
  } catch (e) { /* toast แล้ว */ }
}

// ======================= ปฏิทิน =======================
const monthKey = s => s.slice(0, 7);
const shiftMonth = (m, n) => { const d = parseISO(m + '-01'); d.setMonth(d.getMonth() + n); return toISO(d).slice(0, 7); };

function openCalendar(mode) {
  const sel = mode === 'week' ? (S.week ? S.week.week_start : S.weekDate) : S.date;
  S.cal = { mode: mode, month: monthKey(sel), sel: sel, cache: {} };
  openSheet(mode === 'week' ? 'เลือกสัปดาห์' : 'เลือกวัน', '<div id="cal"></div>');
  renderCal();
}

async function renderCal() {
  const c = S.cal;
  if (!c) return;
  const box = $('#cal');
  if (!box) return;
  const today = todayISO();
  const m = c.month;
  const isNowMonth = m >= monthKey(today);

  if (!c.cache[m]) {
    box.innerHTML = calHTML(m, null, today, isNowMonth);
    try { c.cache[m] = (await api('getMonth', { month: m }, { wait: 'กำลังโหลดปฏิทิน…' })).days; } catch (e) { return; }
    if (!S.cal || S.cal.month !== m) return;   // เลื่อนเดือนไปแล้วระหว่างรอ
  }
  $('#cal').innerHTML = calHTML(m, c.cache[m], today, isNowMonth);
}

function calHTML(m, data, today, isNowMonth) {
  const c = S.cal;
  const first = m + '-01';
  const lead = (parseISO(first).getDay() + 6) % 7;             // ช่องว่างก่อนวันที่ 1 (เริ่มจันทร์)
  const dim = new Date(parseISO(first).getFullYear(), parseISO(first).getMonth() + 1, 0).getDate();
  const selWeek = c.mode === 'week' ? mondayOf(c.sel) : null;

  let cells = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(w => '<span class="cal-wd">' + w + '</span>').join('');
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let n = 1; n <= dim; n++) {
    const d = m + '-' + pad(n);
    const wd = ((parseISO(d).getDay() + 6) % 7) + 1;
    const info = data ? (data[d] || {}) : null;
    let mark = '', status = '';
    if (info && d <= today) {
      if (info.type === 'party') { mark = '<span class="cal-mark">🍻</span>'; status = 'วันปาร์ตี้'; }
      else if (info.kcal > 0) { mark = '<span class="cal-mark"><i class="dot-ok"></i></span>'; status = 'บันทึกแล้ว ' + fmtN(info.kcal) + ' kcal'; }
      else if (wd <= 5 && d < today) { mark = '<span class="cal-mark"><i class="dot-miss"></i></span>'; status = 'ยังไม่ได้บันทึก'; }
    }
    if (!mark) mark = '<span class="cal-mark"></span>';
    const sel = c.mode === 'week' ? mondayOf(d) === selWeek : d === c.sel;
    const cls = 'cal-day' + (d === today ? ' today' : '') + (sel ? ' sel' : '');
    cells += '<button class="' + cls + '" data-act="cal-pick" data-date="' + d + '"' + (d > today ? ' disabled' : '') +
      ' aria-label="' + esc(thDate(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (status ? ' ' + status : '')) + '">' +
      '<span>' + n + '</span>' + mark + '</button>';
  }

  return '<div class="cal-head">' +
    '<button class="icon-btn" data-act="cal-month" data-d="-1" aria-label="เดือนก่อน">‹</button>' +
    '<h3>' + esc(parseISO(first).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })) + '</h3>' +
    '<button class="icon-btn" data-act="cal-month" data-d="1" aria-label="เดือนถัดไป"' + (isNowMonth ? ' disabled' : '') + '>›</button></div>' +
    '<div class="cal-grid' + (data ? '' : ' loading') + '">' + cells + '</div>' +
    '<div class="cal-legend"><span><i class="dot-ok"></i>บันทึกแล้ว</span><span>🍻 ปาร์ตี้</span><span><i class="dot-miss"></i>วันทำงานที่ยังไม่ได้บันทึก</span></div>' +
    '<button class="btn btn-ghost btn-block" data-act="cal-pick" data-date="' + today + '">' + (c.mode === 'week' ? 'ไปสัปดาห์นี้' : 'ไปวันนี้') + '</button>';
}

function pickCalendar(date) {
  const mode = S.cal ? S.cal.mode : 'day';
  S.cal = null;
  closeSheet();
  if (mode === 'week') {
    S.weekDate = date;
    loadSummary();
  } else {
    loadDay(date);
  }
  toTop();
}

// ======================= sheet =======================
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  S.cal = null;
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  P = null;
}

// ======================= events =======================
const ACTS = {
  'nav': el => goTab(el.dataset.tab),
  'key': el => pressKey(el.dataset.k),
  'sheet-close': () => closeSheet(),

  'day-go': el => { loadDay(addDays(S.date, Number(el.dataset.d))); toTop(); },
  'day-today': () => { loadDay(todayISO()); toTop(); },
  'cal-open': el => openCalendar(el.dataset.mode),
  'cal-month': el => { S.cal.month = shiftMonth(S.cal.month, Number(el.dataset.d)); renderCal(); },
  'cal-pick': el => pickCalendar(el.dataset.date),
  'party-toggle': () => toggleParty(),
  'plan-slot': el => {
    const d = S.day, slot = el.dataset.slot;
    const items = d.planned[slot] || [];
    d.logs = d.logs.filter(l => l.slot !== slot).concat(toLogs(slot, items, 'plan'));
    bumpUsage(items, d.date);
    enqueue('logPlanSlot', { date: d.date, slot: slot }, { kind: 'day', date: d.date });
    markSaved(d.date, [slot]);
    commitDay(d);
  },
  'plan-day': () => {
    const d = S.day;
    const todo = Object.keys(d.planned).filter(s => !d.logs.some(l => l.slot === s));
    markSaved(d.date, todo);
    todo.forEach(slot => {
      d.logs = d.logs.concat(toLogs(slot, d.planned[slot], 'plan'));
      bumpUsage(d.planned[slot], d.date);
      enqueue('logPlanSlot', { date: d.date, slot: slot }, { kind: 'day', date: d.date });
    });
    commitDay(d);
  },
  'fill-open': () => openFill(),
  'fill-add': el => addFill(Number(el.dataset.i)),
  'week-open': el => { S.weekDate = el.dataset.date; goTab('summary'); },
  'wk-tip': el => { const t = $('#wk-tip'); if (t) t.innerHTML = weekTipText(Number(el.dataset.i)); },
  'reload-all': async () => {
    try {
      await withWait('กำลังโหลดข้อมูลใหม่…', async () => {
        await api('refreshCache', {}, { quiet: true });
        invalidateDays(); S.weeks = {};
        await loadBundle();
      });
      renderSettings();
      toast('โหลดข้อมูลใหม่แล้ว ✓');
    } catch (e) { /* toast แล้ว */ }
  },
  'change-slot': el => {
    const slot = el.dataset.slot;
    const logs = S.day.logs.filter(l => l.slot === slot);
    // กินอย่างอื่น = เริ่มจากรายการว่าง | แก้มื้อนี้ = เอาของที่บันทึกไว้มาแก้
    const cart = logs.map(x => x.food_id
      ? { food_id: x.food_id, name: x.name, kcal_unit: x.kcal_unit, qty: x.qty }
      : { name: x.name, kcal_unit: x.kcal_unit, qty: x.qty, custom: true, save_to_db: false });
    openPicker({ mode: 'replace', slot: slot, date: S.date, cart: cart, planned: S.day.planned[slot] || [], hadLogs: logs.length > 0,
      title: (logs.length ? 'แก้มื้อ' : 'กินอย่างอื่น มื้อ') + slot });
  },
  'add-slot': el => openPicker({ mode: 'add', slot: el.dataset.slot, date: S.date, title: 'เพิ่มเข้ามื้อ' + el.dataset.slot }),
  'del-log': el => {
    if (!confirm('ลบรายการนี้?')) return;
    const d = S.day, id = el.dataset.id;
    const item = d.logs.find(l => l.log_id === id);
    if (!item) return;
    d.logs = d.logs.filter(l => l.log_id !== id);
    if (id.indexOf('tmp_') === 0) {          // ยังไม่ได้ส่งถึงชีท → ส่งมื้อนั้นใหม่ทั้งมื้อ
      const rest = d.logs.filter(l => l.slot === item.slot).map(l => l.food_id
        ? { food_id: l.food_id, qty: l.qty } : { name: l.name, kcal: l.kcal_unit, qty: l.qty });
      enqueue('replaceSlot', { date: d.date, slot: item.slot, items: rest }, { kind: 'day', date: d.date });
    } else {
      enqueue('deleteLog', { log_id: id }, { kind: 'day', date: d.date });
    }
    commitDay(d);
  },

  'pk-use-plan': () => {
    P.cart = P.planned.map(x => ({ food_id: x.food_id, name: x.name, kcal_unit: x.kcal_unit, qty: x.qty }));
    renderPicker();
  },
  'pk-add': el => pickerAdd(el.dataset.id),
  'pk-qty': el => pickerQty(Number(el.dataset.i), Number(el.dataset.d)),
  'pk-custom-open': () => { P.custom = true; P.customName = P.q; renderCustom(); $('#ck-name').focus(); },
  'pk-custom-add': () => pickerCustomAdd(),
  'pk-save': () => pickerSave(),

  'w-save': () => saveWeight(),
  'w-more': () => { S.wShow = (S.wShow || 7) + 7; renderProgress(); },
  'w-date': el => {
    S.wDate = addDays(S.wDate, Number(el.dataset.d));
    if (S.wDate > todayISO()) S.wDate = todayISO();
    $('#w-date').innerHTML = wDateHTML();
    const w = (S.weights || []).find(x => x.date === S.wDate);
    if (w) $('#w-kg').value = w.weight_kg;
  },
  'anchor-step': el => {
    S.anchorDraft = addDays(S.anchorDraft, Number(el.dataset.d));
    $('#anchor-step').innerHTML = anchorHTML();
    $('#anchor-val').value = S.anchorDraft;
    $('#anchor-hint').innerHTML = anchorHint();
  },
  'w-range': async el => {
    S.weightsRange = Number(el.dataset.days);
    try { S.weights = await api('getWeights', { days: S.weightsRange }, { wait: 'กำลังโหลดกราฟ…' }); } catch (e) { return; }
    renderProgress();
  },
  'w-del': el => {
    if (!confirm('ลบน้ำหนักวันที่ ' + el.dataset.date + '?')) return;
    S.weights = (S.weights || []).filter(w => w.date !== el.dataset.date);
    enqueue('deleteWeight', { date: el.dataset.date }, { kind: 'weight' });
    renderProgress();
  },
  'ph-pick': () => $('#ph-file').click(),
  'ph-compare': () => { S.compareMode = !S.compareMode; S.compareSel = []; renderProgress(); },
  'ph-open': el => openPhoto(el.dataset.id),
  'ph-del': async el => {
    if (!confirm('ลบรูปนี้? (ไฟล์จะถูกย้ายไปถังขยะใน Drive)')) return;
    try {
      await withWait('กำลังลบรูป…', async () => {
        await api('deletePhoto', { file_id: el.dataset.id }, { quiet: true });
        S.photos = await api('listPhotos', {}, { quiet: true });
      });
      closeSheet(); renderProgress(); toast('ลบรูปแล้ว');
    } catch (e) {}
  },

  'wk-go': el => { S.weekDate = addDays(S.week.week_start, Number(el.dataset.d)); loadSummary(); toTop(); },
  'ins-apply': el => applyTarget(Number(el.dataset.v)),

  'plan-sel': el => { S.planSel = { plan: el.dataset.plan, weekday: S.planSel.weekday, isNew: !!el.dataset.new }; renderSettings(); },
  'plan-wd': el => { S.planSel.weekday = Number(el.dataset.wd); renderSettings(); },
  'plan-edit': el => {
    const ps = S.planSel, slot = el.dataset.slot;
    const cart = S.init.plans.filter(p => p.plan === ps.plan && p.weekday === ps.weekday && p.slot === slot).map(p => {
      const f = S.init.foods.find(x => x.id === p.food_id) || { name: '?', kcal: 0 };
      return { food_id: p.food_id, name: f.name, kcal_unit: f.kcal, qty: p.qty };
    });
    openPicker({ mode: 'plan', plan: ps.plan, weekday: ps.weekday, slot: slot, cart: cart, title: 'แผน ' + ps.plan + ' ' + WD_LONG[ps.weekday] + ' มื้อ' + slot });
  },
  'st-save': () => saveSettings(),
  'lib-open': () => openLibrary(),
  'food-new': () => openFoodForm(null),
  'food-edit': el => openFoodForm(el.dataset.id),
  'food-save': el => saveFood(el.dataset.id || null),
  'pin-change': () => openPinChange(),
  'pin-change-save': () => savePinChange(),
  'logout': async () => {
    if (!confirm(Q.list.length ? 'ยังมีข้อมูลรอส่ง ' + Q.list.length + ' รายการ (จะส่งต่อหลังใส่ PIN ครั้งหน้า) ออกจากระบบ?' : 'ออกจากระบบ?')) return;
    try { await api('logout', {}, { silent: true, wait: 'กำลังออกจากระบบ…' }); } catch (e) {}
    logoutLocal();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.input;
  if (k === 'pk-q' && P) { P.q = e.target.value; renderPicker(); }
  if (k === 'lib-q') { libQ = e.target.value; renderLibrary(); }
  if (k === 'rot' && $('#anchor-hint')) $('#anchor-hint').innerHTML = anchorHint();
});

document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.input;
  if (k === 'pk-cat' && P) { P.cat = e.target.value; renderPicker(); }
  if (k === 'lib-cat') { libCat = e.target.value; renderLibrary(); }
  if (k === 'lib-sort') { libSort = e.target.value; renderLibrary(); }
  if (k === 'pk-sort' && P) {
    P.sort = e.target.value;
    S.init.settings.food_sort = P.sort;
    renderPicker();
    api('updateSettings', { values: { food_sort: P.sort } }, { silent: true, quiet: true }).catch(() => {});
  }
  if (k === 'ff-cat-sel') $('#ff-cat-new').hidden = e.target.value !== '__new';
});

document.addEventListener('keydown', e => {
  if (!$('#pin').hidden) {
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('del');
  } else if (e.key === 'Escape' && !$('#sheet').hidden) {
    closeSheet();
  }
});

// กลับมาเปิดแอปข้ามวัน → เด้งไปวันใหม่
let lastSeen = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.init) return;
  runQueue();
  const t = todayISO();
  if (t !== lastSeen) {
    lastSeen = t;
    S.weekDate = t;
    if (S.tab === 'today') loadDay(t); else S.date = t;
  }
});

boot();
