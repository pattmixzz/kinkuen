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
const DAY_TYPES = [['normal', 'ปกติ'], ['home', 'อยู่บ้าน'], ['party', 'ปาร์ตี้']];
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
  pin: ''
};
let P = null;          // state ของตัวเลือกเมนู
let busyCount = 0;

const view = () => $('#view');

// ======================= API =======================
async function api(action, payload, opt) {
  opt = opt || {};
  setBusy(1);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, token: S.token }, payload || {}))
    });
    const j = await res.json();
    if (!j.ok) {
      const e = new Error(j.error || 'เกิดข้อผิดพลาด');
      e.code = j.code;
      throw e;
    }
    return j.data;
  } catch (e) {
    if (e.code === 'AUTH') { logoutLocal(e.message); throw e; }
    if (!opt.silent) toast(e.code ? e.message : 'เชื่อมต่อไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่', true);
    throw e;
  } finally {
    setBusy(-1);
  }
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
  if (!API_URL || API_URL.indexOf('PASTE') !== -1) {
    document.body.innerHTML = '<div class="setup-msg"><h1>ยังไม่ได้ตั้งค่า API</h1><p>เปิดไฟล์ <code>config.js</code> แล้ววาง Web app URL จาก Apps Script</p></div>';
    return;
  }
  buildKeypad();
  if (!S.token) return showPin();
  try {
    await loadInit();
    showApp();
  } catch (e) {
    if (e.code !== 'AUTH') showPin('เชื่อมต่อไม่ได้ ลองใส่ PIN ใหม่');
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
    const r = await api('login', { pin: S.pin }, { silent: true });
    S.token = r.token;
    sessionStorage.setItem('ct_token', r.token);
    await loadInit();
    showApp();
  } catch (e) {
    S.pin = '';
    drawDots();
    $('#pin-msg').textContent = e.code ? e.message : 'เชื่อมต่อไม่ได้ เช็กอินเทอร์เน็ต';
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

async function loadInit() {
  S.init = await api('getInit');
}

function showApp() {
  $('#pin').hidden = true;
  $('#app').hidden = false;
  goTab(S.tab, true);
}

// ======================= navigation =======================
function goTab(tab, force) {
  const same = S.tab === tab;
  S.tab = tab;
  $$('#nav button').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (tab === 'today') {
    if (S.day && S.day.date === S.date && !(same && !force)) renderToday();
    else loadDay(S.date);
  }
  if (tab === 'progress') loadProgress();
  if (tab === 'summary') loadSummary(same && !force);
  if (tab === 'settings') renderSettings();
}

// ======================= วันนี้ =======================
async function loadDay(date) {
  S.date = date;
  if (!S.day || S.day.date !== date) view().innerHTML = '<p class="empty">กำลังโหลด…</p>';
  try { S.day = await api('getDay', { date: date }); } catch (e) { return; }
  if (S.tab === 'today') renderToday();
}

function plateSVG(total, target) {
  const r = 88, C = 2 * Math.PI * r;
  const pct = target ? Math.min(total / target, 1) : 0;
  const done = target && total >= target;
  return '<svg viewBox="0 0 220 220" class="plate' + (done ? ' done' : '') + '" aria-hidden="true">' +
    '<circle cx="110" cy="110" r="106" class="plate-edge"/>' +
    '<circle cx="110" cy="110" r="' + r + '" class="rim-track"/>' +
    '<circle cx="110" cy="110" r="' + r + '" class="rim-fill" stroke-dasharray="' + C.toFixed(1) +
    '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '" transform="rotate(-90 110 110)"/>' +
    '<circle cx="110" cy="110" r="68" class="plate-line"/></svg>';
}

function renderToday() {
  const d = S.day;
  if (!d) return;
  const today = todayISO();
  const isToday = d.date === today;

  let head = '<header class="day-head">' +
    '<button class="icon-btn" data-act="day-go" data-d="-1" aria-label="วันก่อนหน้า">‹</button>' +
    '<div><h1>' + (isToday ? 'วันนี้' : 'วัน' + WD_LONG[d.weekday]) + '</h1>' +
    '<div class="day-sub"><span>' + esc(thDate(d.date, { day: 'numeric', month: 'long' })) + '</span>' +
    (d.plan ? '<span class="plan-chip">แผน ' + esc(d.plan) + '</span>' : '') + '</div></div>' +
    '<button class="icon-btn" data-act="day-go" data-d="1" aria-label="วันถัดไป"' + (d.date >= today ? ' disabled' : '') + '>›</button>' +
    '</header>' +
    (isToday ? '' : '<button class="link-btn back-today" data-act="day-today">กลับไปวันนี้</button>');

  const seg = '<div class="seg" role="group" aria-label="ประเภทวัน">' + DAY_TYPES.map(t =>
    '<button data-act="set-type" data-type="' + t[0] + '" aria-pressed="' + (d.day_type === t[0]) + '">' +
    (t[0] === 'party' ? '🍻 ' : '') + t[1] + '</button>').join('') + '</div>';

  let hero = '';
  if (d.day_type === 'party') {
    hero = '<div class="day-card"><div class="big">🍻</div><h2>วันปาร์ตี้</h2>' +
      '<p>วันนี้ไม่ต้องบันทึกอะไร<br>ระบบไม่เอาไปคิดค่าเฉลี่ย</p></div>';
  } else if (!d.day_type) {
    hero = '<div class="day-card"><h2>วันหยุดนี้เป็นแบบไหน</h2><p>เลือกก่อน จะได้ตั้งเป้าให้ถูก</p>' +
      '<div class="row"><button class="btn" data-act="set-type" data-type="home">อยู่บ้าน</button>' +
      '<button class="btn btn-ghost" data-act="set-type" data-type="party">🍻 ปาร์ตี้</button></div></div>';
  } else {
    const rem = d.remaining;
    const note = rem > 0
      ? '<p class="plate-note">ยังขาดอีก <b class="num">' + fmtN(rem) + '</b> kcal</p>'
      : '<p class="plate-note ok">' + (rem === 0 ? 'ถึงเป้าพอดี 🎉' : 'ถึงเป้าแล้ว 🎉 เกินมา <b class="num">' + fmtN(-rem) + '</b>') + '</p>';
    hero = '<div class="plate-wrap">' + plateSVG(d.total, d.target) +
      '<div class="plate-center"><div class="plate-total num">' + fmtN(d.total) + '</div>' +
      '<div class="plate-sub">จาก ' + fmtN(d.target) + ' kcal</div></div></div>' + note +
      (d.plan && d.planned_total ? '<p class="plan-hint">กินตามแผน ' + esc(d.plan) + ' ครบ จะได้ประมาณ ' + fmtN(d.planned_total) + '</p>' : '');
  }

  let slips = '';
  if (d.day_type === 'normal' || d.day_type === 'home') {
    const unlogged = Object.keys(d.planned).filter(s => !d.logs.some(l => l.slot === s));
    if (unlogged.length > 1) {
      slips += '<button class="btn btn-ok plan-all" data-act="plan-day">กินตามแผนทุกมื้อที่เหลือ</button>';
    }
    slips += d.slots.map(slot => slipHTML(slot, d)).join('');
  }

  view().innerHTML = head + seg + hero + slips;
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

  return '<article class="slip' + (logged ? ' is-done' : '') + '">' +
    '<header class="slip-head"><h3>' + s + (fromPlan ? ' <span class="src-tag">ตามแผน</span>' : '') + '</h3>' + right + '</header>' +
    body + '<div class="slip-actions">' + actions.join('') + '</div></article>';
}

async function setDayType(type) {
  const d = S.day;
  const next = d.day_type === type && d.weekday > 5 ? '' : type;
  try { S.day = await api('setDayType', { date: d.date, day_type: next }); } catch (e) { return; }
  S.week = null; S.insights = null;
  renderToday();
}

// ======================= ตัวเลือกเมนู (picker) =======================
function openPicker(opt) {
  P = Object.assign({ q: '', cat: 'fav', cart: [], custom: false, customName: '' }, opt);
  openSheet(opt.title,
    '<input class="search" type="search" placeholder="ค้นหาเมนู เช่น กะเพรา" data-input="pk-q" aria-label="ค้นหาเมนู" autocomplete="off">' +
    '<div class="chips" id="pk-cats"></div>' +
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
  return list.sort((a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name, 'th'));
}

function categories() {
  const seen = [];
  S.init.foods.forEach(f => { if (f.active && seen.indexOf(f.category) === -1) seen.push(f.category); });
  return seen;
}

function renderPicker() {
  const cats = [['fav', '⭐ โปรด'], ['all', 'ทั้งหมด']].concat(categories().map(c => [c, c]));
  $('#pk-cats').innerHTML = cats.map(c =>
    '<button class="chip" data-act="pk-cat" data-cat="' + esc(c[0]) + '" aria-pressed="' + (!P.q && P.cat === c[0]) + '">' + esc(c[1]) + '</button>'
  ).join('');

  const list = pickerFoods();
  const inCart = P.cart.filter(c => c.food_id).map(c => c.food_id);
  $('#pk-list').innerHTML = list.length
    ? list.map(f =>
      '<li><button class="food-row' + (inCart.indexOf(f.id) !== -1 ? ' in-cart' : '') + '" data-act="pk-add" data-id="' + esc(f.id) + '">' +
      '<span>' + esc(f.name) + '<span class="meta">ต่อ 1 ' + esc(f.unit) + (f.note ? ' | ' + esc(f.note) : '') + '</span></span>' +
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
    '</select></label><label class="field"><span>จำนวน</span><input id="ck-qty" type="number" inputmode="decimal" min="0.5" step="0.5" value="1"></label></div>' +
    '<label class="check"><input type="checkbox" id="ck-save" checked> บันทึกเข้าคลังด้วย ครั้งหน้าจะได้กดเลือก</label>' +
    '<p class="muted small">ไม่รู้แคล ลองเทียบกับเมนูที่ใกล้เคียงในคลัง ถ้าเป็นของแพ็กดูจากฉลาก</p>' +
    '<button class="btn btn-ghost btn-block" data-act="pk-custom-add">ใส่ลงรายการ</button></div>';
}

function renderCart() {
  const total = P.cart.reduce((a, c) => a + c.kcal_unit * c.qty, 0);
  const label = P.mode === 'plan' ? 'บันทึกแผน' : P.mode === 'add' ? 'เพิ่มเข้ามื้อ' + P.slot : 'บันทึกมื้อ' + P.slot;
  const emptyLabel = P.mode === 'add' ? '' : (P.mode === 'plan' ? 'ล้างมื้อนี้ในแผน' : 'ล้างมื้อนี้');
  $('#pk-cart').innerHTML =
    (P.cart.length
      ? '<ul>' + P.cart.map((c, i) =>
        '<li><span>' + esc(c.name) + '</span><span class="step">' +
        '<button data-act="pk-qty" data-i="' + i + '" data-d="-0.5" aria-label="ลด">−</button><span class="num">' + c.qty + '</span>' +
        '<button data-act="pk-qty" data-i="' + i + '" data-d="0.5" aria-label="เพิ่ม">+</button></span>' +
        '<span class="num">' + fmtN(c.kcal_unit * c.qty) + '</span></li>').join('') + '</ul>'
      : '<p class="muted small">แตะเมนูด้านบนเพื่อเลือก เลือกได้หลายอย่าง</p>') +
    '<div class="cart-total"><span>รวม</span><span class="num">' + fmtN(total) + ' kcal</span></div>' +
    '<button class="btn btn-block" data-act="pk-save"' + (!P.cart.length && P.mode === 'add' ? ' disabled' : '') + '>' +
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
  c.qty = Math.round((c.qty + d) * 2) / 2;
  if (c.qty <= 0) P.cart.splice(i, 1);
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
      const r = await api('updatePlanSlot', { plan: P.plan, weekday: P.weekday, slot: P.slot, items: items });
      S.init.plans = r.plans;
      S.day = null;
      closeSheet();
      renderSettings();
      toast('บันทึกแผนแล้ว');
    } else {
      S.day = await api(P.mode === 'add' ? 'addLog' : 'replaceSlot', { date: P.date, slot: P.slot, items: items });
      const savedToDb = items.some(i => i.save_to_db);
      closeSheet();
      renderToday();
      toast(items.length ? 'บันทึกแล้ว' : 'ล้างมื้อแล้ว');
      if (savedToDb) loadInit().catch(() => {});
    }
  } catch (e) { /* toast แสดงแล้ว */ }
}

// ======================= น้ำหนัก + รูป =======================
async function loadProgress() {
  if (!S.weights) view().innerHTML = '<p class="empty">กำลังโหลด…</p>';
  else renderProgress();
  try {
    const r = await Promise.all([api('getWeights', { days: S.weightsRange }), api('listPhotos')]);
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

function renderProgress() {
  const ws = S.weights || [];
  const last = ws[ws.length - 1];
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
    '<h1 class="view-title">น้ำหนัก</h1>' +
    '<section class="weigh"><div class="row2">' +
    '<label class="field"><span>น้ำหนัก (กก.)</span><input id="w-kg" type="number" inputmode="decimal" step="0.1" min="20" max="300" value="' + (last ? last.weight_kg : '') + '"></label>' +
    '<label class="field"><span>วันที่</span><input id="w-date" type="date" value="' + todayISO() + '" max="' + todayISO() + '"></label></div>' +
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
      ? '<ul class="wlist">' + ws.slice(-10).reverse().map(w =>
        '<li><span>' + esc(thDate(w.date, { weekday: 'short', day: 'numeric', month: 'short' })) +
        (w.flag === 'post_party' ? '<span class="flag">หลังปาร์ตี้</span>' : '') + '</span>' +
        '<span class="num">' + fmtKg(w.weight_kg) + ' กก.</span>' +
        '<button class="x" data-act="w-del" data-date="' + w.date + '" aria-label="ลบน้ำหนักวันที่ ' + w.date + '">✕</button></li>').join('') + '</ul>'
      : '<p class="empty">ยังไม่มีข้อมูล เริ่มชั่งพรุ่งนี้เช้าได้เลย</p>') + '</section>';

  $('#ph-file').addEventListener('change', onPhotoFile);
  loadThumbs();
}

async function saveWeight() {
  const kg = Number($('#w-kg').value);
  const date = $('#w-date').value;
  if (!(kg >= 20 && kg <= 300)) return toast('ใส่น้ำหนักให้ถูกต้อง', true);
  try {
    const r = await api('logWeight', { date: date, weight_kg: kg });
    toast('บันทึก ' + fmtKg(kg) + ' กก. แล้ว' + (r.flag === 'post_party' ? ' (หลังปาร์ตี้ ไม่นับเทียบ)' : ''));
    S.week = null; S.insights = null;
    S.weights = await api('getWeights', { days: S.weightsRange });
    renderProgress();
  } catch (e) { /* toast แล้ว */ }
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
    const r = await api('getPhoto', { file_id: id, size: 'full' });
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
    toast('กำลังอัปโหลดรูป…');
    const data = await resizeImage(file, 1280, 0.82);
    await api('uploadPhoto', { date: todayISO(), data: data, mime: 'image/jpeg' });
    S.photos = await api('listPhotos');
    toast('อัปโหลดรูปแล้ว');
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
async function loadSummary(refresh) {
  if (refresh) { S.week = null; S.insights = null; }
  if (!S.week) view().innerHTML = '<p class="empty">กำลังโหลด…</p>';
  else renderSummary();
  try {
    const r = await Promise.all([
      api('getWeek', { date: S.weekDate }),
      S.insights ? Promise.resolve(S.insights) : api('getInsights', { weeks: 8 })
    ]);
    S.week = r[0]; S.insights = r[1];
  } catch (e) { return; }
  if (S.tab === 'summary') renderSummary();
}

function renderSummary() {
  const w = S.week, ins = S.insights;
  if (!w) return;
  const thisWeek = w.week_start <= todayISO() && todayISO() <= w.week_end;
  const wd = w.weight.diff;
  const diffTxt = wd == null ? 'ยังเทียบไม่ได้'
    : wd > 0 ? '📈 +' + wd.toFixed(2) + ' กก.' : wd < 0 ? '📉 ' + wd.toFixed(2) + ' กก.' : '➖ เท่าเดิม';

  const bars = w.days.map(d => {
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
    tip = '<section><h2>คำแนะนำ</h2><div class="tip ' + esc(sg.type) + '"><p>' + esc(sg.message) + '</p>' +
      (sg.new_target ? '<button class="btn" data-act="ins-apply" data-v="' + sg.new_target + '">ปรับเป้าเป็น ' + fmtN(sg.new_target) + ' kcal</button>' : '') +
      '</div>' +
      '<table class="tbl"><thead><tr><th>สัปดาห์</th><th>แผน</th><th>น้ำหนักเฉลี่ย</th><th>กินเฉลี่ย</th><th>🍻</th></tr></thead><tbody>' +
      ins.weeks.slice(-6).reverse().map(x => '<tr><td>' + esc(thDate(x.week_start)) + '</td><td>' + esc(x.plan) + '</td>' +
        '<td class="num">' + fmtKg(x.weight_avg) + '</td><td class="num">' + (x.kcal_avg ? fmtN(x.kcal_avg) : '–') + '</td>' +
        '<td class="num">' + (x.party_days || '') + '</td></tr>').join('') +
      '</tbody></table></section>';
  }

  view().innerHTML =
    '<header class="week-head"><button class="icon-btn" data-act="wk-go" data-d="-7" aria-label="สัปดาห์ก่อน">‹</button>' +
    '<div><h1>' + (thisWeek ? 'สัปดาห์นี้' : esc(thDate(w.week_start)) + ' ถึง ' + esc(thDate(w.week_end))) + '</h1>' +
    '<div class="day-sub">' + (thisWeek ? '<span>' + esc(thDate(w.week_start)) + ' ถึง ' + esc(thDate(w.week_end)) + '</span>' : '') +
    '<span class="plan-chip">แผน ' + esc(w.plan) + '</span></div></div>' +
    '<button class="icon-btn" data-act="wk-go" data-d="7" aria-label="สัปดาห์ถัดไป"' + (thisWeek ? ' disabled' : '') + '>›</button></header>' +
    '<div class="stats">' +
    '<div class="stat"><b class="num">' + (w.kcal.avg ? fmtN(w.kcal.avg) : '–') + '</b><span>kcal เฉลี่ยต่อวัน</span></div>' +
    '<div class="stat"><b class="num">' + w.kcal.hit_days + '/' + w.kcal.counted_days + '</b><span>วันที่ถึงเป้า</span></div>' +
    '<div class="stat"><b class="num">' + fmtKg(w.weight.avg) + '</b><span>น้ำหนักเฉลี่ย (กก.)</span></div>' +
    '<div class="stat"><b class="fit num">' + diffTxt + '</b><span>เทียบสัปดาห์ก่อน</span></div>' +
    '<div class="stat wide"><b>' + (w.party_days ? '🍻 ' + w.party_days + ' วัน' : 'ไม่ได้ไปปาร์ตี้ สัปดาห์กำไร 🎉') + '</b><span>วันปาร์ตี้</span></div>' +
    '</div>' +
    '<section><h2>รายวัน</h2><ul class="bars">' + bars + '</ul></section>' + tip;
}

async function applyTarget(v) {
  if (!confirm('ปรับเป้าวันปกติเป็น ' + fmtN(v) + ' kcal?')) return;
  try {
    const r = await api('updateSettings', { values: { weekday_target_kcal: v } });
    S.init.settings = r.settings;
    S.day = null; S.insights = null;
    toast('ปรับเป้าแล้ว');
    loadSummary(false);
  } catch (e) { /* toast แล้ว */ }
}

// ======================= ตั้งค่า =======================
function rotationPlans() {
  const rot = String(S.init.settings.plan_rotation || 'A').split(',').map(s => s.trim()).filter(Boolean);
  const all = rot.concat(S.init.plans.map(p => p.plan));
  return all.filter((p, i) => all.indexOf(p) === i).sort();
}

function renderSettings() {
  const st = S.init.settings;
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
    '<h1 class="view-title">ตั้งค่า</h1>' +

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
    '<div class="row2"><label class="field"><span>ลำดับการสลับแผน</span><input data-key="plan_rotation" value="' + esc(st.plan_rotation) + '"></label>' +
    '<label class="field"><span>เริ่มนับแผนแรกจาก</span><input data-key="rotation_anchor" type="date" value="' + esc(st.rotation_anchor) + '"></label></div>' +
    '<div class="field"><span>วันที่ใช้เทียบน้ำหนักแต่ละสัปดาห์</span><div class="days-pick">' +
    [1, 2, 3, 4, 5, 6, 7].map(n => '<label><input type="checkbox" data-wd-cmp="' + n + '"' + (compare.indexOf(n) !== -1 ? ' checked' : '') + '><span>' + WD_SHORT[n] + '</span></label>').join('') +
    '</div></div>' +
    '<button class="btn btn-block" data-act="st-save">บันทึกการตั้งค่า</button></div></section>' +

    '<section><h2>คลังเมนู</h2><div class="group"><p class="muted small">มีทั้งหมด ' + S.init.foods.length + ' เมนู แก้ kcal แล้วประวัติเก่าไม่เปลี่ยน</p>' +
    '<button class="btn btn-ghost btn-block" data-act="lib-open">เปิดคลังเมนู</button></div></section>' +

    '<section><h2>ความปลอดภัย</h2><div class="group" style="padding-top:14px">' +
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
    const r = await api('updateSettings', { values: values });
    S.init.settings = r.settings;
    S.init.slots = values.meal_slots.split(',').map(s => s.trim()).filter(Boolean);
    S.day = null; S.week = null; S.insights = null;
    toast('บันทึกการตั้งค่าแล้ว');
    renderSettings();
  } catch (e) { /* toast แล้ว */ }
}

// ---------- คลังเมนู ----------
let libQ = '';
function openLibrary() {
  libQ = '';
  openSheet('คลังเมนู',
    '<input class="search" type="search" placeholder="ค้นหาเมนู" data-input="lib-q" aria-label="ค้นหาเมนู" autocomplete="off">' +
    '<button class="btn btn-block" style="margin:10px 0" data-act="food-new">+ เพิ่มเมนูใหม่</button>' +
    '<ul class="food-list" id="lib-list"></ul>');
  renderLibrary();
}

function renderLibrary() {
  const q = libQ.trim().toLowerCase();
  const list = S.init.foods.filter(f => !q || f.name.toLowerCase().indexOf(q) !== -1)
    .sort((a, b) => (b.active - a.active) || a.category.localeCompare(b.category, 'th') || a.name.localeCompare(b.name, 'th'));
  $('#lib-list').innerHTML = list.map(f =>
    '<li><button class="food-row' + (f.active ? '' : ' off') + '" data-act="food-edit" data-id="' + esc(f.id) + '">' +
    '<span>' + (f.favorite ? '⭐ ' : '') + esc(f.name) + '<span class="meta">' + esc(f.category) + ' | ต่อ 1 ' + esc(f.unit) +
    (f.active ? '' : ' | ซ่อนอยู่') + '</span></span><span class="k num">' + fmtN(f.kcal) + '</span></button></li>').join('') ||
    '<li class="empty">ไม่เจอเมนูนี้</li>';
}

function openFoodForm(id) {
  const f = id ? S.init.foods.find(x => x.id === id) : { name: '', kcal: '', unit: 'จาน', category: 'จานหลัก', favorite: false, active: true, note: '' };
  const cats = categories();
  openSheet(id ? 'แก้เมนู' : 'เพิ่มเมนูใหม่',
    '<label class="field"><span>ชื่อเมนู</span><input id="ff-name" value="' + esc(f.name) + '"></label>' +
    '<div class="row2"><label class="field"><span>kcal ต่อหน่วย</span><input id="ff-kcal" type="number" inputmode="numeric" min="0" value="' + esc(f.kcal) + '"></label>' +
    '<label class="field"><span>หน่วย</span><input id="ff-unit" value="' + esc(f.unit) + '"></label></div>' +
    '<label class="field"><span>หมวด</span><input id="ff-cat" list="ff-cats" value="' + esc(f.category) + '"><datalist id="ff-cats">' +
    cats.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
    '<label class="field"><span>โน้ต</span><input id="ff-note" value="' + esc(f.note) + '" placeholder="เช่น ดูฉลาก"></label>' +
    '<label class="check"><input type="checkbox" id="ff-fav"' + (f.favorite ? ' checked' : '') + '> เมนูโปรด (ขึ้นก่อนในรายการ)</label>' +
    '<label class="check"><input type="checkbox" id="ff-active"' + (f.active ? ' checked' : '') + '> แสดงในรายการให้เลือก</label>' +
    '<button class="btn btn-block" data-act="food-save" data-id="' + esc(id || '') + '">' + (id ? 'บันทึกเมนู' : 'เพิ่มเมนู') + '</button>');
}

async function saveFood(id) {
  const fields = {
    name: $('#ff-name').value.trim(), kcal: Number($('#ff-kcal').value), unit: $('#ff-unit').value.trim() || 'ที่',
    category: $('#ff-cat').value.trim() || 'อื่นๆ', note: $('#ff-note').value.trim(),
    favorite: $('#ff-fav').checked, active: $('#ff-active').checked
  };
  if (!fields.name) return toast('ใส่ชื่อเมนูก่อน', true);
  if (!($('#ff-kcal').value !== '' && fields.kcal >= 0)) return toast('ใส่ kcal ก่อน', true);
  try {
    const r = id ? await api('updateFood', { id: id, fields: fields }) : await api('addFood', fields);
    S.init.foods = r.foods;
    S.day = null;
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
    await api('changePin', { old_pin: o, new_pin: n });
    closeSheet();
    toast('เปลี่ยน PIN แล้ว');
  } catch (e) { /* toast แล้ว */ }
}

// ======================= sheet =======================
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  P = null;
}

// ======================= events =======================
const ACTS = {
  'nav': el => goTab(el.dataset.tab),
  'key': el => pressKey(el.dataset.k),
  'sheet-close': () => closeSheet(),

  'day-go': el => loadDay(addDays(S.date, Number(el.dataset.d))),
  'day-today': () => loadDay(todayISO()),
  'set-type': el => setDayType(el.dataset.type),
  'plan-slot': async el => {
    try { S.day = await api('logPlanSlot', { date: S.date, slot: el.dataset.slot }); renderToday(); toast('บันทึกตามแผนแล้ว'); } catch (e) {}
  },
  'plan-day': async () => {
    try { S.day = await api('logPlanDay', { date: S.date }); renderToday(); toast('บันทึกทั้งวันแล้ว'); } catch (e) {}
  },
  'change-slot': el => {
    const slot = el.dataset.slot;
    const logs = S.day.logs.filter(l => l.slot === slot);
    const src = logs.length ? logs : (S.day.planned[slot] || []);
    const cart = src.map(x => x.food_id
      ? { food_id: x.food_id, name: x.name, kcal_unit: x.kcal_unit, qty: x.qty }
      : { name: x.name, kcal_unit: x.kcal_unit, qty: x.qty, custom: true, save_to_db: false });
    openPicker({ mode: 'replace', slot: slot, date: S.date, cart: cart, title: 'มื้อ' + slot });
  },
  'add-slot': el => openPicker({ mode: 'add', slot: el.dataset.slot, date: S.date, title: 'เพิ่มเข้ามื้อ' + el.dataset.slot }),
  'del-log': async el => {
    if (!confirm('ลบรายการนี้?')) return;
    try { S.day = await api('deleteLog', { log_id: el.dataset.id }); renderToday(); } catch (e) {}
  },

  'pk-cat': el => { P.cat = el.dataset.cat; P.q = ''; $('.search').value = ''; renderPicker(); },
  'pk-add': el => pickerAdd(el.dataset.id),
  'pk-qty': el => pickerQty(Number(el.dataset.i), Number(el.dataset.d)),
  'pk-custom-open': () => { P.custom = true; P.customName = P.q; renderCustom(); $('#ck-name').focus(); },
  'pk-custom-add': () => pickerCustomAdd(),
  'pk-save': () => pickerSave(),

  'w-save': () => saveWeight(),
  'w-range': async el => {
    S.weightsRange = Number(el.dataset.days);
    try { S.weights = await api('getWeights', { days: S.weightsRange }); } catch (e) { return; }
    renderProgress();
  },
  'w-del': async el => {
    if (!confirm('ลบน้ำหนักวันที่ ' + el.dataset.date + '?')) return;
    try {
      await api('deleteWeight', { date: el.dataset.date });
      S.weights = await api('getWeights', { days: S.weightsRange });
      S.week = null; S.insights = null;
      renderProgress();
    } catch (e) {}
  },
  'ph-pick': () => $('#ph-file').click(),
  'ph-compare': () => { S.compareMode = !S.compareMode; S.compareSel = []; renderProgress(); },
  'ph-open': el => openPhoto(el.dataset.id),
  'ph-del': async el => {
    if (!confirm('ลบรูปนี้? (ไฟล์จะถูกย้ายไปถังขยะใน Drive)')) return;
    try {
      await api('deletePhoto', { file_id: el.dataset.id });
      S.photos = await api('listPhotos');
      closeSheet(); renderProgress(); toast('ลบรูปแล้ว');
    } catch (e) {}
  },

  'wk-go': el => { S.weekDate = addDays(S.week.week_start, Number(el.dataset.d)); S.week = null; loadSummary(false); },
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
    if (!confirm('ออกจากระบบ?')) return;
    try { await api('logout', {}, { silent: true }); } catch (e) {}
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
  const t = todayISO();
  if (t !== lastSeen) {
    lastSeen = t;
    S.week = null; S.insights = null;
    if (S.tab === 'today') loadDay(t); else S.date = t;
  }
});

boot();
