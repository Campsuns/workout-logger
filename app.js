console.log("✅ JS file loaded and running");
ensureModalAnimStyles();
// === Boot loader overlay (first paint) ===
function ensureBootLoader(){
  try{
    if (document.getElementById('boot-loader')) return;
    const css = document.createElement('style');
    css.id = 'boot-loader-css';
    css.textContent = `
      #boot-loader{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
        background:rgba(10,12,14,.92);z-index:9999;transition:opacity .25s ease;}
      #boot-loader.hidden{opacity:0;pointer-events:none}
      .boot-dots{display:flex;gap:7px}
      .boot-dot{width:10px;height:10px;border-radius:4px;background:var(--accent);opacity:.85;
        animation:bd 900ms infinite ease-in-out}
      .boot-dot:nth-child(2){animation-delay:.1s}
      .boot-dot:nth-child(3){animation-delay:.2s}
      @keyframes bd{0%,80%,100%{transform:scale(.6)}40%{transform:scale(1)}}
    `;
    document.head.appendChild(css);
    const overlay = document.createElement('div');
    overlay.id = 'boot-loader';
    overlay.innerHTML = '<div class="boot-dots"><div class="boot-dot"></div><div class="boot-dot"></div><div class="boot-dot"></div></div>';
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ()=> document.body.appendChild(overlay));
    } else {
      document.body.appendChild(overlay);
    }
  }catch(_){}
}
function showBootLoader(){ try{ ensureBootLoader(); const el=document.getElementById('boot-loader'); if(el) el.classList.remove('hidden'); }catch(_){}} 
function hideBootLoader(){ try{ const el=document.getElementById('boot-loader'); if(el){ el.classList.add('hidden'); setTimeout(()=>{ try{ el.remove(); }catch(_){ } }, 260); } }catch(_){} }
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
// ---- Log modal slide animations (enter from bottom, exit upward) ----
function ensureModalAnimStyles(){
  let s = document.getElementById('log-modal-anim');
  if(!s){ s = document.createElement('style'); s.id='log-modal-anim'; document.head.appendChild(s); }
  s.textContent = `
    @keyframes logEnter {
      from { transform: translateY(100vh); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    @keyframes logExit {
      from { transform: translateY(0);     opacity: 1; }
      to   { transform: translateY(-18vh); opacity: 0; }
    }
    #logModal { will-change: transform, opacity; }
    #logModal.is-enter { animation: logEnter 380ms cubic-bezier(.22,.61,.36,1) forwards; }
    #logModal.is-exit  { animation: logExit  320ms cubic-bezier(.4,0,.2,1)   forwards; }
  `;
}
  let s = document.getElementById('dot-bounce-style');
  const css = `
    @keyframes dotBounce{0%{transform:translateY(0);opacity:.7}50%{transform:translateY(-4px);opacity:1}100%{transform:translateY(0);opacity:.7}}
    .consistency.loading .dot{ animation: dotBounce 700ms ease-in-out infinite; }

    /* Mini header loader (kept) */
    #miniLoad{ display:inline-flex; align-items:center; gap:6px; margin-left:8px; }
    #miniLoad .d{ width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.18); }
    #miniLoad.loading .d{ animation: dotBounce 700ms ease-in-out infinite; }

    /* Full-screen wipe overlay while switching profiles */
    #switchOverlay{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:9999; background: var(--accent); will-change: transform, opacity; flex-direction: column; }
    #switchOverlay .wipe{ display:flex; gap:2px; }
    #switchOverlay .dot{ width:10px; height:10px; border-radius:4px !important; border:2px solid #fff; background:transparent; box-shadow:0 0 0 0 rgba(0,0,0,0.12); }
    #switchOverlay .burn-top,
    #switchOverlay .burn-bottom{
      font-size: calc(80%); /* +3px from inherited size */
      width: 100%;
      max-width: 65%;
      margin-left: auto; margin-right: auto;
      text-align: center;
      padding: 6px 14px;
      box-sizing: border-box;
    }
    #switchOverlay .burn-top{
      font-weight: 500;          /* bold */
      font-style: normal;        /* not italic */
      font-size: calc(80% + 2px); /* +3px from inherited size */
      opacity: .95;
      margin: 5px 0 10px;         /* scoot up (smaller top), tight gap to dots */
    }
    #switchOverlay .burn-bottom{ font-weight: 400; font-style: italic; margin: 8px 0 10px; }
    #switchOverlay.loading .dot{ border-radius:4px !important; animation: dotBounce 700ms ease-in-out infinite; }
    #switchOverlay .dot.on{ background:#fff; }

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


function ensureBurnTextElements(){
  const ov = document.getElementById('switchOverlay');
  if(!ov) return null;
  let top = ov.querySelector('.burn-top');
  let bot = ov.querySelector('.burn-bottom');
  if(!top){ top = document.createElement('div'); top.className='burn-top'; ov.insertBefore(top, ov.firstChild); }
  top.style.transform = 'translateY(-5px)';
  if(!bot){ bot = document.createElement('div'); bot.className='burn-bottom'; ov.appendChild(bot); }
  return { top, bot };
}

const BURN_LINES = [
  { top:"loading your workouts…", bottom:"but your {muscle} hasn’t seen a load since dial-up. time to pull some weight." },
  { top:"fetching your stats…", bottom:"{muscle} day’s still waiting in the lost and found. go reclaim it." },
  { top:"warming up your muscles…", bottom:"except your {muscle}, which is still in hibernation. wake it up." },
  { top:"analyzing progress…", bottom:"{muscle} reports: ‘404 gains not found.’ fix that today." },
  { top:"calibrating strength…", bottom:"{muscle} is still on factory settings. upgrade overdue." },
  { top:"syncing history…", bottom:"your {muscle} history is a short story. let’s write a comeback arc." },
  { top:"prepping your plan…", bottom:"your {muscle} plan’s been ‘pending’. hit start." },
  { top:"crunching numbers…", bottom:"{muscle} is still counting to three. aim for sets, not guesses." },
  { top:"optimizing performance…", bottom:"{muscle} performance capped at demo mode. unlock the full version." },
  { top:"checking equipment…", bottom:"your {muscle} didn’t check in. roll call’s today." },
  { top:"loading momentum…", bottom:"{muscle} took a detour. gps says: straight to the rack." },
  { top:"rebuilding routine…", bottom:"{muscle} needs bricks, not wishes. lay a set." },
  { top:"tuning form…", bottom:"{muscle} form’s on mute. turn it up with reps." },
  { top:"measuring effort…", bottom:"{muscle} effort stuck on airplane mode. toggle beast mode." },
  { top:"fetching prs…", bottom:"{muscle} says ‘pr? first time hearing it.’ introduce yourselves." },
  { top:"compiling progress…", bottom:"{muscle} won’t compile without sets. ship a workout." },
  { top:"hydrating data…", bottom:"{muscle} is thirsty—for volume. sip later, lift now." },
  { top:"scanning recovery…", bottom:"{muscle} recovered… from doing nothing. time to work." },
  { top:"waking the app…", bottom:"your {muscle} hit snooze again. alarm set to lift." },
  { top:"stabilizing signals…", bottom:"{muscle} signal is weak. add sets for full bars." },
  { top:"assembling warmup…", bottom:"{muscle} is warmed—by excuses. heat it with reps." },
  { top:"plotting the session…", bottom:"{muscle} arc needs conflict. enter: heavy weights." },
  { top:"loading discipline…", bottom:"{muscle} keeps buffering. press play on set one." },
  { top:"checking symmetry…", bottom:"{muscle} didn’t get the memo. balance starts now." },
  { top:"priming output…", bottom:"{muscle} is whispering. make it shout—one more rep." }
];

function updateLoadingBurn(){
  // Ensure styles and nodes
  ensureLoadingStyles();
  const nodes = ensureBurnTextElements();
  if (!nodes || !nodes.top || !nodes.bot) return;

  // Context = user + muscle (so switching users rotates lines)
  const uid = state && state.userId ? String(state.userId) : 'u_camp';
  let muscle = 'back';
  try { muscle = String(mostNeglectedMuscleThisWeek() || 'back').toLowerCase(); } catch(_) {}
  const contextKey = uid + '|' + muscle;

  // Session burn state buckets
  if (!state._burnState) state._burnState = {};
  let bucket = state._burnState[contextKey];

  // Create a fresh shuffled order; avoid repeating lastIdx first
  const fresh = (avoidIdx) => {
    const idxs = BURN_LINES.map((_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    if (typeof avoidIdx === 'number' && idxs.length > 1 && idxs[0] === avoidIdx) {
      const swapWith = 1 + Math.floor(Math.random() * (idxs.length - 1));
      [idxs[0], idxs[swapWith]] = [idxs[swapWith], idxs[0]];
    }
    return { order: idxs, idx: 0, lastIdx: avoidIdx };
  };

  if (!bucket || !Array.isArray(bucket.order) || bucket.idx >= bucket.order.length) {
    const avoid = bucket && typeof bucket.lastIdx === 'number' ? bucket.lastIdx : undefined;
    bucket = fresh(avoid);
    state._burnState[contextKey] = bucket;
  }

  const lineIdx = bucket.order[bucket.idx++];
  bucket.lastIdx = lineIdx;

  const raw = BURN_LINES[lineIdx] || { setup: 'loading {{muscle}}…', punch: 'time to get after it' };
  const topTxt = (raw.setup ?? raw.top ?? '').toString();
  const botTxt = (raw.punch ?? raw.bottom ?? '').toString();
  // replace both {{muscle}} and {muscle}, case-insensitive, and guard against undefined
const fill = s => String(s || '').replace(/\{\{\s*muscle\s*\}\}|\{\s*muscle\s*\}/gi, muscle);
nodes.top.textContent = fill(topTxt);
nodes.bot.textContent = fill(botTxt);
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
    if (on) updateLoadingBurn();
    // Allow shuffling a new burn on each click while loading (bound only once)
    if (!ov._burnClickBound) {
      ov.addEventListener('click', () => {
        try { if (state && state.loading) updateLoadingBurn(); } catch (_) {}
      });
      ov._burnClickBound = true;
    }
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
    // Always pick a fresh burn for every show (even if overlay already exists)
    try { updateLoadingBurn(); } catch(_) {}
    ov.style.display = 'flex';
    ov.classList.add('loading'); // enable dot bounce during load
    // Ensure click-to-shuffle is active whenever we show the overlay
    if (!ov._burnClickBound) {
      ov.addEventListener('click', () => {
        try { if (state && state.loading) updateLoadingBurn(); } catch (_) {}
      });
      ov._burnClickBound = true;
    }
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

function mostNeglectedMuscleThisWeek(){
  try{
    const ws = (CONFIG && Number.isFinite(CONFIG.WEEK_START)) ? CONFIG.WEEK_START : 0; // 0=Sun
    const now = new Date();
    const start = _startOfWeekLocal(now, ws);
    const end   = new Date(start); end.setDate(start.getDate() + 7);

    const allMuscles = new Set();
    (exercisesForUser()||[]).forEach(e=>{
      [e.primary,e.secondary,e.tertiary].forEach(m=>{ if(m) allMuscles.add(String(m)); });
    });
    if(!allMuscles.size) return 'Back';

    const counts = new Map([...allMuscles].map(m=>[m,0]));
    const seen = new Set(); // day+exercise dedupe inside week

    for(const l of logsForUser()){
      const key = _localYMDFromLog(l); if(!key) continue;
      const d = new Date(key+'T12:00:00'); if(d<start || d>=end) continue;
      const ex = state.byId && state.byId[l.exercise_id]; if(!ex) continue;
      const dayKey = key + '|' + (ex.id||l.exercise_id);
      if(seen.has(dayKey)) continue; seen.add(dayKey);
      [ex.primary, ex.secondary, ex.tertiary].forEach(m=>{
        if(m && counts.has(m)) counts.set(m, counts.get(m) + 1);
      });
    }

    const arr = [...counts.entries()].sort((a,b)=> a[1]-b[1] || String(a[0]).localeCompare(String(b[0])));
    return arr[0] ? arr[0][0] : 'Back';
  }catch(_){ return 'Back'; }
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
  const forcePerSide = isUnilateral(exId);

  const tsOf = (l)=>{
    if(!l) return 0; const t = l.timestamp || l.date; return t ? new Date(t).getTime() : 0;
  };

  // Build a "lb / Rep" pair but include only non-zero deltas
  const pairIfChanged = (dW, dR)=>{
    const segs = [];
    if (Number(dW||0) !== 0) segs.push(_deltaSpan(dW, 'lb'));
    if (Number(dR||0) !== 0) segs.push(_deltaSpan(dR, 'Rep'));
    return segs.join(' ');
  };

  // Explicit unilateral: show only non-zero parts; hide if nothing changed
  if(want!=="both" && !forcePerSide){
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
  if(!forcePerSide && lastBoth && tsOf(lastBoth) === newest){
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
  // Show boot overlay only on the first fetch during initial load
  if (!state._bootShown) { state._bootShown = true; try { showBootLoader(); } catch(_){} }
  const data = await apiGet({action:'getAll'});
  if(data.error){ console.error(data.error); toast('API error: '+data.error); return; }
  state.exercises = data.exercises||[];
  state.splits    = data.splits||[];
  state.logs      = data.logs||[];
  state.users     = (data.users && data.users.length) ? data.users : [{user_id:'u_camp',name:'Camp'},{user_id:'u_annie',name:'Annie'}];

  // Ensure a default user is set on first load so suggestions render immediately
  if (!state.userId) {
    state.userId = (state.users && state.users[0] && state.users[0].user_id) ? state.users[0].user_id : 'u_camp';
    try { store.set({ userId: state.userId }); } catch(_) {}
  }
  // Sync body theme class before rendering
  document.body.classList.toggle('annie', state.userId === 'u_annie');

  // Build map only from CURRENT user's exercises to avoid cross-user names in Summary
  state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));

  ensureSuggestStyles();
  renderUserChips();
  renderFilters();
  renderList();
  renderSummary();
  recomputeSuggestionsV15();
  applySuggestionHighlightV15();
  // Hide boot overlay once first render is complete
  try { hideBootLoader(); } catch(_) {}
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

      // Reset only the burn rotation buckets so the next loader shows a fresh line
      if (!state._burnState) state._burnState = {};
      for (const k in state._burnState) { delete state._burnState[k]; }

      // Pull fresh data (so manual sheet edits are reflected)
      setLoading(true);
      await refreshFromBackend();
      setLoading(false);

      // After refresh, rebuild byId using the shared library
      state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));

      renderFilters();
      renderList();
      renderSummary();
      recomputeSuggestionsV15();
      applySuggestionHighlightV15();
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

// Detect if an exercise is logged per-side (left/right) historically
function isUnilateral(exId){
  try{
    for (const l of (state.logs||[])){
      if(l.exercise_id===exId && (l.side==='left' || l.side==='right')) return true;
    }
  }catch(_){ }
  return false;
}

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

// --- Modal animation helpers (dialog + backdrop) ---
function ensureModalAnimStyles(){
  if (document.getElementById('modal-anim-styles')) return;

  const style = document.createElement('style');
  style.id = 'modal-anim-styles';
  style.textContent = `
    @keyframes logEnter {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes logExit {
      from { transform: translateY(0);    opacity: 1; }
      to   { transform: translateY(100%); opacity: 0; }
    }
    @keyframes backdropIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes backdropOut {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    /* Backdrop anim is keyed by a data-anim attribute on the dialog */
    dialog[data-anim="enter"]::backdrop { animation: backdropIn .30s ease-out forwards; }
    dialog[data-anim="exit"]::backdrop  { animation: backdropOut .30s ease-in  forwards; }
    /* Dialog element classes for motion */
    dialog.is-enter { animation: logEnter .30s ease-out forwards; }
    dialog.is-exit  { animation: logExit  .30s ease-in  forwards; }
  `;
  document.head.appendChild(style);
}
// ==== Log modal ====
let modal, stepVals, curEx;

function openLog(exId){
  curEx=state.byId[exId]; if(!curEx) return;
  modal=$('#logModal');
  ensureModalAnimStyles();
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
  // Animated open with backdrop fade
  try { modal.close(); } catch(_) {}
  try { modal.showModal(); } catch(_) {}

  ensureModalAnimStyles();
  modal.classList.remove('is-exit');
  modal.classList.add('is-enter');
  modal.setAttribute('data-anim','enter');

  const onEnterDone = () => {
    modal.classList.remove('is-enter');
    modal.removeEventListener('animationend', onEnterDone);
    modal.removeAttribute('data-anim');
  };
  modal.addEventListener('animationend', onEnterDone);

  // Ensure focus lands on the active side button (prevents extra focus highlight on Left)
  setTimeout(()=>{
    const activeBtn = wrap.querySelector('button.active');
    if(activeBtn){ try { activeBtn.focus({ preventScroll: true }); } catch(_){} }
  }, 0);
}
// ---- Animate closing of the log modal ----
function animateCloseModal(){
  const m = document.getElementById('logModal');
  if(!m) return;
  if (!m.open) { try{ m.close(); }catch(_){ } return; }

  ensureModalAnimStyles();
  m.classList.remove('is-enter');
  m.classList.add('is-exit');
  m.setAttribute('data-anim','exit');

  const onDone = () => {
    m.removeEventListener('animationend', onDone);
    try { m.close(); } catch(_){ }
    m.classList.remove('is-exit');
    m.removeAttribute('data-anim');
  };
  m.addEventListener('animationend', onDone, { once:true });
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
const MUSCLE_LIST = ['Chest','Back','Trapezius','Shoulders','Front Delt','Rear Delt','Biceps','Triceps','Forearms','Abs','Glutes','Quads','Hamstrings','Calves'];
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

// ==== Heatmap (front/back) helpers ====
function ensureHeatmapStyles(){
  if (document.getElementById('heatmap-styles')) return;
  const s = document.createElement('style');
  s.id = 'heatmap-styles';
  s.textContent = `
    .hm-wrap{ width:100%; display:flex; align-items:center; justify-content:center; }
    .hm-svg{ width:100%; height:auto; max-width:468px; }
    .hm-body{ fill:#15191e; }
    .hm-outline{ fill:none; stroke:rgba(255,255,255,.10); stroke-width:1.5; vector-effect:non-scaling-stroke; }
    .hm-muscle{ fill: var(--accent); fill-opacity:.18; stroke: rgba(255,255,255,.18); stroke-width:.75; vector-effect: non-scaling-stroke; }

    /* 6-tier opacity (quantiles) */
    .hm-muscle.t1{ fill: var(--accent); fill-opacity:.90; }
    .hm-muscle.t2{ fill: var(--accent); fill-opacity:.55; }
    .hm-muscle.t3{ fill: var(--accent); fill-opacity:.30; }
    .hm-muscle.t4{ fill: var(--accent); fill-opacity:.22; }
    .hm-muscle.t5{ fill: var(--accent); fill-opacity:.16; }
    .hm-muscle.t6{ fill: var(--accent); fill-opacity:.10; }

    .hm-muscle.dim{ fill: var(--accent); fill-opacity:.10; }
    .hm-muscle.warn{ fill: var(--warn, #F6C453) !important; }
    .hm-muscle.danger{ fill: var(--danger, #FF6B6B) !important; }

    /* Fade-on animation: start red, fade to final color & opacity */
    @keyframes hmFadeOn {
      0%   { fill: var(--danger, #FF6B6B); fill-opacity: .15; }
      100% { fill: var(--final-fill, var(--accent)); fill-opacity: var(--final-op, .18); }
    }
    .hm-muscle.animating {
      animation-name: hmFadeOn;
      animation-duration: var(--hm-dur, .8s);
      animation-timing-function: ease-out;
      animation-fill-mode: both;
    }
  `;
  document.head.appendChild(s);
}

// Convert logs → per-muscle score with alias normalization
function computeMuscleFocus(period){
  const score = new Map();

  // NOTE: Chest undercount sanity fix via robust aliasing (pec/pectorals/upper/lower all → Chest).

  // Map common labels to the canonical atlas keys used in the ID maps
  // Make aliasing case‑insensitive and tolerant of hyphens/slashes/variants.
  const ALIAS_RAW = {
    // Chest family
    'chest':'Chest','pec':'Chest','pecs':'Chest','pectoral':'Chest','pectorals':'Chest',
    'pectoralis major':'Chest','pectoralis minor':'Chest','upper chest':'Chest','lower chest':'Chest',
    // Delts family
    'rear delt':'Back Delt','rear delts':'Back Delt','back delt':'Back Delt','back delts':'Back Delt',
    'front delt':'Front Delt','front delts':'Front Delt',

    'delts':'Shoulders','delt':'Shoulders','shoulder':'Shoulders','shoulders':'Shoulders',
    // Back family
    'upper back':'Upper Back','mid back':'Upper Back','lats':'Upper Back','latissimus dorsi':'Upper Back','back':'Upper Back',
    // Traps
    'trapezius':'Traps','traps':'Traps',
    // Arms
    'bicep':'Biceps','biceps':'Biceps','tricep':'Triceps','triceps':'Triceps','forearm':'Forearms','forearms':'Forearms',
    // Core
    'abs':'Core','abdominals':'Core','core':'Core',
    // Glutes/legs
    'gluteus':'Glutes','gluteus maximus':'Glutes','glutes':'Glutes',
    'quadriceps':'Quads','quads':'Quads',
    'hamstring':'Hamstrings','hamstrings':'Hamstrings',
    'calf':'Calves','calves':'Calves',
    // Lower back
    'lower back':'Lower Back'
  };
  const ALIAS = new Map(Object.entries(ALIAS_RAW).map(([k,v]) => [k.toLowerCase(), v]));

  function _canon(name){
    if(!name) return '';
    // normalize: trim, lower, collapse whitespace, swap hyphens/slashes with spaces
    let key = String(name).replace(/[\/\-]/g,' ').toLowerCase().trim().replace(/\s+/g,' ');
    return ALIAS.get(key) || name; // fall back to original if not aliased
  }

  function addNorm(name, pts){
    const canon = _canon(name);
    if(!canon) return;

    // If a generic "Shoulders" label is used, split credit across the three heads
    if (String(canon).toLowerCase() === 'shoulders'){
      ['Front Delt','Back Delt'].forEach(k=>{
        score.set(k, (score.get(k)||0) + pts/3);
      });
      return;
    }
    score.set(canon, (score.get(canon)||0) + pts);
  }

  const logs = logsForUser().filter(l => inPeriod(l.date||l.timestamp, period));
  for(const l of logs){
    const ex = state.byId[l.exercise_id];
    if(!ex) continue;
    addNorm(ex.primary,   3);
    addNorm(ex.secondary, 2);
    addNorm(ex.tertiary,  1);
  }
  // Debug helper: window.debugMuscles() logs the top muscles and totals
  if (!window.debugMuscles) {
    window.debugMuscles = function(){
      const arr = [...score.entries()].sort((a,b)=>b[1]-a[1]);
      console.table(arr.slice(0,15).map(([m,v])=>({muscle:m, points:+v.toFixed(2)})));
      return arr;
    };
  }
  return score; // Map<Muscle, number>
}

/* ===== Heatmap tiering v2: 6 buckets (t1..t6) shared ===== */
function _quantilePicker(values){
  const vals = values.filter(v => Number(v) > 0).sort((a,b) => a-b);
  if (!vals.length) {
    const f = () => 't6';
    f.thresholds = { T1:0,T2:0,T3:0,T4:0,T5:0 };
    return f;
  }
  const pick = (p) => vals[Math.max(0, Math.min(vals.length-1, Math.floor(p*(vals.length-1))))];
  const T1 = pick(0.85), T2 = pick(0.65), T3 = pick(0.45), T4 = pick(0.25), T5 = pick(0.10);
  const f = (v) => {
    const x = Number(v)||0;
    if (x >= T1) return 't1';
    if (x >= T2) return 't2';
    if (x >= T3) return 't3';
    if (x >= T4) return 't4';
    if (x >= T5) return 't5';
    return 't6';
  };
  f.thresholds = { T1,T2,T3,T4,T5 };
  return f;
}
function _tierMap6(scoreMap){
  const qp = _quantilePicker([...scoreMap.values()]);
  const out = {};
  for (const [name, val] of scoreMap.entries()){
    out[name] = qp(val);
  }
  return out;
}

// Rank → tier assignment {name -> class}
function rankToTiers(score){
  // Build 6-tier map (t1..t6) by quantiles; stable fallback to t6 if no data
  try{
    return _tierMap6(score);
  }catch(_){
    const out={}; score.forEach((_,k)=> out[k]='t6'); return out;
  }
}

// Apply heat to a given SVG root using id map
function applyHeatToSvg(svgRoot, score, idMap){
  if(!svgRoot) return;
  const tierMap = rankToTiers(score);
  // Dim all muscles first
  svgRoot.querySelectorAll('.hm-muscle').forEach(n=>n.classList.add('dim'));
  for(const [muscle, svgId] of Object.entries(idMap)){
    const el = svgRoot.getElementById ? svgRoot.getElementById(svgId) : svgRoot.querySelector('#'+svgId);
    if(!el) continue;

    // Clear previous state
    el.classList.remove('dim','t1','t2','t3','t4','t5','t6','warn','danger');

    // Base tier by rank (t1..t6)
    const tier = tierMap[muscle] || 't6';
    el.classList.add(tier);

    // Absolute score-based warnings override color via CSS hooks:
    // danger: ≤2 points, warn: ≤9 points (and not danger)
    const raw = Number((score && score.get) ? score.get(muscle) : 0) || 0;
    if (raw <= 2) {
      el.classList.add('danger');
    } else if (raw <= 9) {
      el.classList.add('warn');
    }

    // Ensure no stray inline opacity fights CSS tiers
    el.style.opacity = '';

    // --- Fade-on animation parameters per tier ---
    const TIER_OPACITY = { t1:.90, t2:.55, t3:.30, t4:.22, t5:.16, t6:.10 };
    const TIER_DUR     = { t1:1.4, t2:1.1, t3:.9,  t4:.7,  t5:.5,  t6:.35 };

    // Decide final color & opacity: warn/danger override accent
    const finalFill = el.classList.contains('danger')
      ? getComputedStyle(document.body).getPropertyValue('--danger') || '#FF6B6B'
      : el.classList.contains('warn')
        ? getComputedStyle(document.body).getPropertyValue('--warn') || '#F6C453'
        : getComputedStyle(document.body).getPropertyValue('--accent') || '#2bd2c8';

    const finalOp = TIER_OPACITY[tier] ?? .18;
    const durSec  = TIER_DUR[tier] ?? .8;

    // Pass values via CSS variables and (re)start the animation
    el.style.setProperty('--final-fill', finalFill.trim() || '#2bd2c8');
    el.style.setProperty('--final-op', String(finalOp));
    el.style.setProperty('--hm-dur', durSec + 's');

    // Restart animation each render
    el.classList.remove('animating');
    void el.offsetWidth; // reflow to reset animation
    el.classList.add('animating');
  }
}

function heatmapSVG(which){
  const isF = which==='front';
  const vb = '0 0 200 400';
  return `
    <div class="hm-wrap">
      <svg class="hm-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-label="${which} muscle heatmap">
        <!-- simplified body -->
        <g class="hm-body">
          <path class="hm-outline" d="
            M100,20
            c 18,0 28,12 32,28
            c 6,24 22,36 22,62
            v 210
            c 0,20 -14,38 -54,38
            c -40,0 -54,-18 -54,-38
            v -210
            c 0,-26 16,-38 22,-62
            c 4,-16 14,-28 32,-28
            z" />
          <ellipse cx="100" cy="40" rx="18" ry="20" class="hm-outline"/>
        </g>

        <!-- CHEST / UPPER BACK -->
        ${isF
          ? '<g id="mf-chest" class="hm-muscle"><path d="M60 96 q40 -12 80 0 v20 q-40 12 -80 0 z"/></g>'
          : '<g id="mb-upper-back" class="hm-muscle"><path d="M62 100 q38 -14 76 0 v22 q-38 12 -76 0 z"/></g>'}

        <!-- TRAPS -->
        ${isF
          ? '<g id="mf-traps" class="hm-muscle"><path d="M85 70 q8 -10 15 0 v10 q-7 6 -15 0 z"/></g>'
          : '<g id="mb-traps" class="hm-muscle"><path d="M82 72 q9 -10 18 0 v10 q-9 6 -18 0 z"/></g>'}

        <!-- DELTS -->
        ${isF
          ? '<g id="mf-front-delt" class="hm-muscle"><ellipse cx="36" cy="110" rx="14" ry="12"/><ellipse cx="164" cy="110" rx="14" ry="12"/></g>'
          : '<g id="mb-back-delt" class="hm-muscle"><ellipse cx="36" cy="118" rx="14" ry="12"/><ellipse cx="164" cy="118" rx="14" ry="12"/></g>'}

        <!-- ARMS -->
        ${isF
          ? '<g id="mf-biceps" class="hm-muscle"><rect x="24" y="128" width="20" height="46" rx="10"/><rect x="156" y="128" width="20" height="46" rx="10"/></g>'
          : '<g id="mb-triceps" class="hm-muscle"><rect x="24" y="128" width="20" height="46" rx="10"/><rect x="156" y="128" width="20" height="46" rx="10"/></g>'}

        <!-- FOREARMS -->
        ${isF
          ? '<g id="mf-forearms" class="hm-muscle"><rect x="20" y="178" width="24" height="48" rx="10"/><rect x="156" y="178" width="24" height="48" rx="10"/></g>'
          : '<g id="mb-forearms" class="hm-muscle"><rect x="20" y="178" width="24" height="48" rx="10"/><rect x="156" y="178" width="24" height="48" rx="10"/></g>'}

        <!-- CORE / LOWER BACK -->
        ${isF
          ? '<g id="mf-core" class="hm-muscle"><rect x="78" y="128" width="44" height="70" rx="12"/></g>'
          : '<g id="mb-lower-back" class="hm-muscle"><rect x="80" y="134" width="40" height="58" rx="12"/></g>'}

        <!-- GLUTES -->
        ${isF
          ? '<g id="mf-glutes" class="hm-muscle"><path d="M76 208 q24 -10 48 0 v34 q-24 12 -48 0 z"/></g>'
          : '<g id="mb-glutes" class="hm-muscle"><path d="M74 208 q26 -10 52 0 v36 q-26 12 -52 0 z"/></g>'}

        <!-- QUADS / HAMSTRINGS -->
        ${isF
          ? '<g id="mf-quads" class="hm-muscle"><rect x="64" y="246" width="26" height="92" rx="12"/><rect x="110" y="246" width="26" height="92" rx="12"/></g>'
          : '<g id="mb-hamstrings" class="hm-muscle"><rect x="64" y="246" width="26" height="92" rx="12"/><rect x="110" y="246" width="26" height="92" rx="12"/></g>'}

        <!-- CALVES -->
        ${isF
          ? '<g id="mf-calves" class="hm-muscle"><rect x="64" y="340" width="26" height="34" rx="10"/><rect x="110" y="340" width="26" height="34" rx="10"/></g>'
          : '<g id="mb-calves" class="hm-muscle"><rect x="64" y="340" width="26" height="34" rx="10"/><rect x="110" y="340" width="26" height="34" rx="10"/></g>'}
      </svg>
    </div>`;
}

// Map UI names → SVG ids for front/back
const HM_ID_MAP_FRONT = {
  'Chest':'mf-chest','Front Delt':'mf-front-delt','Traps':'mf-traps',
  'Biceps':'mf-biceps','Forearms':'mf-forearms','Core':'mf-core',
  'Glutes':'mf-glutes','Quads':'mf-quads','Calves':'mf-calves'
};
const HM_ID_MAP_BACK = {
  'Upper Back':'mb-upper-back','Back Delt':'mb-back-delt','Traps':'mb-traps',
  'Triceps':'mb-triceps','Forearms':'mb-forearms','Lower Back':'mb-lower-back',
  'Glutes':'mb-glutes','Hamstrings':'mb-hamstrings','Calves':'mb-calves'
};

function renderHeatmapsInto(containerFront, containerBack){
  ensureHeatmapStyles();
  const score = computeMuscleFocus(state.period || 'week');
  if(containerFront){
    containerFront.innerHTML = heatmapSVG('front');
    applyHeatToSvg(containerFront.querySelector('svg'), score, HM_ID_MAP_FRONT);
  }
  if(containerBack){
    containerBack.innerHTML = heatmapSVG('back');
    applyHeatToSvg(containerBack.querySelector('svg'), score, HM_ID_MAP_BACK);
  }
}

// Mobile bleed helper for atlas/heatmaps inside summary cards
function ensureAtlasMobileBleed() {
  try{
    const isPhone = window.innerWidth <= 480;
    ['#hmFrontBox', '#hmBackBox'].forEach(sel=>{
      const box = document.querySelector(sel);
      if(!box) return;
      const card = box.closest('.summary-card');
      const svg  = box.querySelector('svg');
      if(isPhone && card){
        // Expand content to bleed through card padding (assumes 14px horizontal padding)
        box.style.marginLeft  = '-14px';
        box.style.marginRight = '-14px';
        box.style.width       = 'calc(100% + 28px)';
        box.style.maxWidth    = 'none';
        box.style.overflow    = 'visible';
        if(svg){
          svg.style.maxWidth = 'none';
          svg.style.width    = '100%';
          svg.style.height   = 'auto';
        }
      } else {
        // Reset on larger screens
        box.style.removeProperty('margin-left');
        box.style.removeProperty('margin-right');
        box.style.removeProperty('width');
        box.style.removeProperty('max-width');
        box.style.removeProperty('overflow');
        if(svg){
          svg.style.removeProperty('max-width');
          svg.style.removeProperty('width');
          svg.style.removeProperty('height');
        }
      }
    });
  }catch(_){}
};
// --- Atlas v1: high‑fidelity SVG support with graceful fallback ---
(function(){
  function ensureAtlasStyles(){
    if (document.getElementById('atlas-styles')) return;
    const s = document.createElement('style');
    s.id = 'atlas-styles';
    s.textContent = `
      .atlas-wrap{ width:100%; display:flex; align-items:center; justify-content:center; }
      .atlas-svg{ width:100%; height:auto; max-width:468px; }
      /* Base silhouette (all shapes default to dark) */
      .atlas-sil{ fill:#15191e !important; stroke:rgba(255,255,255,.10); stroke-width:1.2; vector-effect:non-scaling-stroke; }
      /* Optional outline group if present in the SVG */
      .atlas-outline{ fill:none; stroke:rgba(255,255,255,.10); stroke-width:1.5; vector-effect:non-scaling-stroke; }
      /* Highlighted muscle regions (mapped ids) */
      .atlas-muscle{ fill: var(--accent); fill-opacity:.18; stroke: rgba(255,255,255,.18); stroke-width:.75; vector-effect: non-scaling-stroke; }
      .atlas-muscle.t1{ fill: var(--accent); fill-opacity:.90; }
      .atlas-muscle.t2{ fill: var(--accent); fill-opacity:.55; }
      .atlas-muscle.t3{ fill: var(--accent); fill-opacity:.30; }
      /* Absolute warnings override tiers */
      .atlas-muscle.warn{ fill: var(--warn, #F6C453) !important; fill-opacity:.15 !important; }
      .atlas-muscle.danger{ fill: var(--danger, #FF6B6B) !important; fill-opacity:.15 !important; }
      .atlas-muscle.dim{ fill: var(--accent); fill-opacity:.10; }
      /* Fade-on animation (start red ➜ fade to tier/warn/danger color) */
      .atlas-muscle.animating{ animation: hmFadeOn var(--hm-dur, .8s) ease-out both; }
      @keyframes hmFadeOn{
        0%   { fill: var(--danger, #FF6B6B); fill-opacity:.15; }
        100% { fill: var(--final-fill, var(--accent)); fill-opacity: var(--final-op, .18); }
      }
    `;
    document.head.appendChild(s);
  }

  // Try to render an inline SVG string + apply heat tiers by id map
  function renderSvgInto(container, svgString, idMap, score){
    if (!container || !svgString) return false;
    ensureAtlasStyles();
    // Wrap to control sizing
    const wrap = document.createElement('div');
    wrap.className = 'atlas-wrap';
    // Insert SVG markup
    wrap.innerHTML = svgString;
    // Normalize: find the root svg and ensure a class
    const svg = wrap.querySelector('svg');
    if (!svg) return false;
    svg.classList.add('atlas-svg');

    // Build a Set of mapped element ids (accept string or array per muscle)
    const mappedIds = new Set();
    if (idMap && typeof idMap === 'object'){
      Object.values(idMap).forEach(entry => {
        if (!entry) return;
        if (Array.isArray(entry)) {
          entry.forEach(id => { if (id) mappedIds.add(String(id)); });
        } else {
          mappedIds.add(String(entry));
        }
      });
    }

    // For every element that has an id, add either .atlas-muscle (if mapped) or .atlas-sil (default)
    // We only touch basic shapes/groups to avoid styling defs/gradients.
    svg.querySelectorAll('[id]').forEach(el => {
      const id = el.getAttribute('id');
      // Skip <defs> content
      if (el.closest('defs')) return;
      // Mark mapped vs silhouette
      if (mappedIds.has(id)) {
        el.classList.add('atlas-muscle');
        el.classList.remove('atlas-sil');
      } else {
        // Do not override explicit atlas-muscle groups from authoring
        if (!el.classList.contains('atlas-muscle')) {
          el.classList.add('atlas-sil');
        }
      }
    });

    // Place content
    container.innerHTML = '';
    container.appendChild(wrap);

    // Color by tiers (reuse existing ranking logic)
    if (idMap && score){
      // tier map by muscle name
      const tiers = (function(){
        try{
          return _tierMap6(score);
        }catch(_){
          const out={}; score.forEach((_,k)=> out[k]='t6'); return out;
        }
      })();

      // First dim all explicitly mapped shapes
      mappedIds.forEach(id=>{
        const el = svg.getElementById ? svg.getElementById(id) : svg.querySelector('#'+CSS.escape(id));
        if (el){ el.classList.remove('t1','t2','t3','t4','t5','t6','warn','danger'); el.classList.add('dim'); }
      });

      // Tier opacity/duration maps (match simplified heatmap)
      const TIER_OPACITY = { t1:.90, t2:.55, t3:.30, t4:.22, t5:.16, t6:.10 };
      const TIER_DUR     = { t1:1.4, t2:1.1, t3:.9,  t4:.7,  t5:.5,  t6:.35 };

      // Apply tier classes per muscle name
      Object.entries(idMap).forEach(([muscle, entry])=>{
        const ids = Array.isArray(entry) ? entry : [entry];
        const tier = tiers[muscle] || 't6';

        // Raw score for absolute thresholds
        const raw = (score && typeof score.get === 'function') ? Number(score.get(muscle) || 0) : 0;

        ids.forEach(id=>{
          if (!id) return;
          const el = svg.getElementById ? svg.getElementById(id) : svg.querySelector('#'+CSS.escape(id));
          if (!el) return;

          // Remove previous state classes
          el.classList.remove('dim','t1','t2','t3','t4','t5','t6','warn','danger');
          el.classList.add('atlas-muscle', tier);
          el.classList.remove('atlas-sil');

          // Strip inline attributes that can override CSS
          const clearInline = (node)=>{
            try{
              node.removeAttribute('fill');
              node.removeAttribute('fill-opacity');
              // keep stroke from authoring; just clear opacity
              node.style && node.style.removeProperty && node.style.removeProperty('opacity');
            }catch(_){}
            // Also process direct children (common in grouped paths)
            if (node.children && node.children.length){
              [...node.children].forEach(clearInline);
            }
          };
          clearInline(el);

          // Absolute warnings override tier color via CSS
          if (raw <= 2) {
            el.classList.add('danger');
          } else if (raw <= 9) {
            el.classList.add('warn');
          }

          // Decide final color by state (danger/warn override accent)
          const rootStyles = getComputedStyle(document.body);
          const finalFill =
            el.classList.contains('danger') ? (rootStyles.getPropertyValue('--danger') || '#FF6B6B') :
            el.classList.contains('warn')   ? (rootStyles.getPropertyValue('--warn')   || '#F6C453') :
                                              (rootStyles.getPropertyValue('--accent') || '#2bd2c8');

          // Final opacity & duration by tier
          const finalOp = TIER_OPACITY[tier] ?? .18;
          const durSec  = TIER_DUR[tier] ?? .8;

          // Pass to CSS and (re)start animation
          el.style.setProperty('--final-fill', finalFill.trim() || '#2bd2c8');
          el.style.setProperty('--final-op', String(finalOp));
          el.style.setProperty('--hm-dur', durSec + 's');

          // Restart fade each render
          el.classList.remove('animating');
          void el.offsetWidth; // reflow
          el.classList.add('animating');
        });
      });
    }

    return true;
  }

  // Public API (idempotent): prefer window.MUSCLE_ATLAS_* globals if present
  window.renderMuscleAtlas = function(containerFront, containerBack){
    try{
      const score = computeMuscleFocus(state.period || 'week');

      const fSvg = window.MUSCLE_ATLAS_FRONT_SVG || null;
      const bSvg = window.MUSCLE_ATLAS_BACK_SVG  || null;
      const fMap = window.MUSCLE_ATLAS_FRONT_IDS || null;
      const bMap = window.MUSCLE_ATLAS_BACK_IDS  || null;

      let didFront = false, didBack = false;

      if (containerFront && fSvg && fMap){
        didFront = renderSvgInto(containerFront, fSvg, fMap, score);
      }
      if (containerBack && bSvg && bMap){
        didBack = renderSvgInto(containerBack, bSvg, bMap, score);
      }

      // Fallback to simplified heatmap for whichever side wasn’t rendered
      if (!didFront || !didBack){
        renderHeatmapsInto(!didFront ? containerFront : null, !didBack ? containerBack : null);
      }
    }catch(_){
      // Hard fallback if anything goes wrong
      try { renderHeatmapsInto(containerFront, containerBack); } catch(__){}
    }
  };
})();

/* === Atlas asset bootstrap (front/back SVG + id maps) =======================
   This makes the high-fidelity heatmap work even if the app didn't set
   window.MUSCLE_ATLAS_* globals yet. It looks for inline <script> tags that
   you can paste the raw SVG / JSON into, and registers them once.
   - <script id="atlas-front-svg" type="text/plain">...SVG markup...</script>
   - <script id="atlas-front-ids" type="application/json">{"Chest":"ID", ...}</script>
   - <script id="atlas-back-svg"  type="text/plain">...SVG markup...</script>
   - <script id="atlas-back-ids"  type="application/json">{"Upper Back":"ID", ...}</script>
*/
(function(){
  function readText(id){
    const el = document.getElementById(id);
    if (!el) return null;
    // innerHTML preserves markup for type="text/plain"
    const txt = (el.textContent && el.textContent.trim()) || (el.innerHTML && el.innerHTML.trim()) || '';
    return txt || null;
  }
  function readJSON(id){
    const t = readText(id);
    if (!t) return null;
    try{ return JSON.parse(t); }catch(_){ console.warn('atlas ids JSON parse failed for', id); return null; }
  }
  window.ensureAtlasAssets = function ensureAtlasAssets(){
    try{
      // Only fill globals if they aren't already present
      if (!window.MUSCLE_ATLAS_FRONT_SVG){
        const s = readText('atlas-front-svg');
        if (s) window.MUSCLE_ATLAS_FRONT_SVG = s;
      }
      if (!window.MUSCLE_ATLAS_FRONT_IDS){
        const m = readJSON('atlas-front-ids');
        if (m) window.MUSCLE_ATLAS_FRONT_IDS = m;
      }
      if (!window.MUSCLE_ATLAS_BACK_SVG){
        const s = readText('atlas-back-svg');
        if (s) window.MUSCLE_ATLAS_BACK_SVG = s;
      }
      if (!window.MUSCLE_ATLAS_BACK_IDS){
        const m = readJSON('atlas-back-ids');
        if (m) window.MUSCLE_ATLAS_BACK_IDS = m;
      }
      // One-time log (debug)
      if (window.MUSCLE_ATLAS_FRONT_SVG || window.MUSCLE_ATLAS_BACK_SVG){
        if (!window.__atlasOnce){
          console.log('✅ Muscle atlas assets detected.',
            { frontSvg: !!window.MUSCLE_ATLAS_FRONT_SVG, frontIds: !!window.MUSCLE_ATLAS_FRONT_IDS,
              backSvg:  !!window.MUSCLE_ATLAS_BACK_SVG,  backIds:  !!window.MUSCLE_ATLAS_BACK_IDS });
          window.__atlasOnce = true;
        }
      }
    }catch(err){
      console.warn('ensureAtlasAssets error', err);
    }
  };

  // Optional: simple registration API if you prefer to set assets from code
  window.registerMuscleAtlas = function registerMuscleAtlas({front, back}){
    if (front){
      if (front.svg) window.MUSCLE_ATLAS_FRONT_SVG = front.svg;
      if (front.ids) window.MUSCLE_ATLAS_FRONT_IDS = front.ids;
    }
    if (back){
      if (back.svg) window.MUSCLE_ATLAS_BACK_SVG = back.svg;
      if (back.ids) window.MUSCLE_ATLAS_BACK_IDS = back.ids;
    }
    // Make sure styles and render function exist, and then trigger a re-render if summary is visible
    try{
      if (typeof window.renderMuscleAtlas === 'function'){
        const fr = document.getElementById('hmFrontBox');
        const br = document.getElementById('hmBackBox');
        if (fr || br) window.renderMuscleAtlas(fr, br);
      }
    }catch(_){}
  };
})();

function renderSummary(){
  // keep nav active state in sync with current page
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));

  const wrap = document.getElementById('summaryContent');
  if (!wrap) return;

  // Fresh scaffold with placeholders — layout only
  wrap.innerHTML = `
    <div class="summary-grid">
      
      <!-- Row 1: 4 Boxes Group (left) -->
      <div>
        <div class="summary-box-header">4 Boxes Group</div>
        <div class="summary-card quad">
          <div class="quad"><div class="label">Metric A</div><div class="value">42</div></div>
          <div class="quad"><div class="label">Metric B</div><div class="value">7</div></div>
          <div class="quad"><div class="label">Metric C</div><div class="value">19</div></div>
          <div class="quad"><div class="label">Metric D</div><div class="value">3</div></div>
        </div>
      </div>

      <!-- Row 1: Default Box (right) -->
      <div>
        <div class="summary-box-header">Default Box</div>
        <div class="summary-card default">
          <div class="summary-stats">
            <div>Placeholder content for a text-heavy box.</div>
            <div>All text here is 10px.</div>
          </div>
        </div>
      </div>

      
      <!-- Row 3: Two Default Boxes -->
      <div>
        <div class="summary-box-header">Front Heat Map</div>
        <div class="summary-card default">
          <div id="hmFrontBox" class="summary-stats"></div>
        </div>
      </div>
      <div>
        <div class="summary-box-header">Back Heat Map</div>
        <div class="summary-card default">
          <div id="hmBackBox" class="summary-stats"></div>
        </div>
      </div>

<!-- Row 4: Muscle Focus (full width) -->
<div class="row-wide">
  <div class="summary-box-header">Muscle Focus</div>
  <div class="summary-card wide">
    <div class="summary-stats">
      <div id="muscleBarsBox"></div>
    </div>
  </div>
</div>

<!-- Row 2: Wide Box (full width) -->
      <div class="row-wide">
        <div class="summary-box-header">Wide Box</div>
        <div class="summary-card wide">
          <div class="summary-stats">
            <div>Wide placeholder content that spans across both columns.</div>
          </div>
        </div>
      </div>



    </div>`;

  // Ensure the full-width rows span across both grid columns without touching global CSS
  wrap.querySelectorAll('.row-wide').forEach(node=>{
    try{ node.style.gridColumn = '1 / -1'; } catch(_) {}
  });

  // Render heatmaps every time Summary renders
  try{
    const frontC = document.getElementById('hmFrontBox');
    const backC  = document.getElementById('hmBackBox');
    renderHeatmapsInto(frontC, backC);
  }catch(_){}
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
  state.page = page || 'summary';
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
(function(){ document.body.setAttribute('data-page', state.page || 'summary'); })();


// Ensure renderSummary maintains page dataset for CSS
const _renderSummaryOriginal = renderSummary;
renderSummary = function(){
  document.body.setAttribute('data-page', state.page || 'summary');
  _renderSummaryOriginal();
};

// On initial boot, apply page
setTimeout(()=>setPage(state.page || 'summary'), 0);






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



// ====== PATCH v10 — Cancel closes modal (animated) ======
document.addEventListener('click', (e)=>{
  const b=e.target.closest('#btnCancel');
  if(!b) return;
  e.preventDefault();
  animateCloseModal();
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
    animateCloseModal();
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
    animateCloseModal();
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

// Helper: Derive local YYYY-MM-DD for a log, robust to multiple date formats
function _localYMDFromLog(l){
  // Return local YYYY-MM-DD for mixed date inputs.
  // Prefer `timestamp` if present; otherwise use `date`.
  const val = (l && (l.timestamp || l.date)) || null;
  if (!val) return '';

  const toYMD = (d)=>{
    if (!(d instanceof Date) || isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };

  // 1) ISO timestamp like 2025-08-10T12:00:00Z or with offset
  if (typeof val === 'string' && /T\d{2}:\d{2}:\d{2}/.test(val)){
    const d = new Date(val); // browser handles TZ correctly
    return toYMD(d);
  }

  // 2) `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` (note: iOS Safari fails the latter via `new Date()`)
  if (typeof val === 'string' && /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.test(val)){
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
    const y = +m[1], mo = +m[2], d = +m[3];
    const hh = +(m[4]||12), mi = +(m[5]||0), ss = +(m[6]||0);
    return toYMD(new Date(y, mo-1, d, hh, mi, ss)); // LOCAL, avoids iOS parsing bugs
  }

  // 3) `M/D/YYYY HH:MM:SS` or `M/D/YYYY` (US-style, variable zero padding)
  if (typeof val === 'string' && /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/.test(val)){
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
    const mo = +m[1], d = +m[2], y = +m[3];
    const hh = +(m[4]||12), mi = +(m[5]||0), ss = +(m[6]||0);
    return toYMD(new Date(y, mo-1, d, hh, mi, ss)); // LOCAL
  }

  // 4) Last resort: let Date try; then normalize to local YMD
  const d = new Date(val);
  return toYMD(d);
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

// === Summary helpers ===
function _isoDayLocal(val){
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function _periodWindow(period){
  const start = startOfPeriod(period||'week');
  const end   = new Date(start); end.setHours(0,0,0,0);
  if ((period||'week')==='week') end.setDate(end.getDate()+7);
  else if ((period||'month')==='month') end.setMonth(end.getMonth()+1);
  else end.setFullYear(end.getFullYear()+1);
  return {start, end};
}
// === Summary metrics v2 — unified date logic (single source of truth) ===
const WEEK_START = Number(CONFIG && Number.isFinite(CONFIG.WEEK_START) ? CONFIG.WEEK_START : 0); // 0=Sun default

function ymdFromLogLocal(l){
  // Reuse robust helper already in file
  return _localYMDFromLog(l);
}
function periodWindowLocal(period, ref = new Date()){
  const p = (period||'week').toLowerCase();
  const startRef = new Date(ref); startRef.setHours(0,0,0,0);
  if (p==='week'){
    const s = _startOfWeekLocal(startRef, WEEK_START);
    const e = new Date(s); e.setDate(e.getDate()+7);
    return { start: s, end: e };
  } else if (p==='month'){
    const s = new Date(startRef.getFullYear(), startRef.getMonth(), 1, 0,0,0,0);
    const e = new Date(startRef.getFullYear(), startRef.getMonth()+1, 1, 0,0,0,0);
    return { start: s, end: e };
  } else { // 'year'
    const s = new Date(startRef.getFullYear(), 0, 1, 0,0,0,0);
    const e = new Date(startRef.getFullYear()+1, 0, 1, 0,0,0,0);
    return { start: s, end: e };
  }
}
function sessionAndWorkoutCounts(period, userId){
  const {start, end} = periodWindowLocal(period);
  const days = new Set();
  let workouts = 0;
  for (const l of (state.logs||[])){
    if ((l.user_id||'u_camp') !== userId) continue;
    const ymd = ymdFromLogLocal(l); if (!ymd) continue;
    const dt = new Date(ymd+'T12:00:00');
    if (dt < start || dt >= end) continue;
    workouts += 1; // each log row counts as one workout entry
    days.add(ymd); // unique training days
  }
  return { sessions: days.size, workouts };
}
function weekKeyFromYMD(ymd){
  const d = new Date(ymd+'T12:00:00');
  const w0 = _startOfWeekLocal(d, WEEK_START);
  return w0.toISOString().slice(0,10);
  }
function streakForUser(userId){
  const rows = (state.logs||[]).filter(l => (l.user_id||'u_camp')===userId);
  if (!rows.length) return { current:0, best:0, perfectWeeks:0, thisWeekSessions:0 };

  // week -> Set(unique days)
  const map = new Map();
  for (const l of rows){
    const ymd = ymdFromLogLocal(l); if (!ymd) continue;
    const wk = weekKeyFromYMD(ymd);
    if (!map.has(wk)) map.set(wk, new Set());
    map.get(wk).add(ymd);
  }

  // Continuous list of weeks from first to this week
  const keys = [...map.keys()].sort();
  const first = _startOfWeekLocal(new Date(keys[0]+'T00:00:00'), WEEK_START);
  const thisWeek = _startOfWeekLocal(new Date(), WEEK_START);
  const weeks = [];
  for (let d=new Date(first); d<=thisWeek; d.setDate(d.getDate()+7)){
    const k = d.toISOString().slice(0,10);
    weeks.push({ k, sessions: (map.get(k)?.size||0) });
  }

  // Best streak across full history (>=3 sessions)
  let best=0, run=0;
  for (const w of weeks){
    if (w.sessions>=3){ run++; if (run>best) best=run; }
    else run=0;
  }

  // Current streak that IGNORES the in‑progress week at the end if it's <3
  let lastIdx = weeks.length - 1;
  if (lastIdx >= 0 && weeks[lastIdx].sessions < 3) lastIdx--; // drop current week if not complete
  let current = 0;
  for (let i=lastIdx; i>=0; i--){
    if (weeks[i].sessions >= 3) current++;
    else break;
  }

  const thisWeekSessions = weeks.length ? weeks[weeks.length-1].sessions : 0;
  const perfectWeeks = weeks.filter(w=>w.sessions>=5).length;
  return { current, best, perfectWeeks, thisWeekSessions };
}
function coupleStreak(){
  const users = ['u_camp','u_annie'];
  const weekMap = new Map(); // week -> {uid: count}
  const seen = new Set();    // dedupe per user per day
  for (const l of (state.logs||[])){
    const uid = (l.user_id||'u_camp'); if (!users.includes(uid)) continue;
    const ymd = ymdFromLogLocal(l); if (!ymd) continue;
    const dedupeKey = uid+'|'+ymd; if (seen.has(dedupeKey)) continue; seen.add(dedupeKey);
    const wk = weekKeyFromYMD(ymd);
    if (!weekMap.has(wk)) weekMap.set(wk, { u_camp:0, u_annie:0 });
    const rec = weekMap.get(wk); rec[uid] += 1;
  }
  const keys = [...weekMap.keys()].sort();
  if (!keys.length) return 0;
  const first = _startOfWeekLocal(new Date(keys[0]+'T00:00:00'), WEEK_START);
  const thisWeek = _startOfWeekLocal(new Date(), WEEK_START);
  const list = [];
  for (let d=new Date(first); d<=thisWeek; d.setDate(d.getDate()+7)){
    const k = d.toISOString().slice(0,10);
    const rec = weekMap.get(k) || { u_camp:0, u_annie:0 };
    list.push(rec.u_camp>=3 && rec.u_annie>=3);
  }
  let cur=0; for (let i=list.length-1;i>=0;i--){ if(list[i]) cur++; else break; }
  return cur;
}
function uniqueDaysInPeriod(period, userId){
  const r = sessionAndWorkoutCounts(period, userId);
  return r.sessions;
}
function totalLogsInPeriod(period, userId){
  const r = sessionAndWorkoutCounts(period, userId);
  return r.workouts;
}

// --- Deload gate: require two consecutive underperforming weeks before deloading ---
function _weekKeyFromDate(d){
  const base = (d instanceof Date) ? d : new Date(d);
  const wk   = _startOfWeekLocal(base, WEEK_START||0);
  return wk.toISOString().slice(0,10);
}
function _shouldDeloadGate(exId, userId, weekKey, trigger){
  // trigger=true when this week underperformed (or RPE very high)
  // Returns true only if this is the **second** consecutive week with trigger
  try{
    const map = _loadMap('underperfGate');
    const k   = `${userId||'u_camp'}|${exId}`;
    const rec = map[k] || { wk:'', flagged:false };
    let deload = false;
    if(trigger){
      if(rec.flagged && rec.wk && rec.wk !== weekKey){
        // Second consecutive week → allow deload and clear flag for next cycle
        deload = true;
        rec.flagged = false;
        rec.wk = weekKey;
      } else {
        // First underperforming week → set flag, no deload yet
        rec.flagged = true;
        rec.wk = weekKey;
      }
    } else {
      // Good week → clear flag
      rec.flagged = false; rec.wk = weekKey;
    }
    map[k] = rec; _saveMap('underperfGate', map);
    return deload;
  }catch(_){ return trigger; }
}

function computeNextFromPerformance(last, ex){
  // Config knobs & safe fallbacks
  const INC = Number(ex?.increment_lb || CONFIG?.DEFAULT_INC_LB || 5);
  const REP_MIN = Number(CONFIG?.REP_MIN || 8);
  const REP_MAX = Number(CONFIG?.REP_MAX || 12);
  const R2X   = Number(CONFIG?.OVERPERF_RATIO_2X   || 2.0);
  const R1P5X = Number(CONFIG?.OVERPERF_RATIO_1P5X || 1.5);
  const RPE_VH = Number(CONFIG?.RPE_VERY_HIGH || 9.5);
  const RPE_OK = Number(CONFIG?.RPE_OK_FOR_REP_UP || 9.0);
  const BIG_STEPS = Number(CONFIG?.OVERPERF_BIG_INC_STEPS || 2);
  const MED_STEPS = Number(CONFIG?.OVERPERF_MED_INC_STEPS || 1);

  // Normalize inputs
  const planned   = Math.max(1, Number(last?.planned_reps ?? REP_MIN));
  const achieved  = Math.max(0, Number((last?.fail_reps ?? last?.planned_reps) ?? REP_MIN));
  const rpe       = Number(last?.rpe_set2 ?? 8);
  let nextWeight  = Math.max(0, Number(last?.weight_lb ?? ex?.default_weight ?? 0));
  let nextReps    = planned;

  const ratio = achieved / planned; // over/under performance

  // Identify exercise/user/week once (for deload gating)
  const exId   = (last && last.exercise_id) || (ex && ex.id) || null;
  const uid    = (last && (last.user_id||last.userId)) || (state && state.userId) || 'u_camp';
  const lastYMD= (last && (_localYMDFromLog(last))) || today();
  const wkKey  = (function(d){ return _startOfWeekLocal(new Date(d+'T12:00:00'), Number(CONFIG?.WEEK_START||0)).toISOString().slice(0,10); })(lastYMD);

  // Gate deloads: only deload on the second consecutive "under" week (missed reps OR very high RPE)
  const gateTrigger = (ratio < 1.0) || (rpe >= RPE_VH);
  const deloadNow   = _shouldDeloadGate(exId, uid, wkKey, gateTrigger);

  // If this is the second consecutive under week, apply a deload immediately (regardless of ratio category)
  if (deloadNow) {
    if (ratio <= 0.5 || rpe >= RPE_VH) {
      nextWeight = Math.max(0, nextWeight - 2*INC);
      nextReps   = Math.max(REP_MIN, planned - 2);
    } else if (ratio <= 0.9) {
      nextWeight = Math.max(0, nextWeight - 1*INC);
      // Small rep recovery if effort wasn't extreme
      nextReps   = (rpe <= 8) ? Math.min(REP_MAX, planned + 1) : Math.max(REP_MIN, planned);
    } else {
      // Hit reps but RPE previously high two weeks running → light deload
      nextWeight = Math.max(0, nextWeight - 1*INC);
      nextReps   = Math.max(REP_MIN, planned);
    }
  } else {
    // Normal progression paths
    if (ratio < 1.0) {
      // First under week → conservative: hold load, tiny rep tweak only
      nextWeight = Math.max(0, nextWeight); // unchanged
      if (ratio <= 0.9) {
        nextReps = (rpe >= 9) ? Math.max(REP_MIN, planned - 1) : planned;
      } else {
        nextReps = (rpe >= 9) ? Math.max(REP_MIN, planned - 1) : planned;
      }
    } else if (ratio === 1.0) {
      // On target
      if (nextReps < REP_MAX && rpe <= RPE_OK) {
        nextReps = Math.min(REP_MAX, planned + 1);
      } else if (nextReps >= REP_MAX && rpe <= RPE_OK) {
        nextReps   = REP_MIN;            // cycle reps down
        nextWeight = nextWeight + INC;   // progress via load
      }
      // high RPE on target → hold
    } else {
      // Over-performance
      if (ratio >= R2X && rpe <= 8.5){
        // Smashed it → bigger jump on both axes
        nextWeight = nextWeight + BIG_STEPS * INC; // typically +10 lb for 5-lb INC
        nextReps   = Math.min(REP_MAX, planned + 3);
      } else if (ratio >= R1P5X){
        // 1.5×–2× → weight up and reps up more than +1
        nextWeight = nextWeight + MED_STEPS * INC; // typically +5 lb
        nextReps   = Math.min(REP_MAX, planned + 2);
        if (rpe <= 8 && nextReps >= REP_MAX){
          // If capped on reps and it felt easy, take an extra load step and cycle reps
          nextWeight = nextWeight + 1*INC;
          nextReps   = REP_MIN;
        }
      } else if (ratio >= 1.25){
        // Clear over-performance → emphasize reps first
        nextReps = Math.min(REP_MAX, planned + 2);
        if (rpe <= 8 && nextReps >= REP_MAX){
          nextWeight = nextWeight + 1*INC;
          nextReps   = REP_MIN;
        }
      } else {
        // Slight over → gentle nudge
        nextReps = Math.min(REP_MAX, planned + 1);
        if (rpe <= 8 && nextReps >= REP_MAX){
          nextWeight = nextWeight + 1*INC;
          nextReps   = REP_MIN;
        }
      }
    }
  }

  // Final clamps & rounding
  nextReps   = Math.max(REP_MIN, Math.min(REP_MAX, Math.round(nextReps)));
  nextWeight = Math.max(0, Math.round(nextWeight));

  return { weight: nextWeight, reps: nextReps };
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
  if ((state.page||'summary') === 'summary') {
    setTimeout(()=>{ try{ renderSummary(); }catch(_){}} , 0);
  }
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
  const wrap = document.getElementById('summaryContent');
  if (!wrap) return;

  const uid   = state.userId || 'u_camp';
  const per   = state.period || 'week';
  const st    = (function(){ try{ return streakForUser(uid); }catch(_){ return {current:0,best:0,perfectWeeks:0,thisWeekSessions:0}; } })();
  const consWeeks   = st.current;
  const coupleWeeks = (function(){ try{ return coupleStreak(); }catch(_){ return 0; } })();
  const _counts     = (function(){ try{ return sessionAndWorkoutCounts(per, uid); }catch(_){ return {sessions:0,workouts:0}; } })();
  const sessionCnt  = _counts.sessions;
  const workoutCnt  = _counts.workouts;
  const thisWeekSessions = st.thisWeekSessions || 0;

  // --- PR helpers (best weight + optional bar weight add) ---
  function _fmtMDY2(ymd){
    if(!ymd) return '—';
    const d = new Date(ymd+'T12:00:00');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}-${dd}-${yy}`;
  }
  function bestWeightFor(exId, add){
    let best = -Infinity, bestDate = '';
    for (const l of (state.logs||[])){
      if ((l.user_id||'u_camp')!==uid) continue;
      if (l.exercise_id!==exId) continue;
      const w = Number(l.weight_lb||0) + (add||0);
      const ymd = _localYMDFromLog(l);
      if (!ymd) continue;
      if (w > best || (w===best && ymd > bestDate)){
        best = w; bestDate = ymd;
      }
    }
    if (!Number.isFinite(best) || best<0) return { w:null, date:null };
    return { w: Math.round(best), date: bestDate };
  }
  function bestRepsFor(exId){
    let best = -Infinity, bestDate = '';
    for (const l of (state.logs||[])){
      if ((l.user_id||'u_camp')!==uid) continue;
      if (l.exercise_id!==exId) continue;
      const reps = Math.max(Number(l.fail_reps||0), Number(l.planned_reps||0));
      const ymd  = _localYMDFromLog(l);
      if (!ymd) continue;
      if (reps > best || (reps===best && ymd > bestDate)){
        best = reps; bestDate = ymd;
      }
    }
    if (!Number.isFinite(best) || best<0) return { val:null, date:null };
    return { val: Math.round(best), date: bestDate };
  }
  // Define the four PRs (IDs and any bar add), mode-aware, per instructions
  const PRS = [
    // Pull-Up: reps only
    { id: '0039_pull-up-v2', label: 'Pull-Up', mode: 'reps', unit: 'reps' },
    // Bench Press: +20 lb, label as Bench
    { id: '0003_bench-press', label: 'Bench', mode: 'weight', unit: 'lb', add: 20 },
    // Curl (replace RDL), PR = weight / 2, label as Curl
    { id: '0002_behind-body-cable-curl', label: 'Curl', mode: 'custom', unit: 'lb' },
    // Squat: +20 lb, label as Squat
    { id: '0001_back-squat', label: 'Squat', mode: 'weight', unit: 'lb', add: 20 },
  ];
  const prVals = PRS.map(def => {
    if (def.mode === 'reps') {
      const r = bestRepsFor(def.id);
      return { ...def, ...r };
    } else if (def.mode === 'weight') {
      const r = bestWeightFor(def.id, def.add || 0);
      return { ...def, val: (r && r.w != null ? r.w : null), date: r.date || null };
    } else if (def.mode === 'custom' && def.id === '0002_behind-body-cable-curl') {
      // For Curl, PR = max(weight_lb / 2), show rounded integer
      let best = -Infinity, bestDate = '';
      for (const l of (state.logs||[])) {
        if ((l.user_id||'u_camp')!==uid) continue;
        if (l.exercise_id!==def.id) continue;
        const w = Number(l.weight_lb||0) / 2;
        const ymd = _localYMDFromLog(l);
        if (!ymd) continue;
        if (w > best || (w === best && ymd > bestDate)) {
          best = w; bestDate = ymd;
        }
      }
      if (!Number.isFinite(best) || best < 0) return { ...def, val: null, date: null };
      return { ...def, val: Math.round(best), date: bestDate };
    } else {
      return { ...def, val: null, date: null };
    }
  });

  // Build week dots for "This Week"
  const weekFlags = (function(){ try{ return daysThisWeekFlags(); }catch(_){ return {count:0, flags:new Array(7).fill(false)}; } })();
  const dotsHTML = weekFlags.flags.map(f =>
    `<span class="wk" style="width:11px;height:11px;border-radius:4px;display:inline-block;border:1px solid var(--accent);${f?'background:var(--accent);':''}"></span>`
  ).join('<span style="width:3px;display:inline-block;"></span>');

  // Fresh scaffold
  wrap.innerHTML = `
    <div class="summary-grid">
      <!-- Row 1: Streaks (quad) + Metrics Box -->
      <div>
        <div class="summary-box-header">Streaks</div>
        <div class="summary-card quad">
          <div class="quad"><div class="label">Current Streak</div><div class="value" data-metric="cons">${consWeeks}</div></div>
          <div class="quad"><div class="label">Duo Counter</div><div class="value" data-metric="couple">${coupleWeeks}</div></div>
          <div class="quad"><div class="label">Longest Streak</div><div class="value" data-metric="best">${st.best}</div></div>
          <div class="quad"><div class="label">Perfect Weeks</div><div class="value" data-metric="perfect">${st.perfectWeeks}</div></div>
        </div>
      </div>

      <div>
        <div class="summary-box-header">Metrics</div>
        <div class="summary-card default">
          <div class="summary-stats">
            <!-- Chunk: This Week -->
            <div class="chunk">
              <div class="chunk-title"><strong>This Week</strong></div>
              <!-- Use padding-top instead of margin-top to avoid collapsing with preceding title -->
              <div class="week-cubes" style="margin-top:0; padding-top:8px; display:flex; gap:1px; align-items:center;">
                ${dotsHTML}
              </div>
            </div>

            <!-- Chunk: Totals (no gap between lines) -->
            <div class="chunk" style="margin-top:1px;">
              <div class="chunk-title"><strong>Total</strong></div>
              <div class="kv-lines" style="margin-top:3px; display:grid; row-gap:0;">
                <div class="line" style="margin:0;padding:0;">Sessions: <span class="accent" style="color:var(--accent)">${sessionCnt}</span></div>
                <div class="line" style="margin:0;padding:0;">Workouts: <span class="accent" style="color:var(--accent)">${workoutCnt}</span></div>
              </div>
            </div>

            <!-- Chunk: Personal Records (date right-aligned) -->
            <div class="chunk" style="margin-top:6px;">
              <div class="chunk-title"><strong>Personal Records</strong></div>
              <div class="pr-list" style="margin-top:3px; display:grid; row-gap:1px;">
                ${prVals.map(p => `
                  <div class="pr-row" style="display:flex; gap:8px; align-items:baseline;">
                    <span class="pr-label">${p.label}: <span class="accent" style="color:var(--accent)">${p.val!=null ? `${p.val} ${p.unit}` : '—'}</span></span>
                    <span class="pr-date" style="margin-left:auto; opacity:.6;">${p.date ? _fmtMDY2(p.date) : '—'}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      
      <!-- Row 3: Heat Maps -->
      <div>
        <div class="summary-box-header">Front Heat Map</div>
        <div class="summary-card default"><div class="summary-stats"><div id="hmFrontBox"></div></div></div>
      </div>
      <div>
        <div class="summary-box-header">Back Heat Map</div>
        <div class="summary-card default"><div class="summary-stats"><div id="hmBackBox"></div></div></div>
      </div>

      <!-- Row 4: Muscle Focus (full width) -->
<div class="row-wide">
  <div class="summary-box-header">Muscle Focus</div>
  <div class="summary-card wide"><div class="summary-stats"><div id="muscleBarsBox"></div></div></div>
</div>



<!-- Row 2: Recent Workouts (full width) -->
      <div class="row-wide">
        <div class="summary-box-header">Recent Workouts</div>
        <div class="summary-card wide">
          <div class="summary-stats">
            <!-- Recent Workouts Box -->
            <div id="recentWorkoutsBox"></div>
          </div>
        </div>
      </div>





    </div>`;





  // Render Muscle Focus bars now that the DOM node exists
  (function(){
    const mbarBox = document.getElementById('muscleBarsBox');
    if (!mbarBox) return;
    try {
      renderMuscleBars(mbarBox);
    } catch (err) {
      console.warn('renderMuscleBars deferred render failed; retrying...', err);
      setTimeout(() => { try { renderMuscleBars(mbarBox); } catch(_) {} }, 0);
    }
  })();

  // Enforce breathing room above "This Week" cubes (avoid margin-collapsing)
  try {
    const wc = wrap.querySelector('.week-cubes');
    if (wc) {
      wc.style.setProperty('margin-top','0','important');
      wc.style.setProperty('padding-top','8px','important');
    }
  } catch(_) {}

  // Flag "streak at risk" (keep number, tint yellow) if this week < 3 sessions
  try {
    const consEl = wrap.querySelector('.value[data-metric="cons"]');
    if (consEl) {
      if (thisWeekSessions < 3 && consWeeks > 0) {
        consEl.style.color = 'var(--warn, #F6C453)'; // yellow-ish; falls back if --warn is not defined
        consEl.setAttribute('title', 'Streak at risk — ' + thisWeekSessions + '/3 this week');
        consEl.dataset.pending = '1';
      } else {
        consEl.style.removeProperty('color');
        consEl.removeAttribute('data-pending');
        consEl.removeAttribute('title');
      }
    }
  } catch (_) {}

  // Ensure full-width rows span both columns
  wrap.querySelectorAll('.row-wide').forEach(node=>{ try{ node.style.gridColumn = '1 / -1'; } catch(_) {} });

  // ==== Render Recent Workouts in the wide box ====
  const recentBox = document.querySelector("#recentWorkoutsBox");
  if (recentBox) {
    renderRecentWorkouts(recentBox, state.logs || []);
  }

  // Render muscle atlas (ensure assets loaded before rendering)
  try {
    // Load atlas assets from inline script tags if globals not set
    if (typeof ensureAtlasAssets === 'function') ensureAtlasAssets();
    const frontC = document.getElementById('hmFrontBox');
    const backC  = document.getElementById('hmBackBox');
    if (frontC || backC) {
      renderMuscleAtlas(frontC, backC);
    }
  } catch(_) {}
  // Ensure edge-to-edge sizing on phones (JS-side, without touching global CSS)
  ensureAtlasMobileBleed();
  // Keep it correct on orientation/resize
  (function(){
    if (window.__atlasBleedBound) return;
    window.__atlasBleedBound = true;
    window.addEventListener('resize', ensureAtlasMobileBleed, { passive:true });
    window.addEventListener('orientationchange', ensureAtlasMobileBleed, { passive:true });
  })();
};



// ==== Muscle Focus Bars (sideways) ====
function ensureMuscleBarsStyles(){
  let s = document.getElementById('muscle-bars-styles');
  if (!s){
    s = document.createElement('style');
    s.id = 'muscle-bars-styles';
    document.head.appendChild(s);
  }
  s.textContent = `
    .mbar-wrap{ width:100%; }
    .mbar-table{ width:100%; }
    .mbar-row{
      display:grid;
      grid-template-columns: 66px 1fr 19px; /* name | bar | value */
      align-items:center;
      gap:8px;
      padding:2px 0;
    }
    .mbar-name{ text-align:left; font-weight:400; opacity:1; transition:opacity .25s ease; }
    .mbar-val{ text-align:right; font-variant-numeric: tabular-nums; opacity:1; transition:opacity .25s ease; }
    .mbar-track{
      position:relative;
      width:100%;
      height:2px;
      border-radius:7px;
      background: rgba(255,255,255,.06);
      overflow:hidden;
    }
    .mbar-fill{
      position:absolute; inset:0 auto 0 0;
      width:0%;
      height:100%;
      border-radius:7px;
      background: var(--accent);
      opacity:.9;
      transition: width .45s cubic-bezier(.2,.6,.2,1), background-color .2s ease, opacity .2s ease;
    }
    /* Threshold tinting (matches your heatmap logic): */
    .mbar-fill.warn{ background: var(--warn, #F6C453); opacity:.40; }
    .mbar-fill.danger{ background: var(--danger, #FF6B6B); opacity:.40; }
  `;
}

// Build + animate bars for the current period
function renderMuscleBars(container){
  if (!container) return;
  ensureMuscleBarsStyles();
  // Reset container early so you always see *something* even if there’s no data
  container.innerHTML = '<div class="mbar-wrap"><div class="mbar-table"></div></div>';
  const table = container.querySelector('.mbar-table');

  // points per muscle (Map) using your unified logic
  const per = state.period || 'week';
  const score = computeMuscleFocus(per);

  // Canonical list to guarantee rows for every muscle (even if 0 this period)
  const MUSCLE_CANON = [
    'Chest','Front Delt','Back Delt',
    'Biceps','Triceps','Forearms',
    'Core',
    'Upper Back','Lower Back','Traps',
    'Glutes','Quads','Hamstrings','Calves'
  ];

  // Build entries from the canonical list, falling back to 0 when missing
  let muscleEntries = MUSCLE_CANON.map(name => ({
    name,
    val: Number((score && score.get && score.get(name)) || 0)
  }));

  // If there are any muscles present in the score map that are not in the
  // canonical list (e.g., new aliases), include them at the end.
  try {
    const known = new Set(MUSCLE_CANON);
    for (const [name, v] of (score ? score.entries() : [])) {
      if (!known.has(name)) {
        muscleEntries.push({ name, val: Number(v) || 0 });
        known.add(name);
      }
    }
  } catch (_) {}

  // Sort descending for display
  muscleEntries.sort((a, b) => b.val - a.val);

  // Empty state message if no data
  if (!muscleEntries.length) {
    table.innerHTML = '<div class="mbar-row" style="opacity:.6;">No data yet for this period.</div>';
    return;
  }

  // keep previous widths for smooth animation
  const cacheKey = '__mbarPrev';
  const prev = window[cacheKey] || {};

  // Ensure maxVal is sane to avoid divide-by-zero and NaN widths
  const maxVal = (muscleEntries.length && muscleEntries[0].val > 0) ? muscleEntries[0].val : 1;

  muscleEntries.forEach(r=>{
    const row = document.createElement('div');
    row.className = 'mbar-row';
    row.setAttribute('data-muscle', r.name);

    const name = document.createElement('div');
    name.className = 'mbar-name';
    name.textContent = r.name;

    const track = document.createElement('div');
    track.className = 'mbar-track';
    const fill = document.createElement('div');
    fill.className = 'mbar-fill';
    // ≤2 → red, ≤9 → yellow (else user color)
    if (r.val <= 2) fill.classList.add('danger');
    else if (r.val <= 9) fill.classList.add('warn');
    track.appendChild(fill);

    const val = document.createElement('div');
    val.className = 'mbar-val';
    val.textContent = String(Math.round(r.val));

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    table.appendChild(row);

    // Minimum width for zero values: 1%
    const barWidth = r.val > 0 ? (r.val / maxVal) * 100 : 1;
    // Animate width (almost to edge → 98% max for nonzero, else 1%)
    const newPct  = Math.max(0, Math.min(100, barWidth * .95));
    const prevPct = (prev[r.name] != null) ? prev[r.name] : 0;
    fill.style.width = prevPct + '%';
    // subtle fade for labels to signal resort
    name.style.opacity = '0';
    val .style.opacity = '0';
    requestAnimationFrame(()=>{
      fill.style.width = newPct + '%';
      name.style.opacity = '1';
      val .style.opacity = '1';
    });
    prev[r.name] = newPct;
  });

  window[cacheKey] = prev;
  try { console.debug('✅ Muscle Focus rendered:', muscleEntries.length, 'rows'); } catch(_) {}
}



// ==== Recent Workouts Table ====
function ensureRecentTableStyles(){
  // Always (re)write the styles so later tweaks actually take effect
  const css = `
    /* width + alignment */
    .recent-workouts-table{ width:100%; border-collapse:collapse; border-spacing:0; }
    .recent-workouts-table thead th{ font-weight:600; }
    .recent-workouts-table th, .recent-workouts-table td{
      text-align:center;
      padding:2px 8px;   /* tighter vertical padding */
      line-height:1.1;   /* tighter line-height */
    }
    .recent-workouts-table tr{ height:auto; }
    .recent-workouts-table thead th{ padding-bottom:6px; }

    .recent-workouts-table th.left, .recent-workouts-table td:first-child{ text-align:left; }
    /* last column hugs right edge */
    .recent-workouts-table td:last-child{ text-align:right; padding-right:2px; }

    /* symbols & delete button */
    .recent-workouts-table td .sym{ display:inline-block; }
    .recent-workouts-table .delete-btn{ color:#5b5b5b; }
    .recent-workouts-table .delete-btn:hover{ color:#8a8a8a; }

    /* center headers except the first */
    .recent-workouts-table thead th:not(.left){ text-align:center; }
  `;
  let s = document.getElementById('recent-table-styles');
  if (!s) { s = document.createElement('style'); s.id = 'recent-table-styles'; document.head.appendChild(s); }
  s.textContent = css; // update even if it already exists
}

function renderRecentWorkouts(container, workouts) {
  const uid = state.userId || 'u_camp';

  // Helper to parse a Date from mixed inputs
  const ts = (l) => {
    if (l.timestamp) return new Date(l.timestamp);
    if (l.date) return new Date(String(l.date).includes('T') ? l.date : (l.date + 'T12:00:00'));
    return new Date(0);
  };

  // Most recent 10 logs for the current user
  const rows = (workouts || [])
    .filter(l => (l.user_id || 'u_camp') === uid)
    .slice()
    .sort((a, b) => ts(b) - ts(a))
    .slice(0, 10);

  container.innerHTML = `
    <div class="recent-grid recent-header">
      <div class="col name">Workout</div>
      <div class="col weight">Weight</div>
      <div class="col reps">Reps</div>
      <div class="col status">Status</div>
      <div class="col action"></div>
    </div>
    <div class="recent-list"></div>
  `;

  // Inject table with column sizing via <colgroup>
  container.innerHTML = `
    <table class="recent-workouts-table align-centered">
      <colgroup>
        <col style="width:55%">  
        <col style="width:12%">
        <col style="width:12%">
        <col style="width:11%">
        <col style="width:10%">
      </colgroup>
      <thead>
        <tr>
          <th class="left">Workout</th>
          <th>Weight</th>
          <th>Reps</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const table = container.querySelector('table');
  ensureRecentTableStyles();
  const tbody = table.querySelector('tbody');
  window.__recentRows = rows;
  rows.forEach((l, i) => {
    const ex = (state.byId && state.byId[l.exercise_id]) || {};
    const name = ex.name || l.name || '—';
    const variation = ex.variation || l.variation || '';
    const nameHTML = `${name}${variation ? ' • ' + variation : ''}`;
    const weight = (l.weight_lb != null) ? Math.round(l.weight_lb) : (l.weight != null ? l.weight : '—');
    const repsAch = Number(l.fail_reps ?? l.planned_reps ?? 0);
    const repsPlan = Number(l.planned_reps ?? 0);
    const statusClass = (repsAch > repsPlan) ? 'up' : (repsAch < repsPlan ? 'down' : 'even');
    // Use figure dash for neutral (shorter than en dash)
    const symbol = statusClass === 'up' ? '▲' : statusClass === 'down' ? '▼' : '‒'; // shorter dash
    const tr = document.createElement('tr');
    tr.setAttribute('data-idx', String(i));
    tr.className = statusClass;
    tr.innerHTML = `
      <td><span class="ellipsis">${nameHTML}</span></td>
      <td>${weight}</td>
      <td>${repsAch || '—'}</td>
      <td><span class="sym">${symbol}</span></td>
      <td><button class="delete-btn" title="Remove">×</button></td>
    `;
    tbody.appendChild(tr);
    // Font weights
    tr.querySelectorAll('td').forEach(c => c.style.fontWeight = '400');
    // Truncate workout name
    const ell = tr.querySelector('.ellipsis');
    ell.style.display = 'inline-block';
    ell.style.maxWidth = '100%';
    ell.style.whiteSpace = 'nowrap';
    ell.style.overflow = 'hidden';
    ell.style.textOverflow = 'ellipsis';
    // Colorize symbol
    const sym = tr.querySelector('.sym');
    if (statusClass === 'up') {
      sym.style.color = 'var(--accent)';
    } else if (statusClass === 'down') {
      sym.style.color = 'var(--danger, #f66)';
      sym.style.opacity = '0.9';
    } else {
      sym.style.opacity = '0.5';
    }
    // Minimalist delete "×" button style
    const del = tr.querySelector('.delete-btn');
    const lastTd = tr.querySelector('td:last-child');
    if (lastTd) {
      lastTd.style.textAlign = 'right';
      lastTd.style.paddingRight = '2px';
    }
    if (del) {
      del.style.background = 'none';
      del.style.border = 'none';
      del.style.padding = '0';
      del.style.margin = '0';
      del.style.fontSize = '18px';
      del.style.lineHeight = '1';
      del.style.opacity = '.55';
      del.style.cursor = 'pointer';
      del.style.color = '#5b5b5b';
      del.onmouseenter = () => del.style.opacity = '.9';
      del.onmouseleave = () => del.style.opacity = '.55';
    }
    // (Delete handler is now delegated)
  });
  ensureRecentDeleteHandler();
}

// Delegated delete handler for Recent Workouts table (robust across re-renders)
function ensureRecentDeleteHandler(){
  if (document.__recentDeleteBound) return;
  document.__recentDeleteBound = true;

  document.addEventListener('click', async function(e){
    const btn = e.target && e.target.closest('.recent-workouts-table .delete-btn');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    // Resolve the row/log data from the global cache populated by renderRecentWorkouts
    const tr = btn.closest('tr');
    const idx = tr ? Number(tr.getAttribute('data-idx') || -1) : -1;
    const rows = window.__recentRows || [];
    const l = (idx >= 0 && idx < rows.length) ? rows[idx] : null;
    if (!l) { alert('Delete failed: row not found.'); return; }

    const ex = (state.byId && state.byId[l.exercise_id]) || {};
    const labelText = (ex.name || l.name || 'Workout') + (ex.variation || l.variation ? ' • ' + (ex.variation || l.variation) : '');
    const whenYMD = (typeof _localYMDFromLog === 'function') ? _localYMDFromLog(l) : '';
    const whenStr = (whenYMD ? (function(d){ const mm = d.slice(5,7), dd = d.slice(8,10), yy = d.slice(2,4); return mm+'-'+dd+'-'+yy; })(whenYMD) : '');

    const ok = confirm(`Delete this log entry?\n${labelText}${whenStr ? ' — ' + whenStr : ''}`);
    if (!ok) return;

    // Prefer unique row id if present
    const rowUid = l.row_uid || l.rowUid || l.rowid || l.rowId || null;

    const payload = rowUid ? {
      action: 'deleteLog',
      row_uid: rowUid
    } : {
      action: 'deleteLog',
      user_id: l.user_id || (state.userId || 'u_camp'),
      exercise_id: l.exercise_id || null,
      side: l.side || null,
      date: whenYMD || (l.date || null)
    };

    const original = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;

    let okDelete = false, lastErr = null;
    try{
      const res = await apiPost('deleteLog', payload);
      if (res && !res.error) {
        okDelete = true;
      } else {
        lastErr = res && res.error;
      }
    } catch(err){
      lastErr = String(err);
    }

    if (okDelete) {
      // Remove row from UI and refresh cache/UI
      if (tr) tr.remove();
      try { await fetchAll(); } catch(_){}
      toast('Deleted.');
    } else {
      alert('Delete failed' + (lastErr ? (': ' + lastErr) : '.'));
    }

    btn.textContent = original;
    btn.disabled = false;
  }, true);
}

    