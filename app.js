console.log("✅ JS file loaded and running");
// ==== CONFIG – paste your Apps Script Web App URL + token ====
// IMPORTANT: after unzipping, copy your existing API_URL and TOKEN
// values from your current app.js into CONFIG below.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzQmuBTqcODPLJc2U1GhIgKEK_xaa0buIdC55mIWv1hg7QoXwyxe36tMNfjyl3HIWFKew/exec',
  TOKEN: 'n7V6p3kFQw9zL1r8U2y4T0bC5mA7',
  WEEK_START: 1,
  REP_MIN: 8,
  REP_MAX: 12,
  OVERPERF_RATIO_2X: 2.0,      // ≥2× planned reps → big jump
  OVERPERF_RATIO_1P5X: 1.5,    // ≥1.5× planned reps → medium jump
  OVERPERF_BIG_INC_STEPS: 2,   // +2 increments for ≥2×
  OVERPERF_MED_INC_STEPS: 1,   // +1 increment for ≥1.5×
  RPE_VERY_HIGH: 9.5,          // deload threshold
  RPE_OK_FOR_REP_UP: 9,        // allowed to add reps
  DEFAULT_INC_LB: 5,
  DONE_TTL_HOURS: 8,
};

// ==== State ====
let state = {
  users: [],
  userId: 'u_camp',                     // 'u_camp' | 'u_annie'
  exercises: [], splits: [], logs: [],  // data
  byId: {},                             // exercise id → record
  currentSplit: '',
  period: 'week',
  eq: '', mg: '',
  page: 'list',
};

// ==== Persist UI ====
const store = {
  get(){ try { return JSON.parse(localStorage.getItem('uiState')||'{}'); } catch(_) { return {}; } },
  set(part){ const cur = store.get(); localStorage.setItem('uiState', JSON.stringify({...cur, ...part})); }
};

// Keep data fresh on resume
setInterval(()=>{ if(document.visibilityState==='visible') refreshFromBackend(); }, 10*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') refreshFromBackend(); });

// DOM helpers
const $  = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));

// ---- Tiny loading state + dot bounce animation ----
function ensureLoadingStyles(){
  let s = document.getElementById('dot-bounce-style');
  const css = `
    @keyframes dotBounce{0%{transform:translateY(0);opacity:.7}50%{transform:translateY(-4px);opacity:1}100%{transform:translateY(0);opacity:.7}}
    .consistency.loading .dot{ animation: dotBounce 700ms ease-in-out infinite; }

    /* Mini header loader (kept) */
    #miniLoad{ display:inline-flex; align-items:center; gap:6px; margin-left:8px; }
    #miniLoad .d{ width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.18); }
    #miniLoad.loading .d{ animation: dotBounce 700ms ease-in-out infinite; }

    /* Full-screen wipe overlay while switching profiles */
    #switchOverlay{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:9999; background: var(--accent); will-change: transform, opacity; }
    #switchOverlay .wipe{ display:flex; gap:12px; }
    #switchOverlay .dot{ width:14px; height:14px; border-radius:50%; border:2px solid #fff; background:transparent; box-shadow:0 0 0 0 rgba(0,0,0,0.12); }
    #switchOverlay .dot.on{ background:#fff; }
    #switchOverlay.loading .dot{ animation: dotBounce 700ms ease-in-out infinite; }

    /* Slide directions */
    /* Right-directed (enter from right, exit to left) */
    .dir-right.enter  { animation: wipeInRight 420ms cubic-bezier(.22,.61,.36,1) forwards; }
    .dir-right.exit   { animation: wipeOutLeft 360ms cubic-bezier(.4,0,.2,1) forwards; }
    /* Left-directed (enter from left, exit to right) */
    .dir-left.enter   { animation: wipeInLeft 420ms cubic-bezier(.22,.61,.36,1) forwards; }
    .dir-left.exit    { animation: wipeOutRight 360ms cubic-bezier(.4,0,.2,1) forwards; }

    @keyframes wipeInRight { from { transform: translateX(100%); } to { transform: translateX(0%); } }
    @keyframes wipeOutLeft { from { transform: translateX(0%); }   to { transform: translateX(-100%); } }
    @keyframes wipeInLeft  { from { transform: translateX(-100%); } to { transform: translateX(0%); } }
    @keyframes wipeOutRight{ from { transform: translateX(0%); }   to { transform: translateX(100%); } }
  `;
  if (!s) {
    s = document.createElement('style');
    s.id = 'dot-bounce-style';
    document.head.appendChild(s);
  }
  s.textContent = css;
}
function setLoading(on){
  state.loading = !!on;
  document.body.classList.toggle('is-loading', !!on);
  ensureLoadingStyles();

  // Keep the tiny header dots as a secondary cue
  const top = document.querySelector('.topbar');
  if (top) {
    let mini = document.getElementById('miniLoad');
    if (!mini) {
      mini = document.createElement('div');
      mini.id = 'miniLoad';
      top.appendChild(mini);
      for (let i=0;i<7;i++){
        const d=document.createElement('div'); d.className='d'; d.style.animationDelay=(i*70)+'ms'; mini.appendChild(d);
      }
    }
    mini.classList.toggle('loading', !!on);
    mini.style.visibility = on ? 'visible' : 'hidden';
  }

  // Ensure overlay exists
  let ov = document.getElementById('switchOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'switchOverlay';
    const wrap = document.createElement('div');
    wrap.className = 'wipe';
    for (let i=0;i<7;i++){
      const d = document.createElement('div'); d.className = 'dot'; d.style.animationDelay = (i*80)+'ms'; wrap.appendChild(d);
    }
    ov.appendChild(wrap);
    document.body.appendChild(ov);
  }

  // Direction based on the target user
  const dirClass = (state.userId === 'u_annie') ? 'dir-left' : 'dir-right';
  ov.classList.remove('dir-left','dir-right');
  ov.classList.add(dirClass);

  // Sync dot fill if we have week flags
  try {
    const wf = daysThisWeekFlags();
    ov.querySelectorAll('.dot').forEach((d,i)=> d.classList.toggle('on', !!wf.flags[i]));
  } catch(_){}

  // Play animations
  if (on) {
    ov.style.display = 'flex';
    ov.classList.add('loading'); // enable dot bounce during load
    // reset exit state if lingering
    ov.classList.remove('exit');
    // trigger enter
    void ov.offsetWidth; // reflow
    ov.classList.add('enter');
  } else {
    // stop dot bounce and play exit animation, then hide
    ov.classList.remove('loading');
    ov.classList.remove('enter');
    void ov.offsetWidth; // reflow
    ov.classList.add('exit');
    const done = ()=>{
      ov.removeEventListener('animationend', done);
      ov.style.display = 'none';
      ov.classList.remove('exit');
    };
    ov.addEventListener('animationend', done);
  }

  // Re-render summary so the big dots animate there too
  try { renderSummary(); } catch(_){}
}

// Prevent double-tap zoom inside the log modal (keeps pinch-zoom elsewhere)
(function(){
  let last=0;
  document.addEventListener('touchend', e=>{
    if (!$('#logModal')?.open) return;
    const now = Date.now();
    if (now - last < 300) e.preventDefault();
    last = now;
  }, { passive:false });
})();

// ==== LocalStorage (per-user namespace) ====
function _nsKey(base){ const uid = (state && state.userId) || 'u_camp'; return `${base}:${uid}`; }
function _loadMap(base){ try{ return JSON.parse(localStorage.getItem(_nsKey(base))||'{}'); }catch(_){ return {}; } }
function _saveMap(base, obj){ localStorage.setItem(_nsKey(base), JSON.stringify(obj||{})); }
// One-time migration: copy legacy unscoped keys into current user's namespace if the namespaced key is missing
(function _migrateLegacy(){ try{
  const uid = (state && state.userId) || 'u_camp';
  ['doneMap','lastSide'].forEach(base=>{
    const ns = _nsKey(base);
    if(!localStorage.getItem(ns) && localStorage.getItem(base)){
      const obj = JSON.parse(localStorage.getItem(base)||'{}');
      localStorage.setItem(ns, JSON.stringify(obj));
    }
  });
} catch(_){} })();

// ==== Small helpers ====
function fmt(n){ return Number(n||0).toFixed(0); }
function today(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`; // local YYYY-MM-DD to avoid off-by-one
}
function startOfPeriod(period){
  const d=new Date();
  if(period==='week'){ const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; }
  if(period==='month') return new Date(d.getFullYear(), d.getMonth(), 1);
  if(period==='year')  return new Date(d.getFullYear(), 0, 1);
  return d;
}
function inPeriod(dt, p){ const s=startOfPeriod(p); return new Date(dt)>=s; }
function e1rm(weight, reps){ return Number(weight)*(1+Number(reps)/30); }
function musclesOf(e){ return [e.primary,e.secondary,e.tertiary].filter(Boolean); }
function uniqueMuscles(list){ return [...new Set(list.flatMap(musclesOf).filter(Boolean))].sort(); }
function equipDisplay(lbl){
  const s = String(lbl||'').trim();
  if(!s) return 'Other';
  return s.replace(/\b\w/g,c=>c.toUpperCase())
          .replace(/\bEz\b/g,'EZ').replace(/\bV Bar\b/g,'V-Bar');
}
function markDone(exId){ const map=_loadMap('doneMap'); map[exId]=Date.now(); _saveMap('doneMap', map); }
function isDone(exId){ const map=_loadMap('doneMap'); const ts=map[exId]; if(!ts) return false; const ageH=(Date.now()-ts)/(1000*60*60); return ageH<CONFIG.DONE_TTL_HOURS; }
function chooseSide(exId){ const s=_loadMap('lastSide'); return s[exId]||'both'; }

function saveSide(exId, side){ const s=_loadMap('lastSide'); s[exId]=side; _saveMap('lastSide', s); }

// ---- Ensure yellow outline style for suggested workouts exists (non-destructive) ----
function ensureSuggestStyles(){
  if (document.querySelector('style[data-suggest-style]')) return; // already added
  // If CSS already defines .card.suggested, do nothing.
  const probe = document.createElement('div');
  probe.className = 'card suggested';
  probe.style.position='absolute'; probe.style.visibility='hidden'; probe.style.pointerEvents='none';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const hasOutline = cs.outlineStyle && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
  document.body.removeChild(probe);
  if (hasOutline) return;
  const s = document.createElement('style');
  s.setAttribute('data-suggest-style','');
  s.textContent = `
    :root{ --suggest: #f5d061; }
    .card.suggested{ outline: 2px dashed var(--suggest); outline-offset: -2px; }
    .card.suggested .repsets{ border-color: var(--suggest); color: var(--suggest); }
  `;
  document.head.appendChild(s);
}

// === Period tabs (Week/Month/Year) sliding pill helper ===
function ensurePeriodSlider(container, current){
  if(!container) return;
  // Ensure bar exists under buttons
  let bar = container.querySelector('.highlight-bar');
  if(!bar){
    bar = document.createElement('div');
    bar.className = 'highlight-bar';
    container.insertBefore(bar, container.firstChild);
  }

  // Determine target period and target button
  const val = (current||'week');
  const targetBtn = container.querySelector(`button[data-period="${val}"]`) ||
                    container.querySelector('button.active') ||
                    container.querySelector('button');

  // Maintain container class for CSS fallbacks
  container.classList.remove('week','month','year');
  container.classList.add(val);

  // Sync legacy active/aria state
  container.querySelectorAll('button').forEach(b=>{
    const p = (b.dataset.period || b.textContent.trim().toLowerCase());
    const on = (p===val);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // Pixel-perfect position/size for the pill
  try{
    const cRect = container.getBoundingClientRect();
    const bRect = targetBtn.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(container).paddingLeft)||0;
    const left  = Math.round((bRect.left - cRect.left) - padL);
    const width = Math.round(bRect.width);
    bar.style.width = width + 'px';
    bar.style.transform = `translateX(${left}px)`; // overrides class-based 0/100/200% if present
  }catch(_){ /* no-op if layout not ready */ }

  // Reposition on resize once per container
  if(!container.dataset.periodResizeBound){
    container.dataset.periodResizeBound = '1';
    window.addEventListener('resize', ()=>{
      const active = container.querySelector('button.active');
      const cur = active ? (active.dataset.period || active.textContent.trim().toLowerCase()) : val;
      ensurePeriodSlider(container, cur);
    });
  }

  // Also re-sync next frame to catch font/layout late changes
  requestAnimationFrame(()=>{
    const active = container.querySelector('button.active');
    const cur = active ? (active.dataset.period || active.textContent.trim().toLowerCase()) : val;
    try{ const _=container.offsetWidth; }catch(_){}
    try{ ensurePeriodSlider(container, cur); }catch(_){}
  });
}

// ==== User scoping (strict) ====
// Exercises: ONLY the current user's exercises. No shared defaults.
function exercisesForUser(){
  // Show all exercises (shared library).
  // Logs & “latest” are still per-user via logsForUser().
  return state.exercises || [];
}
// Logs: ONLY the current user's logs.
function logsForUser(){
  const uid = state.userId;
  return state.logs.filter(l => (l.user_id || 'u_camp') === uid);
}

// ==== Latest log / Suggestion ====
function isSkip(l){ const v=String(l.skip_progress??'').toLowerCase(); return v==='1'||v==='true'||v==='yes'; }
function latestFor(exId, side){
  const want = String(side || 'both').toLowerCase();
  const norm = x => String(x || 'both').toLowerCase();
  const valid = logsForUser().filter(l => l.exercise_id===exId && !isSkip(l));
  if(!valid.length) return null;
  const same = valid.filter(l => norm(l.side)===want);
  const arr = same.length ? same : valid;
  arr.sort((a,b)=> new Date(b.timestamp||b.date) - new Date(a.timestamp||a.date));
  return arr[0] || null;
}

// ---- Previous-set display helpers ----
function _prevTripletData(exId, side){
  const last = latestFor(exId, side);
  if(!last) return null;
  const w = fmt(last.weight_lb);
  const r = fmt(last.planned_reps);
  const s = fmt(last.sets_done || (state.byId[exId]?.sets) || 3);
  return { w, r, s };
}
function prevLineCardHTML(exId, side){
  const d = _prevTripletData(exId, side);
  return d ? `<div class="prevline">(${d.w}x${d.r}x${d.s})</div>` : '';
}
function prevLineInlineHTML(exId, side){
  const d = _prevTripletData(exId, side);
  return d ? ` <span class="prevline">(${d.w}x${d.r}x${d.s})</span>` : '';
}

// ==== Delta helpers ====
function _sign(n){ return n>0?'+':(n<0?'-':''); }
function _fmtAbs(n){ return Math.abs(Math.round(Number(n)||0)); }
function _deltaSpan(val, unit){
  const s = _sign(val);
  const abs = _fmtAbs(val);
  const txt = (s? s : '') + abs + ' ' + unit;
  const color = val>0? 'var(--accent)' : (val<0? 'var(--danger)' : 'var(--muted)');
  return `<span class="delta" style="color:${color}">${txt}</span>`;
}
function deltaLineHTML(exId, side){
  const want = String(side||'both').toLowerCase();

  const tsOf = (l)=>{
    if(!l) return 0; const t = l.timestamp || l.date; return t ? new Date(t).getTime() : 0;
  };

  // Build a "lb / Rep" pair but include only non-zero deltas
  const pairIfChanged = (dW, dR)=>{
    const segs = [];
    if (Number(dW||0) !== 0) segs.push(_deltaSpan(dW, 'lb'));
    if (Number(dR||0) !== 0) segs.push(_deltaSpan(dR, 'Rep'));
    return segs.join(' / ');
  };

  // Explicit unilateral: show only non-zero parts; hide if nothing changed
  if(want!=="both"){
    const sug = suggestNext(exId, want);
    const last = latestFor(exId, want);
    if(!last) return '';
    const dW = Number(sug.weight||0) - Number(last.weight_lb||0);
    const dR = Number(sug.reps||0)   - Number(last.planned_reps||0);
    const txt = pairIfChanged(dW, dR);
    return txt ? ` <span class="prevline">(${txt})</span>` : '';
  }

  // BOTH requested → decide unified vs per-side based on the most recent log
  const lastBoth = latestFor(exId, 'both');
  const lastR = latestFor(exId, 'right');
  const lastL = latestFor(exId, 'left');
  const newest = Math.max(tsOf(lastBoth), tsOf(lastR), tsOf(lastL));

  // If last log was BOTH → show unified pair, only if any change
  if(lastBoth && tsOf(lastBoth) === newest){
    const sug = suggestNext(exId, 'both');
    const dW = Number(sug.weight||0) - Number(lastBoth.weight_lb||0);
    const dR = Number(sug.reps||0)   - Number(lastBoth.planned_reps||0);
    const txt = pairIfChanged(dW, dR);
    return txt ? ` <span class="prevline">(${txt})</span>` : '';
  }

  // Otherwise, show per-side weight deltas only if non-zero; hide line if both zero
  const parts = [];
  if(lastR){
    const sugR = suggestNext(exId, 'right');
    const dWR = Number(sugR.weight||0) - Number(lastR.weight_lb||0);
    if (dWR !== 0) {
      const col = dWR > 0 ? 'var(--accent)' : 'var(--danger)';
      const seg = `<span style="color:${col}">Right: ${_sign(dWR)}${_fmtAbs(dWR)} lb</span>`;
      parts.push(seg);
    }
  }
  if(lastL){
    const sugL = suggestNext(exId, 'left');
    const dWL = Number(sugL.weight||0) - Number(lastL.weight_lb||0);
    if (dWL !== 0) {
      const col = dWL > 0 ? 'var(--accent)' : 'var(--danger)';
      const seg = `<span style="color:${col}">Left: ${_sign(dWL)}${_fmtAbs(dWL)} lb</span>`;
      parts.push(seg);
    }
  }
  return parts.length ? ` <span class="prevline">(${parts.join(', ')})</span>` : '';
}
function suggestNext(exId, side){
  const ex = state.byId[exId];
  if(!ex){
    return { weight: 0, reps: 8, sets: 3, height: 0 };
  }
  const lastRaw = latestFor(exId, side);
  if(!lastRaw){
    return {
      weight: Number(ex.default_weight||0),
      reps:   8,
      sets:   Number(ex.sets||3),
      height: Number(ex.default_height||0)
    };
  }

  // Normalize fields so the perf logic always has numbers
  const last = {
    planned_reps: Number(lastRaw.planned_reps ?? 8),
    fail_reps:    Number((lastRaw.fail_reps   ?? lastRaw.planned_reps) ?? 8),
    weight_lb:    Number(lastRaw.weight_lb    ?? ex.default_weight ?? 0),
    rpe_set2:     Number(lastRaw.rpe_set2     ?? 8)
  };

  // Use the consolidated logic (see computeNextFromPerformance below)
  const out = computeNextFromPerformance(last, ex);
  return {
    weight: Number(out.weight||0),
    reps:   Number(out.reps||8),
    sets:   Number(ex.sets||3),
    height: Number(ex.default_height||0)
  };
}

// ==== Improvements / Streaks (use ONLY current user's logs) ====
function rankImprovements(period){
  const logs = logsForUser().filter(l=>inPeriod(l.date||l.timestamp, period));
  const byEx = new Map();
  for(const l of logs){
    const t=new Date(l.timestamp||l.date);
    const v=e1rm(l.weight_lb||0, l.planned_reps||0);
    const a=byEx.get(l.exercise_id)||[]; a.push({t,v}); byEx.set(l.exercise_id,a);
  }
  const out=[]; const start=startOfPeriod(period), now=new Date();
  for(const [id,arr] of byEx.entries()){
    arr.sort((a,b)=>a.t-b.t);
    const startVal=(arr.find(x=>x.t>=start)||arr[0]||{}).v||0;
    const endVal=(arr.filter(x=>x.t<=now).slice(-1)[0]||{}).v||0;
    out.push({id, delta:endVal-startVal});
  }
  out.sort((a,b)=>b.delta-a.delta); return out;
}
function streaks(){
  const allLogs = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  const weeks = new Map();
  for(const l of allLogs){
    const d=new Date(l.date||l.timestamp);
    const weekStart = new Date(d); weekStart.setDate(d.getDate()-((d.getDay()+6)%7)); weekStart.setHours(0,0,0,0);
    const key = weekStart.toISOString().slice(0,10);
    weeks.set(key, (weeks.get(key)||0)+1);
  }
  const keys=[...weeks.keys()].sort();
  let cur=0,best=0,perfect=0, prev=null;
  for(const k of keys){
    const idx = keys.indexOf(k);
    if(prev===null || idx===prev+1) cur++; else cur=1;
    if(weeks.get(k)>=5) perfect++;
    if(cur>best) best=cur;
    prev=idx;
  }
  return { current:cur, best, perfectWeeks:perfect };
}

// ==== API ====
async function apiGet(params){
  const url=new URL(CONFIG.API_URL);
  url.searchParams.set('token', CONFIG.TOKEN);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,v));
  const res=await fetch(url.toString(), {method:'GET'});
  return res.json();
}
async function apiPost(action, payload){
  const url=new URL(CONFIG.API_URL);
  url.searchParams.set('token', CONFIG.TOKEN);
  url.searchParams.set('action', action);
  const res=await fetch(url.toString(), {method:'POST', body: JSON.stringify(payload)});
  return res.json();
}

// ==== Fetch & boot ====
async function fetchAll(){
  const data = await apiGet({action:'getAll'});
  if(data.error){ console.error(data.error); toast('API error: '+data.error); return; }
  state.exercises = data.exercises||[];
  state.splits    = data.splits||[];
  state.logs      = data.logs||[];
  state.users     = (data.users && data.users.length) ? data.users : [{user_id:'u_camp',name:'Camp'},{user_id:'u_annie',name:'Annie'}];

  // Build map only from CURRENT user's exercises to avoid cross-user names in Summary
  state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));

  ensureSuggestStyles();
  renderUserChips();
  renderFilters();
  renderList();
  renderSummary();
}

// Robust nav binding
function bindNav(){
  
}

// Restore UI
(function restoreUI(){
  const s=store.get();
  if(s.page) state.page=s.page;
  if(s.split!==undefined) state.currentSplit=s.split;
  if(s.period) state.period=s.period;
  if(s.eq!==undefined) state.eq=s.eq;
  if(s.mg!==undefined) state.mg=s.mg;
  if(s.userId) state.userId=s.userId;
})();

// Period tabs
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.period-tabs button'); if(!btn) return;
  const wrap = btn.closest('.period-tabs') || btn.parentElement;
  const val = (btn.dataset.period || btn.textContent.toLowerCase());
  ensurePeriodSlider(wrap, val); // slide the pill + sync legacy state
  state.period = val;
  store.set({period: state.period});
  renderSummary();
});

(function(){
  const cont = document.querySelector('.period-tabs');
  if(!cont) return;
  const activeBtn = cont.querySelector('button.active');
  const cur = state.period || (activeBtn ? (activeBtn.dataset.period || activeBtn.textContent.trim().toLowerCase()) : 'week');
  ensurePeriodSlider(cont, cur);
})();

// ---- Weekly unique-day count per user (local week) ----
function _weekDayCountFor(uid){
  const ws = (CONFIG && Number.isFinite(CONFIG.WEEK_START)) ? CONFIG.WEEK_START : 0; // 0=Sun default
  const now   = new Date();
  const start = _startOfWeekLocal(now, ws);
  const end   = new Date(start); end.setDate(start.getDate()+7);
  const seen = new Set();
  for (const l of (state.logs || [])) {
    if ((l.user_id || 'u_camp') !== uid) continue;
    const key = _localYMDFromLog(l); if (!key) continue;
    const dt = new Date(key + 'T12:00:00');
    if (dt >= start && dt < end) seen.add(key);
  }
  return seen.size;
}

// ---- Render the mini scoreboard between the two user chips ----
function renderScoreMini(){
  const row = document.querySelector('#userRow');
  if (!row) return;

  const chips = Array.from(row.querySelectorAll('.user-chip'));
  const campBtn  = chips.find(b => (b.dataset.user||'')==='u_camp')  || chips[0];
  const annieBtn = chips.find(b => (b.dataset.user||'')==='u_annie') || chips[1];
  if(!campBtn || !annieBtn) return;

  // Layout: 4 columns (Camp chip | Camp count | Annie count | Annie chip)
  try {
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto auto 1fr';
    row.style.columnGap = '12px';
    row.style.alignItems = 'center';
  } catch (_) {}

  // Create/update cubes
  let campBox = document.getElementById('scoreCampBox');
  let annBox  = document.getElementById('scoreAnnieBox');
  if(!campBox){ campBox=document.createElement('div'); campBox.id='scoreCampBox'; }
  if(!annBox ){ annBox =document.createElement('div'); annBox.id ='scoreAnnieBox'; }

  // Style the cubes consistently (no transforms, no rAF)
  const cs = getComputedStyle(campBtn);
  const h  = cs.height || '40px';
  const r  = cs.borderRadius || '12px';
  const styleCube = (el)=>{
    el.style.display        = 'inline-flex';
    el.style.alignItems     = 'center';
    el.style.justifyContent = 'center';
    el.style.height         = h;
    el.style.width          = h;           // square
    el.style.lineHeight     = h;           // center text vertically
    el.style.border         = '1px solid var(--line)';
    el.style.borderRadius   = r;
    el.style.background     = 'var(--soft)';
    el.style.fontWeight     = '800';
    el.style.fontSize       = '13px';
    el.style.boxSizing      = 'border-box';
    el.style.color          = 'var(--fg)';
    el.style.boxShadow      = 'none';
    el.classList.remove('lead');
  };
  styleCube(campBox); styleCube(annBox);

  // Counts for this week (unique workout days)
  const cCount = _weekDayCountFor('u_camp');
  const aCount = _weekDayCountFor('u_annie');
  campBox.textContent = String(cCount);
  annBox.textContent  = String(aCount);

  // Leader highlight with current accent (ties: none)
  const campAhead  = cCount > aCount;
  const annieAhead = aCount > cCount;
  const applyLead = (el, on)=>{
    if (on) {
      el.style.borderColor = 'var(--accent)';
      el.style.boxShadow   = 'inset 0 0 0 2px var(--accent-weak)';
    } else {
      el.style.borderColor = 'var(--line)';
      el.style.boxShadow   = 'none';
    }
  };
  applyLead(campBox, campAhead);
  applyLead(annBox,  annieAhead);

  // Order: Camp chip, Camp count, Annie count, Annie chip
  if (campBox.parentElement !== row) row.insertBefore(campBox, annieBtn);
  if (annBox.parentElement  !== row) row.insertBefore(annBox,  annieBtn);
  else if (annBox.nextSibling !== annieBtn) row.insertBefore(annBox, annieBtn);
}

// ==== Filters & chips ====
function renderUserChips(){
  const row = document.querySelector('#userRow');
  if(!row) return;
  const byId = Object.fromEntries((state.users||[]).map(u => [u.user_id, u.name]));
  row.querySelectorAll('.user-chip').forEach(btn => {
    const uid = btn.dataset.user;
    if (byId[uid]) btn.textContent = byId[uid];
    btn.classList.toggle('active', uid === state.userId);
    btn.onclick = async () => {
      state.userId = uid; store.set({ userId: uid });
      document.body.classList.toggle('annie', state.userId === 'u_annie');
      row.querySelectorAll('.user-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      // Pull fresh data (so manual sheet edits are reflected)
      setLoading(true);
      await refreshFromBackend();
      setLoading(false);

      // After refresh, rebuild byId using the shared library
      state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));

      renderFilters();
      renderList();
      renderSummary();
      renderScoreMini();
    };
      renderScoreMini();
  });
  document.body.classList.toggle('annie', state.userId === 'u_annie');
}

function renderFilters(){
  // Splits (only the current user's splits)
  const splitSel=$('#splitSelect');
  const splits=[...new Set(state.splits.filter(s=>(s.user_id||'u_camp')===state.userId).map(s=>String(s.split_name||'').trim()))].filter(Boolean);
  splitSel.innerHTML = `<option value="">All</option>` + splits.map(s=>`<option>${s}</option>`).join('');
  splitSel.value = state.currentSplit||'';
  splitSel.onchange = ()=>{ state.currentSplit=splitSel.value; store.set({split: state.currentSplit}); renderList(); };

  const items = exercisesForUser();

  // Equipment
  const eqRaw=[...new Set(items.map(e=>String(e.equipment||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const eqOpts=eqRaw.map(lbl=>({ value: lbl.toLowerCase(), label: lbl.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bEz\b/g,'EZ').replace(/\bV Bar\b/g,'V-Bar') }));
  $('#equipmentFilter').innerHTML = `<option value="">Equipment</option>` + eqOpts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');

  // Muscle
  const muscles = uniqueMuscles(items);
  $('#muscleFilter').innerHTML = `<option value="">Muscle</option>` + muscles.map(x=>`<option>${x}</option>`).join('');

  // selections
  $('#equipmentFilter').value = state.eq||'';
  $('#muscleFilter').value    = state.mg||'';
  $('#equipmentFilter').onchange = ()=>{ state.eq=$('#equipmentFilter').value; store.set({eq: state.eq}); renderList(); };
  $('#muscleFilter').onchange    = ()=>{ state.mg=$('#muscleFilter').value; store.set({mg: state.mg}); renderList(); };

  // add/reset
  $('#btnAddExercise').onclick = ()=> openAddWizard();
  $('#btnResetDone').onclick   = ()=>{ localStorage.removeItem(_nsKey('doneMap')); renderList(); };
  $('#btnResetDone').textContent = 'Reset';
}

// ==== Cards/List ====
function makeCardHTML(e){
  const sugg = suggestNext(e.id, chooseSide(e.id));
  const variation = e.variation ? `<span class="variation">• ${e.variation}</span>` : '';
  const equip = e.equipment ? e.equipment : '';
  const h = Number(e.default_height||0);
  const setupLine = [equip, (h>0?`Height ${fmt(h)}`:'')].filter(Boolean).join(' • ');
  const done = isDone(e.id);

  return `
  <div class="card ${done?'done':''}" data-id="${e.id}">
    <div class="left">
      <div class="name-line"><span class="name">${e.name}</span>${variation}</div>
      <div class="meta line">${setupLine || '&nbsp;'}</div>
      <div class="weight line">
        ${fmt(sugg.weight)} lb${deltaLineHTML(e.id, chooseSide(e.id))}
      </div>
    </div>
    <div class="pill repsets">${fmt(sugg.reps)} × ${fmt(sugg.sets)}</div>
  </div>`;
}
function groupByEquipmentHTML(arr){
  const map=new Map();
  for(const e of arr){ const key=equipDisplay(e.equipment||''); if(!map.has(key)) map.set(key, []); map.get(key).push(e); }
  const keys=[...map.keys()].sort((a,b)=>a.localeCompare(b));
  return keys.map(k=>`
    <div class="subgroup">
      <div class="group-title">${k}</div>
      <div class="cards">${map.get(k).map(makeCardHTML).join('')}</div>
    </div>`).join('');
}
function renderList(){
  const eqVal=(state.eq||'').toLowerCase();
  const mgVal=state.mg||'';

  const wrapSel   = $('#selectedSplitWrap');
  const listSel   = $('#selectedSplitList');
  const otherTitle= $('#otherTitle');
  const otherList = $('#workoutList');

  let items = exercisesForUser().slice();
  if(eqVal) items = items.filter(e=>String(e.equipment||'').toLowerCase()===eqVal);
  if(mgVal) items = items.filter(e=>musclesOf(e).includes(mgVal));

  if(state.currentSplit){
    const splitRows = state.splits
      .filter(s=>String(s.split_name||'')===state.currentSplit && (s.user_id||'u_camp')===state.userId)
      .sort((a,b)=>Number(a.order||0)-Number(b.order||0));
    const splitIds = splitRows.map(r=>r.exercise_id);

    const top  = splitIds.map(id=>items.find(e=>e.id===id)).filter(Boolean);
    const rest = items.filter(e=>!splitIds.includes(e.id));

    wrapSel.hidden = false;
    listSel.innerHTML = top.map(makeCardHTML).join('');
    otherTitle.hidden = false;
    otherList.innerHTML = (!eqVal && !mgVal) ? groupByEquipmentHTML(rest) : rest.map(makeCardHTML).join('');
  } else {
    wrapSel.hidden = true;
    otherTitle.hidden = true;
    otherList.innerHTML = (!eqVal && !mgVal) ? groupByEquipmentHTML(items) : items.map(makeCardHTML).join('');
  }

  $$('#workoutList .card, #selectedSplitList .card').forEach(c=>{
    c.addEventListener('click',()=>openLog(c.dataset.id));
  });

  if(!items.length){
    otherList.innerHTML = `<div class="meta" style="padding:8px 4px;">No exercises for this user yet.</div>`;
  }
}

// ==== Log modal ====
let modal, stepVals, curEx;

function openLog(exId){
  curEx=state.byId[exId]; if(!curEx) return;
  modal=$('#logModal');
  modal.dataset.didOther='';
  delete modal.dataset.arranged; // ensure arrangeLogLayout() re-runs each open

  $('#logTitle').innerHTML = curEx.name + (curEx.variation ? ` <span class="variation">• ${curEx.variation}</span>` : '');
  const baseSub = [musclesOf(curEx).filter(Boolean).join('/'), curEx.equipment].filter(Boolean).join(' • ');
  $('#logSub').innerHTML = baseSub + prevLineInlineHTML(exId, chooseSide(exId));

  // Patch: always start unilateral exercises on right, bilateral stays both
  let side = chooseSide(exId);
  if (side !== 'both') side = 'right';

  const seg = $('#sideSeg');
  const wrap = seg.querySelector('.seg-buttons') || seg;
  // Clear any lingering active/selected classes (remove legacy classes)
  wrap.querySelectorAll('button').forEach(b=>b.classList.remove('active','selected','current','is-active'));
  // Enforce visual order: Left, Both, Right
  ['left','both','right'].forEach(key=>{
    const b = wrap.querySelector(`button[data-side="${key}"]`);
    if(b) wrap.appendChild(b);
  });
  // Activate exactly one — prefer saved side; otherwise Both
  const toActivate = wrap.querySelector(`button[data-side="${side}"]`) || wrap.querySelector('button[data-side="both"]');
  if(toActivate) toActivate.classList.add('active');
  // Sync focus & aria to avoid a second visual highlight from :focus styles
  wrap.querySelectorAll('button').forEach(b=>{
    b.setAttribute('aria-pressed','false');
    try { b.blur(); } catch(_){}
  });
  if (toActivate) {
    toActivate.setAttribute('aria-pressed','true');
  }

  const s=suggestNext(exId, side);
  stepVals={ side, sets_done:Number(curEx.sets||3), planned_reps:s.reps, weight_lb:s.weight, height:Number(s.height||0), fail_reps:s.reps, rpe_set2:8 };
  updateSteppers();
  $('#logNotes').value='';
  arrangeLogLayout();

  // side toggle (updated: container class approach)
  (function() {
    const sideToggle = document.querySelector('#sideSeg .seg-buttons') || document.getElementById('sideSeg');
    if (!sideToggle) return;
    const sideButtons = sideToggle.querySelectorAll('button');
    // Ensure container has slider class and a single highlight bar for smooth animation
    sideToggle.classList.add('side-toggle');
    if (!sideToggle.querySelector('.highlight-bar')) {
      const bar = document.createElement('div');
      bar.className = 'highlight-bar';
      sideToggle.appendChild(bar);
    }
    // Remove any prior event listeners by replacing onclick
    sideButtons.forEach(btn => {
      btn.onclick = null;
    });
    sideButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.side;
        // Remove .left, .both, .right classes from container
        sideToggle.classList.remove('left', 'both', 'right');
        sideToggle.classList.add(value);
        stepVals.side = value;
        // Update aria/focus so only the chosen button has the focus highlight
        sideButtons.forEach(x => {
          x.setAttribute('aria-pressed','false');
        });
        btn.setAttribute('aria-pressed','true');
        try { btn.focus({ preventScroll: true }); } catch(_){}
        saveSide(curEx.id, stepVals.side);
        const s = suggestNext(curEx.id, stepVals.side);
        stepVals.weight_lb = s.weight; stepVals.planned_reps = s.reps; stepVals.height = s.height; updateSteppers();
        $('#logSub').innerHTML = baseSub + prevLineInlineHTML(curEx.id, stepVals.side);
        arrangeLogLayout();
        // Keep legacy button active state (fallback) while slider animates
        sideButtons.forEach(x => x.classList.toggle('active', x === btn));
      });
    });
    // Set initial container class
    const currentValue = stepVals.side || 'both';
    sideToggle.classList.remove('left','both','right');
    sideToggle.classList.add(currentValue);
    // Sync legacy active state on load
    sideButtons.forEach(x => x.classList.toggle('active', x.dataset.side === currentValue));
  })();

  // Run layout now; show modal
  arrangeLogLayout();
  modal.showModal();
  // Ensure focus lands on the active side button (prevents extra focus highlight on Left)
  setTimeout(()=>{
    const activeBtn = wrap.querySelector('button.active');
    if(activeBtn){ try { activeBtn.focus({ preventScroll: true }); } catch(_){} }
  }, 0);
}

// Re-arrange the log modal UI (rows & buttons) and tweak styles
function arrangeLogLayout(){
  console.log("👉 arrangeLogLayout triggered");
  const modal = $('#logModal');
  if(!modal) return;
  const VSPACE = '12px'; // single source of truth for vertical spacing
  // Helper to parse pixel values
  const px = v => {
    const n = parseFloat(String(v||'').replace('px',''));
    return Number.isFinite(n) ? n : 0;
  };

  // Header: move title+subtitle up together and keep a small gap between them
  const formWrap = modal.querySelector('.logform');
  if (formWrap){
    // Reduce top padding so the whole header sits higher, and shrink horizontal padding on mobile
    formWrap.style.setProperty('padding-top','12px','important');
    formWrap.style.setProperty('padding-left','8px','important');
    formWrap.style.setProperty('padding-right','8px','important');
    formWrap.style.setProperty('width','100%','important');
  }
  const title = $('#logTitle');
  const sub   = $('#logSub');
  if (title){
    title.style.setProperty('text-align','center','important');
    title.style.setProperty('margin-top','0','important');
    title.style.setProperty('padding-top','0','important');
    title.style.setProperty('padding-bottom','4px','important'); // tighter gap to subtitle
    title.style.setProperty('line-height','1.15','important');
  }
  if (sub){
    sub.style.setProperty('text-align','center','important');
    sub.style.setProperty('margin-top','0','important');
    sub.style.setProperty('margin-bottom','12px','important'); // overall header-to-content spacing
    sub.style.setProperty('line-height','1.2','important');
    sub.style.setProperty('display','block','important');
  }

  // Breathing space below side segment and layout/label tweaks
  const sideSeg = $('#sideSeg');
  if (sideSeg){
    // Ensure container itself doesn't constrain width
    sideSeg.style.setProperty('padding','0','important');
    sideSeg.style.setProperty('margin',`6px 0 ${VSPACE}`,'important');
    sideSeg.style.setProperty('display','block','important');
    sideSeg.style.setProperty('width','100%','important');

    // Remove the "Side" label/text element if present
    const labelEl = sideSeg.querySelector(':scope > span, :scope > .label');
    if(labelEl){
      try { labelEl.remove(); } catch(_) { labelEl.style.setProperty('display','none','important'); }
    }

    // Grid the three buttons to span evenly full width, no gaps
    const btnWrap = sideSeg.querySelector('.seg-buttons') || sideSeg;
    btnWrap.style.setProperty('display','grid','important');
    btnWrap.style.setProperty('grid-template-columns','repeat(3, 1fr)','important');
    btnWrap.style.setProperty('grid-auto-rows','1fr','important');
    btnWrap.style.setProperty('gap','0','important');
    btnWrap.style.setProperty('width','100%','important');
    btnWrap.style.setProperty('margin','0','important');

    btnWrap.querySelectorAll('button').forEach(b=>{
      b.style.setProperty('width','100%','important');
      b.style.setProperty('min-width','0','important');
      b.style.setProperty('justify-content','center','important');
      b.style.setProperty('border-radius','0','important'); // let grid edges meet
      b.style.setProperty('box-sizing','border-box','important');
    });

    // Round only the outer corners so the row still looks like a pill group
    const btns = btnWrap.querySelectorAll('button');
    if(btns.length>=3){
      btns[0].style.setProperty('border-top-left-radius','12px','important');
      btns[0].style.setProperty('border-bottom-left-radius','12px','important');
      btns[1].style.setProperty('border-radius','0','important');
      btns[2].style.setProperty('border-top-right-radius','12px','important');
      btns[2].style.setProperty('border-bottom-right-radius','12px','important');
    }
  }

  // Notes breathing space: use whatever CSS currently sets (this is our reference)
  let refGapPx = 0;
  const notes = $('#logNotes');
  if(notes){
    const notesWrap = notes.closest('.field') || notes.parentElement;
    if(notesWrap){
      const cs = getComputedStyle(notesWrap);
      refGapPx = px(cs.marginTop) || 0;
    }
  }
  // Fallback if CSS reports 0 (keep prior default)
  if(!refGapPx) refGapPx = px(VSPACE) || 12;

  // Stack container and steppers — drive spacing via container gap only
  const stack = modal.querySelector('.stack');
  if(!stack) return;
  stack.style.setProperty('gap', refGapPx + 'px', 'important');
  stack.style.setProperty('margin','0','important');
  // Ensure stack fills width and its children aren't capped
  stack.style.setProperty('width','100%','important');
  // Ensure steppers, seg group, and textareas take the full grid cell width
  stack.querySelectorAll('.stepper, .seg, textarea, select, input').forEach(el=>{
    el.style.setProperty('width','100%','important');
    el.style.setProperty('max-width','none','important');
    el.style.setProperty('box-sizing','border-box','important');
  });
  // Clear any lingering pulse classes from previous interactions
  stack.querySelectorAll('.stepper').forEach(n => n.classList.remove('pulse-up','pulse-down'));

  // Helper to fetch a stepper by field
  const getStep = (field)=> stack.querySelector(`.stepper[data-field="${field}"]`);

  // Make arrow buttons ▲ ▼ instead of +/-
  stack.querySelectorAll('.stepper .up').forEach(b=>{ b.textContent='▲'; b.setAttribute('aria-label','Increase'); });
  stack.querySelectorAll('.stepper .down').forEach(b=>{ b.textContent='▼'; b.setAttribute('aria-label','Decrease'); });

  // (Removed inline numeric value box sizing; CSS should control)

  // Create rows (spacing only via class, not inline style)
  const row = (cols)=>{
    const d = document.createElement('div');
    d.className = 'row';
    // Explicit grid so every row fills the modal width and 2-up rows behave consistently
    d.style.setProperty('display','grid','important');
    d.style.setProperty('grid-template-columns', cols===2 ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)', 'important');
    d.style.setProperty('column-gap','8px','important');
    d.style.setProperty('align-items','stretch','important');
    d.style.setProperty('width','100%','important');
    d.style.setProperty('margin','0','important');
    return d;
  };
  const row2a = row(2); // Set + Rep
  const row2b = row(2); // Weight + Height
  const row1  = row(1); // RPE
  const row1b = row(1); // Fail reps
  [row2a,row2b,row1,row1b].forEach(r=>{
    r.style.setProperty('width','100%','important');
    r.style.removeProperty('max-width');
  });

  // Move steppers into new layout
  const setStep   = getStep('sets_done');
  const repsStep  = getStep('planned_reps');
  const wtStep    = getStep('weight_lb');
  const hStep     = getStep('height');
  const rpeStep   = getStep('rpe_set2');
  const failStep  = getStep('fail_reps');
  [setStep,repsStep,wtStep,hStep,rpeStep,failStep].filter(Boolean).forEach(n=>{
    n.style.setProperty('width','100%','important');
  });
  // Ensure each stepper's .ctr track can expand
  [setStep,repsStep,wtStep,hStep,rpeStep,failStep].filter(Boolean).forEach(n=>{
    const ctr = n.querySelector('.ctr');
    if(ctr){ ctr.style.setProperty('width','100%','important'); ctr.style.removeProperty('max-width'); }
  });
  // Normalize the internal layout of the counter track so ▲ [value] ▲ are perfectly aligned
  ;[setStep,repsStep,wtStep,hStep,rpeStep,failStep].filter(Boolean).forEach(n=>{
    const ctr = n.querySelector('.ctr');
    if(ctr){
      ctr.style.setProperty('display','grid','important');
      // PATCH: Drastic compact settings for visual confirmation
      const modalW = (document.getElementById('logModal')?.getBoundingClientRect().width) || 520;
      const compact = modalW <= 420; // widen trigger so it hits most phones
      const btnSize = compact ? 30 : 40;            // drastic shrink on mobile
      const gap = compact ? 2 : 10;                 // minimal spacing on mobile
      ctr.style.setProperty('grid-template-columns', btnSize+"px 1fr "+btnSize+"px", 'important');
      ctr.style.setProperty('align-items','center','important');
      ctr.style.setProperty('gap', String(gap)+'px','important');
      ctr.style.setProperty('justify-items','center','important');
      // Ensure track itself has consistent height
      ctr.style.setProperty('min-height', btnSize+'px', 'important');
      ctr.style.setProperty('height', btnSize+'px', 'important');
      // PATCH: Add drastic constraints for compact mode
      if (compact) {
        ctr.style.setProperty('padding','0','important');
        ctr.style.setProperty('border-width','1px','important');
        ctr.style.setProperty('box-shadow','none','important');
      }
      const val = ctr.querySelector('span');
      if(val){
        val.style.setProperty('justify-self','center','important');
        val.style.setProperty('text-align','center','important');
        // Strong centering for varying font metrics
        val.style.setProperty('display','flex','important');
        val.style.setProperty('align-items','center','important');
        val.style.setProperty('justify-content','center','important');
        val.style.setProperty('height', btnSize+'px', 'important');
        val.style.setProperty('line-height', btnSize+'px', 'important');
        val.style.setProperty('font-variant-numeric','tabular-nums','important');
        // PATCH: More aggressive compact font size and fixed line-height
        if(compact){
          val.style.setProperty('font-size','16px','important');
          val.style.setProperty('line-height', btnSize+'px', 'important');
        }
        val.style.setProperty('padding','0','important');
        // Remove any previous transforms so we don't fight CSS
        val.style.removeProperty('transform');
      }
      const btns = ctr.querySelectorAll('button');
      btns.forEach(b=>{
        // PATCH: Use the same compact threshold and btnSize as above
        const modalW = (document.getElementById('logModal')?.getBoundingClientRect().width) || 520;
        const compact = modalW <= 420;
        const btnSize = compact ? 30 : 40;
        b.style.setProperty('width', btnSize+'px','important');
        b.style.setProperty('height', btnSize+'px','important');
        b.style.setProperty('display','flex','important');
        b.style.setProperty('align-items','center','important');
        b.style.setProperty('justify-content','center','important');
        b.style.setProperty('line-height','1','important');
        b.style.setProperty('padding','0','important');
        // PATCH: More aggressive compact font size
        b.style.setProperty('font-size', (compact ? '16px' : '20px'), 'important');
        // PATCH: Force glyphs to sit inside smaller boxes
        if (compact) {
          b.style.setProperty('line-height', btnSize+'px','important');
          b.style.setProperty('min-width', btnSize+'px','important');
          b.style.setProperty('min-height', btnSize+'px','important');
        }
        b.style.removeProperty('transform');
      });
      // --- Measurement-based vertical centering (final pass) ---
      // We measure the parent and children and apply a tiny, sub-pixel translateY to align optical centers.
      requestAnimationFrame(()=>{
        try{
          if (compact) return; // on narrow screens we rely on tighter spacing instead of transforms
          // Prefer the ctr's own geometric center; if a label exists, keep it as a soft reference
          const parent = ctr.getBoundingClientRect();
          let targetY = parent.top + parent.height/2;
          const label = ctr.closest('.stepper')?.querySelector('label');
          if(label){
            // If label exists and ctr is immediately after it, keep center within ctr (not label),
            // but use label read to avoid layout jitter on Safari (no-op if not needed)
            void label.offsetWidth; // force layout
          }

          const adjust = (el)=>{
            if(!el) return;
            const r = el.getBoundingClientRect();
            const cy = r.top + r.height/2;
            const dy = targetY - cy; // signed offset
            // Apply sub-pixel translate only if meaningful (avoids accumulating blur)
            if(Math.abs(dy) > 0.05){
              const cur = getComputedStyle(el).transform;
              const t = `translate3d(0, ${dy.toFixed(3)}px, 0)`;
              el.style.transform = (cur && cur !== 'none') ? `${cur} ${t}` : t;
              el.style.willChange = 'transform';
            }
          };
          adjust(ctr.querySelector('span'));
          btns.forEach(b=>adjust(b));
        }catch(_){/* ignore */}
      });
    }
  });

  if(setStep && repsStep){ row2a.appendChild(setStep); row2a.appendChild(repsStep); }
  if(wtStep && hStep){     row2b.appendChild(wtStep);  row2b.appendChild(hStep); }
  if(rpeStep)  row1.appendChild(rpeStep);
  if(failStep) row1b.appendChild(failStep);

  // Clear stack and re-append in desired order
  const old = Array.from(stack.children);
  old.forEach(n=>{ /* detach all children first */ });
  stack.innerHTML='';
  stack.appendChild(row2a);
  stack.appendChild(row2b);
  stack.appendChild(row1);
  stack.appendChild(row1b);
  // Ensure a clear gap after the last row before Notes
  row1b.style.setProperty('margin-bottom', refGapPx + 'px', 'important');

  // Align actions row in-place and position Notes directly after it (no re-parenting)
  const btnSkip   = document.getElementById('btnSkip');
  const btnCancel = document.getElementById('btnCancel');
  const btnLog    = document.getElementById('btnLog');

  // Actions menu is the parent of any of these buttons
  const actions = (btnSkip || btnCancel || btnLog) ? (btnSkip?.parentElement || btnCancel?.parentElement || btnLog?.parentElement) : null;

  // Notes block wrapper (prefer field wrapper)
  const notesEl = document.getElementById('logNotes');
  let notesBlock = null;
  if (notesEl) {
    notesBlock = notesEl.closest('.field') || notesEl;
  }

  if (actions) {
    // --- Normalize the actions row content (keep it where it lives) ---
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '8px';

    // Remove any previous right-box to avoid duplicates
    const oldRight = actions.querySelector('[data-right-box]');
    if (oldRight) oldRight.remove();

    // Ensure Skip is the first child
    if (btnSkip) actions.prepend(btnSkip);

    // Build right side (Cancel + Log)
    const right = document.createElement('div');
    right.setAttribute('data-right-box','');
    right.style.display = 'inline-flex';
    right.style.gap = '8px';
    right.style.marginLeft = 'auto';
    if (btnCancel) right.appendChild(btnCancel);
    if (btnLog)    right.appendChild(btnLog);
    actions.appendChild(right);

    // A little breathing room above the actions row
    actions.style.marginTop = refGapPx + 'px';

    // --- Place Notes immediately AFTER the actions row (same parent) ---
    if (notesBlock && actions.parentElement) {
      // Detach Notes from its current parent if needed
      if (notesBlock.parentElement !== actions.parentElement) {
        try { notesBlock.parentElement?.removeChild(notesBlock); } catch(_){}
      }
      // Insert after actions
      if (actions.nextSibling) actions.parentElement.insertBefore(notesBlock, actions.nextSibling);
      else actions.parentElement.appendChild(notesBlock);
      notesBlock.style.marginTop = refGapPx + 'px';
    }
  }
}

function updateSteppers(){
  $('.stack').querySelectorAll('.stepper').forEach(node=>{
    const field=node.dataset.field;
    const span=node.querySelector('.ctr span');
    if(field && span) span.textContent = fmt(stepVals[field]);
    if(!node.dataset.bound){
      const step = (field==='weight_lb') ? (Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB)) : 1;
      node.querySelector('.up').onclick   = ()=>{ stepVals[field]=Number(stepVals[field]||0)+step; span.textContent=fmt(stepVals[field]); };
      node.querySelector('.down').onclick = ()=>{ stepVals[field]=Math.max(0, Number(stepVals[field]||0)-step); span.textContent=fmt(stepVals[field]); };
      node.dataset.bound='1';
    }
  });
}

async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';
  $('#btnLog').disabled = true; $('#btnSkip').disabled = true;

  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    user_id: state.userId || 'u_camp',
    exercise_id: curEx.id,
    side: sideUsed,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_reps: Number(stepVals.fail_reps),
    skip_progress: skip ? 1 : '',
    notes: $('#logNotes').value||''
  };

  try{
    const res = await apiPost('addLog', payload);
    if(res && !res.error){
      // If left/right, keep open for the other side
      if (sideUsed!=='both' && !modal.dataset.didOther){
        modal.dataset.didOther='1';
        const nextSide = sideUsed==='left' ? 'right' : 'left';
        $('#sideSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.side===nextSide));
        stepVals.side = nextSide; saveSide(curEx.id, nextSide);
        const s2 = suggestNext(curEx.id, nextSide);
        stepVals.weight_lb=s2.weight; stepVals.planned_reps=s2.reps; stepVals.height=s2.height; updateSteppers();
        toast(`Logged ${sideUsed}. Now ${nextSide}.`);
        $('#btnLog').disabled=false; $('#btnSkip').disabled=false;
        fetchAll(); // refresh history
        return;    // keep modal open
      }
      // otherwise close
      modal.dataset.didOther='';
      modal.close(); flash(); markDone(curEx.id); fetchAll();
    } else {
      toast('Error: ' + (res?.error || 'unknown'));
    }
  } catch(err){
    toast('Network error');
  } finally {
    $('#btnLog').disabled=false; $('#btnSkip').disabled=false;
  }
}
$('#btnLog')?.addEventListener('click',  e=>{ e.preventDefault(); submitLog(false); });
$('#btnSkip')?.addEventListener('click', e=>{ e.preventDefault(); submitLog(true);  });

// Add Exercise wizard
function openAddWizard(){
  const d=$('#addModal'); d.showModal();
  let step=0;
  const qs = $$('.wizard .q');
  function show(){
    qs.forEach((q,i)=>q.hidden = i!==step);
    $('#wizPrev').hidden = step===0;
    $('#wizNext').hidden = step===qs.length-1;
    $('#wizSave').hidden = step!==qs.length-1;
  }
  show();
  $('#wizPrev').onclick = ()=>{ step=Math.max(0,step-1); show(); };
  $('#wizNext').onclick = ()=>{ step=Math.min(qs.length-1,step+1); show(); };
  $('#wizSave').onclick = saveExercise;
}
async function saveExercise(){
  const btn=$('#wizSave'); if(btn.dataset.busy==='1') return;
  btn.dataset.busy='1'; btn.disabled=true; const orig=btn.textContent; btn.textContent='Saving…';
  const body={
    name: $('#exName').value.trim(),
    variation: $('#exVar').value.trim(),
    primary: $('#exPri').value.trim(),
    secondary: $('#exSec').value.trim(),
    tertiary: $('#exTer').value.trim(),
    equipment: $('#exEq').value.trim(),
    sets: Number($('#exSets').value||3),
    default_weight: Number($('#exW').value||0),
    default_height: Number($('#exH').value||0),
    increment_lb: $('#exInc').value.trim(),
    owner: 'shared'
  };
  if(!body.name){ alert('Name required'); btn.dataset.busy='0'; btn.disabled=false; btn.textContent=orig; return; }
  try{
    const res = await apiPost('addExercise', body);
    if(res?.dedup){ toast('Already exists — using existing'); $('#addModal').close(); fetchAll(); }
    else if(res && !res.error){ toast('Exercise added'); $('#addModal').close(); fetchAll(); }
    else alert('Error: '+(res?.error||'unknown'));
  } catch(err){ alert('Network error'); }
  finally{ btn.dataset.busy='0'; btn.disabled=false; btn.textContent=orig; }
}

// ==== Summary (mirrored heat map) ====
const MUSCLE_LIST = ['Chest','Back','Trapezius','Shoulders','Front Delt','Side Delt','Rear Delt','Biceps','Triceps','Forearms','Abs','Glutes','Quads','Hamstrings','Calves'];
const MUSCLE_POINTS = { primary:3, secondary:2, tertiary:1 };
function musclePercents(period){
  const logs = logsForUser().filter(l=>inPeriod(l.date||l.timestamp, period));
  const score = new Map();
  for(const l of logs){
    const ex=state.byId[l.exercise_id]; if(!ex) continue;  // only current user's exercises
    for(const slot of ['primary','secondary','tertiary']){
      const m=(ex[slot]||'').trim(); if(!m) continue;
      score.set(m, (score.get(m)||0) + MUSCLE_POINTS[slot]);
    }
  }
  const total=[...score.values()].reduce((a,b)=>a+b,0)||1;
  const pct={}; MUSCLE_LIST.forEach(m=>pct[m]=Math.round(100*(score.get(m)||0)/total));
  return pct;
}
function heat(pct){
  const cs = getComputedStyle(document.body);
  const r = Number(cs.getPropertyValue('--accent-r') || 45);
  const g = Number(cs.getPropertyValue('--accent-g') || 212);
  const b = Number(cs.getPropertyValue('--accent-b') || 191);
  const alpha = 0.12 + 0.88 * (pct/100);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderSummary(){
  // update nav active state per current page restore
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));

  const wrap=$('#summaryContent'); const period=state.period;
  const st = streaks();

  // focus %
  const pct = musclePercents(period);
  const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
  const top = entries.slice(0,7);
  const neglected = entries.slice(-5);

  // most improved
  const imp = rankImprovements(period).slice(0,5);

  wrap.innerHTML = `
  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 6px">Streaks</h4>
    <div>Current: <b>${st.current}</b> weeks</div>
    <div>Best: <b>${st.best}</b> weeks</div>
    <div>Perfect weeks: <b>${st.perfectWeeks}</b></div>
  </div>

  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 12px">Muscle Focus (${period})</h4>
    <div id="mapWrap" style="display:grid; grid-template-columns:160px 1fr; gap:12px;">
      <svg id="muscleMap" viewBox="0 0 120 220" style="width:160px; height:auto; background:#0f1015; border:1px solid #1f2028; border-radius:12px; padding:6px;">
        <!-- mirrored silhouette -->
        <rect id="ChestL" x="30" y="52" width="12" height="14" rx="3" />
        <rect id="ChestR" x="78" y="52" width="12" height="14" rx="3" />
        <rect id="AbsL" x="46" y="68" width="10" height="26" rx="3" />
        <rect id="AbsR" x="64" y="68" width="10" height="26" rx="3" />
        <rect id="QuadsL" x="46" y="112" width="12" height="34" rx="3" />
        <rect id="QuadsR" x="62" y="112" width="12" height="34" rx="3" />
        <rect id="HamsL" x="46" y="112" width="12" height="18" rx="3" />
        <rect id="HamsR" x="62" y="112" width="12" height="18" rx="3" />
        <rect id="GlutesL" x="48" y="98" width="10" height="10" rx="3" />
        <rect id="GlutesR" x="62" y="98" width="10" height="10" rx="3" />
        <rect id="CalvesL" x="46" y="150" width="10" height="22" rx="3" />
        <rect id="CalvesR" x="64" y="150" width="10" height="22" rx="3" />
        <rect id="Back" x="52" y="45" width="16" height="24" rx="3" />
        <rect id="Trap" x="54" y="35" width="12" height="10" rx="3" />
        <rect id="ShoulderL" x="38" y="42" width="10" height="8" rx="3" />
        <rect id="ShoulderR" x="72" y="42" width="10" height="8" rx="3" />
        <rect id="BicepsL" x="34" y="58" width="7" height="12" rx="3" />
        <rect id="BicepsR" x="79" y="58" width="7" height="12" rx="3" />
        <rect id="TricepsL" x="30" y="58" width="5" height="12" rx="3" />
        <rect id="TricepsR" x="87" y="58" width="5" height="12" rx="3" />
        <rect id="ForearmsL" x="30" y="74" width="8" height="12" rx="3" />
        <rect id="ForearmsR" x="84" y="74" width="8" height="12" rx="3" />
      </svg>
      <div>
        <div style="margin-bottom:8px; font-weight:700">Top Focus</div>
        ${top.map(([m,v])=>`<div>${m}: <b>${v}%</b></div>`).join('') || '<div class="meta">No data</div>'}
        
      </div>
    </div>
  </div>

  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 6px">Most Improved (${period})</h4>
    ${imp.length ? '<ol>'+imp.map(x=>`<li>${state.byId[x.id]?.name||x.id}: +${x.delta.toFixed(1)}</li>`).join('')+'</ol>' : '<div class="meta">No data yet</div>'}
  </div>`;

  const color = (v)=>heat(Math.max(0,Math.min(100,(v||0))));
  const set = (id,m)=>{ const el=$('#'+id); if(el) el.style.fill = color(pct[m]); };

  set('Back','Back'); set('Trap','Trapezius');
  set('ChestL','Chest'); set('ChestR','Chest');
  set('AbsL','Abs'); set('AbsR','Abs');
  set('QuadsL','Quads'); set('QuadsR','Quads');
  set('HamsL','Hamstrings'); set('HamsR','Hamstrings');
  set('GlutesL','Glutes'); set('GlutesR','Glutes');
  set('CalvesL','Calves'); set('CalvesR','Calves');
  set('ShoulderL','Shoulders'); set('ShoulderR','Shoulders');
  set('BicepsL','Biceps'); set('BicepsR','Biceps');
  set('TricepsL','Triceps'); set('TricepsR','Triceps');
  set('ForearmsL','Forearms'); set('ForearmsR','Forearms');
}

// ==== toast / flash ====
function flash(){ const el=$('#flash'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.hidden=false; clearTimeout(el._t); el._t=setTimeout(()=>el.hidden=true, 1500); }

// ==== Boot ====
bindNav();
fetchAll();
// Restore page on first load
document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
const first = document.getElementById('page-'+state.page); if(first) first.classList.add('active');

document.addEventListener('DOMContentLoaded', ensureSuggestStyles);


// ====== PATCH v5 ======
// Make Summary its own page (toggle display) + body[data-page]
function setPage(page){
  state.page = page || 'list';
  store.set({ page: state.page });
  document.body.setAttribute('data-page', state.page);
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const target = document.getElementById('page-' + state.page);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Rebind nav to use setPage
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-nav]'); if(!btn) return;
  e.preventDefault();
  setPage(btn.dataset.nav);
}, true);

// Apply page on boot
(function(){ document.body.setAttribute('data-page', state.page || 'list'); })();

// Correct streaks: consecutive weeks with >=3 sessions; perfect >=5 sessions
function streaks(){
  const logs = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  const weeks = new Map(); // Monday as week start
  for(const l of logs){
    const d = new Date(l.date||l.timestamp);
    const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
    const key = w.toISOString().slice(0,10);
    weeks.set(key, (weeks.get(key)||0)+1);
  }
  const keys = [...weeks.keys()].sort();
  let cur=0, best=0, perfect=0, prevIdx=null;
  for(let i=0;i<keys.length;i++){
    const sessions = weeks.get(keys[i])||0;
    const qualifies = sessions >= 3;
    if(!qualifies){
      if(cur>best) best=cur;
      cur=0; prevIdx=null; // break in streak
      continue;
    }
    if(prevIdx===null || i===prevIdx+1) cur += 1;
    else cur = 1;
    if(cur>best) best=cur;
    if(sessions>=5) perfect += 1;
    prevIdx=i;
  }
  return { current:cur, best, perfectWeeks:perfect };
}

// Ensure renderSummary maintains page dataset for CSS
const _renderSummaryOriginal = renderSummary;
renderSummary = function(){
  document.body.setAttribute('data-page', state.page || 'list');
  _renderSummaryOriginal();
};

// On initial boot, apply page
setTimeout(()=>setPage(state.page || 'list'), 0);


// ====== PATCH v6 — robust streak computation ======
// Build a continuous calendar of weeks so gaps break streaks properly.
function _weekKeyMonday(d){
  const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
  return w.toISOString().slice(0,10);
}
function _addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function streaks(){
  const rows = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  if(!rows.length) return { current:0, best:0, perfectWeeks:0 };
  const weekly = new Map();
  for(const l of rows){
    const dt = new Date(l.date || l.timestamp);
    const key = _weekKeyMonday(dt);
    weekly.set(key, (weekly.get(key)||0) + 1);
  }
  // Build continuous weekly array from min week to current week
  const firstKey = _weekKeyMonday(new Date(rows[0].date||rows[0].timestamp));
  const lastKey  = _weekKeyMonday(new Date()); // this week
  const weeks = [];
  for(let d=new Date(firstKey); d<=new Date(lastKey); d=_addDays(d,7)){
    const k = d.toISOString().slice(0,10);
    weeks.push({ key:k, sessions: weekly.get(k)||0 });
  }
  // Best and current streaks for >=3 sessions
  let best=0, cur=0;
  for(const w of weeks){
    if(w.sessions>=3){ cur+=1; best=Math.max(best,cur); }
    else cur=0;
  }
  // Current streak counts back from the end
  let current=0;
  for(let i=weeks.length-1;i>=0;i--){
    if(weeks[i].sessions>=3) current++;
    else break;
  }
  // Perfect weeks: total across history (>=5)
  const perfectWeeks = weeks.filter(w=>w.sessions>=5).length;
  return { current, best, perfectWeeks };
}


// ====== PATCH v7 — streaks count UNIQUE DAYS (sessions) per week ======
function _dateOnlyStringUTCish(val){
  // Prefer l.date in YYYY-MM-DD; fallback to timestamp->ISO date
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  // use UTC date part to avoid timezone off-by-one; sheet stores date-only
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function _weekKeyFromDateStr(yyyy_mm_dd){
  // Build local date at noon to avoid DST quirks, then shift to Monday
  const d = new Date(yyyy_mm_dd+'T12:00:00');
  const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
  return w.toISOString().slice(0,10);
}
function _addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function streaks(){
  const rows = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  if(!rows.length) return { current:0, best:0, perfectWeeks:0 };

  // Map: weekKey -> Set(unique dayKeys) so each workout day counts once
  const weekToDays = new Map();
  for(const l of rows){
    const dayKey = _dateOnlyStringUTCish(l.date || l.timestamp);   // 'YYYY-MM-DD'
    const weekKey = _weekKeyFromDateStr(dayKey);
    if(!weekToDays.has(weekKey)) weekToDays.set(weekKey, new Set());
    weekToDays.get(weekKey).add(dayKey);
  }

  // Build continuous weekly array from earliest to this week
  const firstKey = _weekKeyFromDateStr(_dateOnlyStringUTCish(rows[0].date || rows[0].timestamp));
  const lastKey  = _weekKeyFromDateStr(_dateOnlyStringUTCish(new Date()));
  const weeks = [];
  for(let d=new Date(firstKey); d<=new Date(lastKey); d=_addDays(d,7)){
    const k = d.toISOString().slice(0,10);
    const sessions = (weekToDays.get(k) || new Set()).size; // UNIQUE DAYS
    weeks.push({ key:k, sessions });
  }

  // Compute best and current streaks for >=3 sessions/week
  let best=0, cur=0;
  for(const w of weeks){
    if(w.sessions>=3){ cur+=1; best=Math.max(best,cur); }
    else cur=0;
  }
  let current=0;
  for(let i=weeks.length-1;i>=0;i--){
    if(weeks[i].sessions>=3) current++;
    else break;
  }
  const perfectWeeks = weeks.filter(w=>w.sessions>=5).length;
  return { current, best, perfectWeeks };
}


// ====== PATCH v8 — Most Improved uses baseline BEFORE the period and effective reps ======
function _parseDate(val){
  if(typeof val==='string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val+'T12:00:00');
  return new Date(val);
}
function _periodStart(p){ return startOfPeriod(p); }

function rankImprovements(period){
  const start = _periodStart(period);
  const logs = logsForUser().slice().sort((a,b)=> _parseDate(a.date||a.timestamp) - _parseDate(b.date||b.timestamp));

  const map = new Map();
  for(const l of logs){
    const t = _parseDate(l.date||l.timestamp);
    const repsEff = Math.max(Number(l.planned_reps||0), Number(l.fail_reps||0)); // use fail reps if higher
    const val = e1rm(Number(l.weight_lb||0), repsEff);
    const arr = map.get(l.exercise_id)||[]; arr.push({t, val}); map.set(l.exercise_id, arr);
  }

  const out = [];
  const now = new Date();

  for(const [id, arrRaw] of map.entries()){
    const arr = arrRaw.slice().sort((a,b)=>a.t-b.t);
    const inside = arr.filter(x=>x.t >= start && x.t <= now);
    if(!inside.length) continue;
    const currentVal = inside[inside.length - 1].val;
    const before = arr.filter(x=>x.t < start);
    const baselineVal = before.length ? before[before.length - 1].val : inside[0].val;
    const delta = currentVal - baselineVal;
    out.push({ id, delta, currentVal, baselineVal, isNew: !before.length });
  }

  out.sort((a,b)=> b.delta - a.delta);
  return out;
}



// ====== PATCH v9 — Optimistic log + stepper pulse ======

// Local done map helpers
function setDoneLocal(exId, tsOrNull){
  const map = _loadMap('doneMap');
  if (tsOrNull == null) delete map[exId]; else map[exId] = tsOrNull;
  _saveMap('doneMap', map);
}
function optimisticMarkDone(exId){
  const map = _loadMap('doneMap');
  const prev = Object.prototype.hasOwnProperty.call(map, exId) ? map[exId] : null;
  setDoneLocal(exId, Date.now());
  const card = document.querySelector(`.card[data-id="${exId}"]`);
  if (card) card.classList.add('done');
  flash();
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
  return () => {
    if (prev === null) setDoneLocal(exId, null); else setDoneLocal(exId, prev);
    if (card) card.classList.remove('done');
  };
}

// Small haptic on steppers (no-op if unsupported)
function tinyHaptic(){ try { if (navigator.vibrate) navigator.vibrate(5); } catch (_) {} }

function stepperPulse(node, dir){
  node.classList.remove('pulse-up','pulse-down');
  void node.offsetWidth; // reflow to restart animation
  const cls = (dir === 'up') ? 'pulse-up' : 'pulse-down';
  node.classList.add(cls);
  const done = (e)=>{
    if(e && e.target !== node) return; // ignore bubbled events
    node.classList.remove(cls);
    node.removeEventListener('animationend', done);
  };
  node.addEventListener('animationend', done);
  // Fallback in case animationend doesn’t fire
  setTimeout(done, 500);
}

// Override updateSteppers to add pulses on up/down
(function(){
  const _update = updateSteppers;
  updateSteppers = function(){
    _update();
    document.querySelectorAll('.stack .stepper').forEach(node=>{
      if(node.dataset.pulseBound==='1') return;
      node.dataset.pulseBound='1';
      const up   = node.querySelector('.up');
      const down = node.querySelector('.down');
      if(up) up.addEventListener('click',  ()=>{ stepperPulse(node,'up'); tinyHaptic(); });
      if(down) down.addEventListener('click',()=>{ stepperPulse(node,'down'); tinyHaptic(); });
    });
  };
})();

// Optimistic submitLog (instant UI, rollback on failure)
async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';

  // Optimistic highlight + flash now
  const rollback = optimisticMarkDone(curEx.id);

  // Lock buttons to avoid double taps
  $('#btnLog').disabled = true; $('#btnSkip').disabled = true;

  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    user_id: state.userId || 'u_camp',
    exercise_id: curEx.id,
    side: sideUsed,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_reps: Number(stepVals.fail_reps),
    skip_progress: skip ? 1 : '',
    notes: $('#logNotes').value||''
  };

  try{
    const res = await apiPost('addLog', payload);
    if(res && !res.error){
      if (sideUsed!=='both' && !modal.dataset.didOther){
        // Keep open and switch side
        modal.dataset.didOther='1';
        const nextSide = sideUsed==='left' ? 'right' : 'left';
        $('#sideSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.side===nextSide));
        stepVals.side = nextSide; saveSide(curEx.id, nextSide);
        const s2 = suggestNext(curEx.id, nextSide);
        stepVals.weight_lb=s2.weight; stepVals.planned_reps=s2.reps; stepVals.height=s2.height; updateSteppers();
        // toast(`Logged ${sideUsed}. Now ${nextSide}.`);
      } else {
        modal.dataset.didOther='';
        modal.close();
      }
      fetchAll(); // refresh silently
    } else {
      rollback();
      toast('Error saving log');
    }
  } catch(err){
    rollback();
    toast('Network error');
  } finally {
    $('#btnLog').disabled = false; $('#btnSkip').disabled = false;
  }
}



// ====== PATCH v10 — Cancel closes modal ======
document.addEventListener('click', (e)=>{
  const b=e.target.closest('#btnCancel');
  if(!b) return;
  e.preventDefault();
  try { document.getElementById('logModal').close(); } catch(_){}
});



// ====== PATCH v11 — instant-close modal on Log/Skip (background write) ======
async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';
  const modalEl = document.getElementById('logModal');

  // Optimistic highlight immediately
  const rollback = optimisticMarkDone(curEx.id);

  // Determine the next action based on side
  if (sideUsed === 'right') {
    // Save log for right, but do NOT close modal.
    // Switch to left side, update UI highlight, keep modal open.
    // Save right log in background
    const payload = {
      timestamp: new Date().toISOString(),
      date: today(),
      user_id: state.userId || 'u_camp',
      exercise_id: curEx.id,
      side: sideUsed,
      sets_done: Number(stepVals.sets_done),
      planned_reps: Number(stepVals.planned_reps),
      weight_lb: Number(stepVals.weight_lb),
      height: Number(stepVals.height||0),
      rpe_set2: Number(stepVals.rpe_set2),
      fail_reps: Number(stepVals.fail_reps),
      skip_progress: skip ? 1 : '',
      notes: $('#logNotes').value||''
    };
    apiPost('addLog', payload)
      .then(res => {
        if(res && !res.error){
          fetchAll();
        }else{
          rollback(); toast('Error saving log');
        }
      })
      .catch(()=>{ rollback(); toast('Network error'); });
    // Switch UI to left
    stepVals.side = 'left';
    saveSide(curEx.id, 'left');
    // Update active highlight for side buttons
    const seg = $('#sideSeg');
    const wrap = seg.querySelector('.seg-buttons') || seg;
    // Slider container/bar setup (ensure matches openLog)
    const sideToggle2 = wrap; // container for sliding bar
    sideToggle2.classList.add('side-toggle');
    if (!sideToggle2.querySelector('.highlight-bar')) {
      const bar = document.createElement('div');
      bar.className = 'highlight-bar';
      sideToggle2.appendChild(bar);
    }
    wrap.querySelectorAll('button').forEach(b=>{
      b.classList.remove('active');
      b.setAttribute('aria-pressed','false');
    });
    const leftBtn = wrap.querySelector('button[data-side="left"]');
    if(leftBtn){
      leftBtn.classList.add('active');
      leftBtn.setAttribute('aria-pressed','true');
      try { leftBtn.focus({ preventScroll: true }); } catch(_){}
    }
    // Also update container class for slider
    sideToggle2.classList.remove('left','both','right');
    sideToggle2.classList.add('left');
    // Update values for left suggestion
    const s2 = suggestNext(curEx.id, 'left');
    stepVals.weight_lb = s2.weight;
    stepVals.planned_reps = s2.reps;
    stepVals.height = s2.height;
    updateSteppers();
    // Update prev line (subheader)
    const baseSub = [musclesOf(curEx).filter(Boolean).join('/'), curEx.equipment].filter(Boolean).join(' • ');
    $('#logSub').innerHTML = baseSub + prevLineInlineHTML(curEx.id, 'left');
    arrangeLogLayout();
    // toast('Logged right. Now left.');
    // Do NOT close modal
    return;
  } else if (sideUsed === 'left') {
    // Save log for left, then close modal
    const payload = {
      timestamp: new Date().toISOString(),
      date: today(),
      user_id: state.userId || 'u_camp',
      exercise_id: curEx.id,
      side: sideUsed,
      sets_done: Number(stepVals.sets_done),
      planned_reps: Number(stepVals.planned_reps),
      weight_lb: Number(stepVals.weight_lb),
      height: Number(stepVals.height||0),
      rpe_set2: Number(stepVals.rpe_set2),
      fail_reps: Number(stepVals.fail_reps),
      skip_progress: skip ? 1 : '',
      notes: $('#logNotes').value||''
    };
    try { if(modalEl) modalEl.close(); } catch(_){}
    apiPost('addLog', payload)
      .then(res => {
        if(res && !res.error){
          fetchAll();
        }else{
          rollback(); toast('Error saving log');
        }
      })
      .catch(()=>{ rollback(); toast('Network error'); });
    return;
  } else if (sideUsed === 'both') {
    // Save log and close modal as usual
    const payload = {
      timestamp: new Date().toISOString(),
      date: today(),
      user_id: state.userId || 'u_camp',
      exercise_id: curEx.id,
      side: sideUsed,
      sets_done: Number(stepVals.sets_done),
      planned_reps: Number(stepVals.planned_reps),
      weight_lb: Number(stepVals.weight_lb),
      height: Number(stepVals.height||0),
      rpe_set2: Number(stepVals.rpe_set2),
      fail_reps: Number(stepVals.fail_reps),
      skip_progress: skip ? 1 : '',
      notes: $('#logNotes').value||''
    };
    try { if(modalEl) modalEl.close(); } catch(_){}
    apiPost('addLog', payload)
      .then(res => {
        if(res && !res.error){
          fetchAll();
        }else{
          rollback(); toast('Error saving log');
        }
      })
      .catch(()=>{ rollback(); toast('Network error'); });
    return;
  }
}


// ===== v15 — Summary polish, consistency bar, stronger progression, suggestions =====

async function refreshFromBackend(){
  try {
    await fetchAll();
  } catch (e) {
    console.error('Refresh failed', e);
  }
}


function _isoDate(val){
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val; // already YYYY-MM-DD
  const d = new Date(val);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`; // local date, no off-by-one
}
function _mondayOf(d){ const x=new Date(d); x.setDate(d.getDate()-((d.getDay()+6)%7)); x.setHours(0,0,0,0); return x; }
function _addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function _startOfWeekLocal(d, weekStart){
  const date = new Date(d);
  date.setHours(0,0,0,0);
  const dow = date.getDay(); // 0=Sun ... 6=Sat (local)
  const ws  = Number.isFinite(weekStart) ? weekStart : 1; // default Monday
  // shift so that result is local midnight of the configured start day
  let diff = dow - (ws % 7);
  if (diff < 0) diff += 7;
  date.setDate(date.getDate() - diff);
  return date;
}


function _dateOnlyLocal(val){
  // Prefer YYYY-MM-DD as-is; otherwise build local date string
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// Helper: Derive local YYYY-MM-DD for a log, preferring timestamp
function _localYMDFromLog(l){
  // Prefer timestamp (ISO string) to avoid sheet timezone quirks
  if (l && l.timestamp) {
    const d = new Date(l.timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`; // local Y-M-D from timestamp
  }
  // Fallback to `date` (YYYY-MM-DD). Parse as LOCAL date by components to avoid UTC parsing.
  if (l && typeof l.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date)){
    const [y,m,day] = l.date.split('-').map(Number);
    const d = new Date(y, m-1, day, 12, 0, 0); // local noon to dodge DST edges
    const yy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yy}-${mm}-${dd}`;
  }
  // Last resort: let the old helper try
  return _dateOnlyLocal(l?.date || l?.timestamp || new Date());
}

function daysThisWeekFlags(){
  // Week start: 0=Sun, 1=Mon, etc. Default to Sunday unless CONFIG overrides
  const ws = (CONFIG && Number.isFinite(CONFIG.WEEK_START)) ? CONFIG.WEEK_START : 0;

  // Local week window [start, end)
  const now   = new Date();
  const start = _startOfWeekLocal(now, ws);           // local midnight at week start
  const end   = new Date(start); end.setDate(start.getDate()+7);

  // Prepare flags and a dedupe set so multiple logs on the same day still count once
  const flags = new Array(7).fill(false);
  const seen  = new Set(); // YYYY-MM-DD strings we've already counted

  // Helper: map a local YYYY-MM-DD to an index 0–6 relative to start
  const indexForDay = (yyyy_mm_dd)=>{
    // build at local noon to dodge DST edges, then compare to `start`
    const d = new Date(yyyy_mm_dd + 'T12:00:00');
    const idx = Math.floor((d - start) / (24*60*60*1000));
    return idx;
  };

  // Convert current user's logs to day flags in this week (derive LOCAL Y-M-D from timestamp when possible)
  for (const l of logsForUser()){
    const key = _localYMDFromLog(l);
    if (!key) continue;
    const dt  = new Date(key + 'T12:00:00');
    if (dt < start || dt >= end) continue; // outside this week window
    if (seen.has(key)) continue;           // already counted this day
    const idx = Math.floor((dt - start) / (24*60*60*1000));
    if (idx >= 0 && idx < 7){ flags[idx] = true; seen.add(key); }
  }

  const count = flags.reduce((a,b)=> a + (b ? 1 : 0), 0);
  return { count, flags };
}

function computeNextFromPerformance(last, ex){
  const min = CONFIG.REP_MIN, max = CONFIG.REP_MAX;
  let reps = Number(last.planned_reps || min);
  let wt   = Number(last.weight_lb || ex?.default_weight || 0);

  const frRaw = Number(last.fail_reps);
  const hasToFailure = Number.isFinite(frRaw) && frRaw >= reps;
  const actualMaxReps = hasToFailure ? frRaw : reps;
  const failedAttempts = !hasToFailure && Number.isFinite(frRaw) ? Math.max(0, frRaw) : 0;
  const rpe = Number(last.rpe_set2 || 8);

  const overRatio = reps > 0 ? (actualMaxReps / reps) : 1;
  const lowRPE = rpe <= 8;
  const veryHighRPE = rpe >= CONFIG.RPE_VERY_HIGH;

  // 1) Deload if needed
  if (failedAttempts > 0 || veryHighRPE || reps < min) {
    wt = Math.max(0, wt - CONFIG.DEFAULT_INC_LB);
    reps = min;
    return { weight: wt, reps };
  }

  // 1b) Huge over-performance: ≥2.25× planned reps with low RPE → 3 increments, reset reps
  if (overRatio >= 2.25 && lowRPE) {
    wt += CONFIG.DEFAULT_INC_LB * (CONFIG.OVERPERF_BIG_INC_STEPS + 1); // typically +15 lb when default inc is 5
    reps = min;
    return { weight: wt, reps };
  }

  // 2) Big jump: ≥2× planned reps
  if (overRatio >= CONFIG.OVERPERF_RATIO_2X) {
    wt += CONFIG.DEFAULT_INC_LB * CONFIG.OVERPERF_BIG_INC_STEPS;
    reps = min;
    return { weight: wt, reps };
  }

  // 3) Medium jump: ≥1.5× planned reps
  if (overRatio >= CONFIG.OVERPERF_RATIO_1P5X) {
    wt += CONFIG.DEFAULT_INC_LB * CONFIG.OVERPERF_MED_INC_STEPS;
    reps = min;
    return { weight: wt, reps };
  }

  // 4) Top of range & easy → add weight
  if (reps >= max && lowRPE) {
    wt += CONFIG.DEFAULT_INC_LB;
    reps = min;
    return { weight: wt, reps };
  }

  // 5) Increase reps within range
  if (reps < max && rpe <= CONFIG.RPE_OK_FOR_REP_UP && failedAttempts === 0) {
    reps = Math.min(max, reps + 1);
    return { weight: wt, reps };
  }

  // 6) Hold
  return { weight: wt, reps };
}


function _musclesOf(e){ return [e.primary,e.secondary,e.tertiary].filter(Boolean); }
function suggestWorkoutsV15(count=5){
  const start = startOfPeriod(state.period||'week');
  const exById = new Map(state.exercises.map(e=>[e.id,e]));
  const logsP  = logsForUser().filter(l=> new Date(l.date||l.timestamp) >= start);
  const score = new Map(); const add=(m,p)=>{ if(!m) return; score.set(m,(score.get(m)||0)+p); };
  for(const l of logsP){ const ex=exById.get(l.exercise_id); if(!ex) continue; add(ex.primary,3); add(ex.secondary,2); add(ex.tertiary,1); }
  const musSet=new Set(); exercisesForUser().forEach(e=>_musclesOf(e).forEach(m=>m&&musSet.add(m)));
  const neglected=[...musSet].map(m=>({m,pts:score.get(m)||0})).sort((a,b)=>a.pts-b.pts).slice(0,3).map(x=>x.m);
  const recent=new Map(); for(const l of logsForUser()){ const ds=_isoDate(l.date||l.timestamp); if(!recent.has(l.exercise_id) || ds>recent.get(l.exercise_id)) recent.set(l.exercise_id, ds); }
  const today=_isoDate(new Date());
  const ranked=[];
  for(const e of exercisesForUser()){
    let match=0;
    if(neglected.includes(e.primary)) match+=3;
    if(neglected.includes(e.secondary)) match+=2;
    if(neglected.includes(e.tertiary)) match+=1;
    if(!match) continue;
    const last=recent.get(e.id); let penalty=0;
    if(last){ const days=(new Date(today)-new Date(last))/(1000*60*60*24); if(days<=3) penalty=3-days; }
    ranked.push({e,score:match-penalty});
  }
  ranked.sort((a,b)=> b.score-a.score || a.e.name.localeCompare(b.e.name));
  return ranked.slice(0,count).map(x=>x.e);
}
function applySuggestionHighlightV15(){
  if(!state || !state.suggestIds) return;
  document.querySelectorAll('.card[data-id]').forEach(c=>{
    c.classList.toggle('suggested', state.suggestIds.has(c.getAttribute('data-id')));
  });
}
function recomputeSuggestionsV15(){
  try{
    let picks = suggestWorkoutsV15(5);

    // Fallback: if nothing is suggested (e.g., all muscles equally worked or no recent data),
    // suggest the least-recently-done exercises that aren't already marked done today.
    if(!picks || picks.length === 0){
      const doneSet = new Set(Object.keys(_loadMap('doneMap')||{}));
      const recentMap = new Map(); // exId -> most recent date (YYYY-MM-DD)
      for(const l of logsForUser()){
        const d = _isoDate(l.date || l.timestamp);
        const prev = recentMap.get(l.exercise_id);
        if(!prev || d > prev) recentMap.set(l.exercise_id, d);
      }
      const pool = exercisesForUser().filter(e => !doneSet.has(e.id));
      // Oldest-first by last done date; never-done first
      pool.sort((a,b)=>{
        const da = recentMap.get(a.id) || '0000-00-00';
        const db = recentMap.get(b.id) || '0000-00-00';
        if(da === db) return a.name.localeCompare(b.name);
        return da < db ? -1 : 1;
      });
      picks = pool.slice(0,3);
    }

    state.suggestIds = new Set((picks||[]).map(p=>p.id));
    applySuggestionHighlightV15();

    const s = document.getElementById('suggestWrap');
    if(s){
      s.innerHTML = '<h3>Suggested Workouts (today)</h3>' + ((picks&&picks.length) ?
        '<div class="suggest-list">' + picks.map(p=>`<div class="suggest-item"><span class="name">${p.name}${p.variation? ' • '+p.variation:''}</span><span class="suggest-tag">Suggested</span></div>`).join('') :
        '<div class="meta">No suggestions yet.</div>');
    }
  }catch(err){
    console.error('suggestions failed', err);
  }
}
(function(){
  if(typeof fetchAll==='function'){
    const _f=fetchAll;
    fetchAll = async function(){
      const r=await _f.apply(this, arguments);
      setTimeout(recomputeSuggestionsV15, 0);
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded', ()=> setTimeout(recomputeSuggestionsV15, 250));
  const _render = (typeof renderList==='function' && renderList) || (typeof renderExercises==='function' && renderExercises) || null;
  if(_render){
    const wrap=function(){ _render.apply(this, arguments); applySuggestionHighlightV15(); };
    if(typeof renderList!=='undefined') renderList=wrap; else if(typeof renderExercises!=='undefined') renderExercises=wrap;
  }
})();

renderSummary = function(){
  // Keep nav active state in sync
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
  const el = document.getElementById('summaryContent');
  if(!el){ return; }

  // ---- Helpers: week/day aggregation ----
  const ymdFromLog = (l)=>{
    if (l && l.timestamp) {
      const d = new Date(l.timestamp); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${dd}`;
    }
    if (l && typeof l.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date)) return l.date;
    return null;
  };
  const mondayOf = (ymd)=>{ const d=new Date(ymd+'T12:00:00'); const w=new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0); return w.toISOString().slice(0,10); };
  const weeklyForUser = (uid)=>{
    const map = new Map(); // weekKey -> Set(dayKeys)
    (state.logs||[]).filter(l=> (l.user_id||'u_camp')===uid ).forEach(l=>{
      const dk = ymdFromLog(l); if(!dk) return; const wk = mondayOf(dk);
      if(!map.has(wk)) map.set(wk, new Set()); map.get(wk).add(dk);
    });
    return map;
  };

  // ---- Current user streaks ----
  const curMap = weeklyForUser(state.userId);
  const curWeeks = [...curMap.keys()].sort();
  let cur=0, best=0, perfect=0, prevIdx=-2;
  curWeeks.forEach((k,i)=>{
    const sessions = (curMap.get(k)||new Set()).size;
    const ok = sessions>=3;
    if(ok){ if(i===prevIdx+1) cur+=1; else cur=1; best=Math.max(best,cur); if(sessions>=5) perfect+=1; prevIdx=i; } else { cur=0; }
  });

  // ---- Couple streak & scoreboard ----
  const campMap  = weeklyForUser('u_camp');
  const annieMap = weeklyForUser('u_annie');
  const allWeeks = [...new Set([...campMap.keys(), ...annieMap.keys()])].sort();
  let coupleCur=0, coupleBest=0, prev=-2;
  let scoreCamp=0, scoreAnnie=0;
  allWeeks.forEach((k,i)=>{
    const c = (campMap.get(k)||new Set()).size;
    const a = (annieMap.get(k)||new Set()).size;
    if(c>=3 && a>=3){ if(i===prev+1) coupleCur+=1; else coupleCur=1; coupleBest=Math.max(coupleBest,coupleCur); prev=i; } else { coupleCur=0; }
    if(c>a) scoreCamp++; else if(a>c) scoreAnnie++;
  });

  // ---- Weekly dots for current user ----
  const wf = daysThisWeekFlags();

  // ---- Build DOM using CSS classes (no inline layout styles) ----
  el.innerHTML = `
    <div class="summary-grid">
      <div>
        <div class="summary-title">Current Streak</div>
        <div class="summary-card">
          <div class="summary-metric" id="curStreakNum">${cur}</div>
        </div>
      </div>
      <div>
        <div class="summary-title">Current Streak</div>
        <div class="summary-card">
          <div class="streak-dots" id="wkDots"></div>
          <div class="summary-stats">
            <div class="summary-stat">Best: <b>${best}</b> weeks</div>
            <div class="summary-stat">Perfect weeks: <b>${perfect}</b></div>
            <div class="summary-stat">Couple Streak: <b>${coupleBest}</b> weeks</div>
            <div class="summary-stat">Scoreboard: Camp <b>${scoreCamp}</b> – Annie <b>${scoreAnnie}</b></div>
          </div>
        </div>
      </div>
    </div>`;

  // Populate dots
  const dotsWrap = document.getElementById('wkDots');
  if(dotsWrap){
    dotsWrap.innerHTML = '';
    for(let i=0;i<7;i++){
      const s = document.createElement('span'); s.className = 'dot' + (wf.flags[i] ? ' on' : ''); dotsWrap.appendChild(s);
    }
  }
};

    