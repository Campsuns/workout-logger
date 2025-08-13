// ==== CONFIG – paste your Apps Script Web App URL + token ====
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzQmuBTqcODPLJc2U1GhIgKEK_xaa0buIdC55mIWv1hg7QoXwyxe36tMNfjyl3HIWFKew/exec',
  TOKEN: 'n7V6p3kFQw9zL1r8U2y4T0bC5mA7',
  WEEK_START: 1,
  REP_MIN: 6,
  REP_MAX: 12,
  DEFAULT_INC_LB: 5,
  DONE_TTL_HOURS: 8
};
let state = { exercises: [], splits: [], logs: [], byId: {}, currentSplit: '', period: 'week', eq: '', mg: '', page: 'list' };
const store = { get(){ try { return JSON.parse(localStorage.getItem('uiState')||'{}'); } catch{ return {}; } }, set(part){ const cur = store.get(); localStorage.setItem('uiState', JSON.stringify({...cur, ...part})); } };
setInterval(()=>{ if(document.visibilityState==='visible') fetchAll(); }, 10*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') fetchAll(); });
const $ = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));
const flash = ()=>{ const f=$('#flash'); if(!f) return; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); };
const toast = (msg)=>{ const t=$('#toast'); t.textContent=msg; t.hidden=false; setTimeout(()=>t.hidden=true, 1800); };

function equipDisplay(lbl){
  const s = String(lbl || '').trim();
  if(!s) return 'Other';
  return s
    .replace(/\b\w/g, c => c.toUpperCase())    // title case
    .replace(/\bEz\b/g,'EZ')
    .replace(/\bV Bar\b/g,'V-Bar');
}

function fmt(num){ return Number(num||0).toFixed(0); }
function today(){ const d=new Date(); return d.toISOString().slice(0,10); }
function startOfPeriod(period){ const d=new Date(); if(period==='week'){ const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; } if(period==='month'){ return new Date(d.getFullYear(), d.getMonth(), 1); } if(period==='year'){ return new Date(d.getFullYear(), 0, 1); } }
function inPeriod(dt, p){ const s=startOfPeriod(p); return new Date(dt) >= s; }
function e1rm(weight, reps){ return Number(weight)*(1+Number(reps)/30); }
function musclesOf(e){ return [e.primary, e.secondary, e.tertiary].filter(Boolean); }
function uniqueMuscles(list){ return [...new Set(list.flatMap(musclesOf).filter(Boolean))].sort(); }
function markDone(exId){ const map = JSON.parse(localStorage.getItem('doneMap')||'{}'); map[exId] = Date.now(); localStorage.setItem('doneMap', JSON.stringify(map)); }
function isDone(exId){ const map = JSON.parse(localStorage.getItem('doneMap')||'{}'); const ts = map[exId]; if(!ts) return false; const ageH = (Date.now()-ts)/(1000*60*60); return ageH < CONFIG.DONE_TTL_HOURS; }

function latestFor(exId, side){
  const want = String(side || 'both').toLowerCase();
  const logs = state.logs.filter(l => l.exercise_id === exId);
  if (!logs.length) return null;

  const norm = x => String(x || 'both').toLowerCase();
  const bySide = logs.filter(l => norm(l.side) === want);

  const arr = bySide.length ? bySide : logs; // fallback: any side
  arr.sort((a,b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
  return arr[0] || null;
}

function chooseSide(exId){ const s = JSON.parse(localStorage.getItem('lastSide')||'{}'); return s[exId] || 'both'; }
function saveSide(exId, side){ const s = JSON.parse(localStorage.getItem('lastSide')||'{}'); s[exId]=side; localStorage.setItem('lastSide', JSON.stringify(s)); }
function suggestNext(exId, side){ const ex = state.byId[exId]; if(!ex) return {weight:0, reps:8, sets:3, height:0}; const last = latestFor(exId, side) || latestFor(exId, 'both') || latestFor(exId, null); const inc = Number(ex.increment_lb||CONFIG.DEFAULT_INC_LB||5); const minr=CONFIG.REP_MIN, maxr=CONFIG.REP_MAX; let nextW = Number(last?.weight_lb || ex.default_weight || 0); let nextR = Number(last?.planned_reps || Math.max(minr,8)); const fail = (last?.fail_reps!=null && last?.fail_reps!=='') ? Number(last.fail_reps) : null; const rpe = Number(last?.rpe_set2 || 8); if(fail!==null){ if(fail >= nextR && rpe <= 8){ nextR = nextR + 1; if(nextR > maxr){ nextW += inc; nextR = 8; } } else if(fail < nextR - 1 || rpe >= 9){ if(nextR > minr){ nextR = Math.max(minr, Math.min(fail || nextR-1, nextR-1)); } else { nextW = Math.max(0, nextW - inc); nextR = Math.max(minr, 8); } } } else { if(rpe <= 7.5){ nextR = Math.min(maxr, nextR+1); if(nextR>maxr){ nextW+=inc; nextR=8; } } else if(rpe >= 9){ nextR = Math.max(minr, nextR-1); } } return {weight: Math.max(0, Math.round(nextW)), reps: nextR, sets: Number(ex.sets||3), height: Number(last?.height || ex.default_height || 0)}; }
function rankImprovements(period){ const logs = state.logs.filter(l=>inPeriod(l.date||l.timestamp, period)); const byEx = new Map(); for(const l of logs){ const t = new Date(l.timestamp||l.date); const v = e1rm(l.weight_lb||0, l.planned_reps||0); const a = byEx.get(l.exercise_id)||[]; a.push({t,v}); byEx.set(l.exercise_id,a); } const out=[]; const now=new Date(); const start=startOfPeriod(period); for(const [ex, arr] of byEx.entries()){ arr.sort((a,b)=>a.t-b.t); const startVal = (arr.find(x=>x.t>=start)||arr[0]||{}).v||0; const endVal = (arr.filter(x=>x.t<=now).slice(-1)[0]||{}).v||0; out.push({exercise_id: ex, delta: endVal-startVal}); } out.sort((a,b)=>b.delta-a.delta); return out; }
function streaks(logs){ const map = new Map(); for(const l of logs){ const d = new Date(l.date||l.timestamp); const monday = new Date(d); const day=(d.getDay()+6)%7; monday.setDate(d.getDate()-day); monday.setHours(0,0,0,0); const key = monday.toISOString().slice(0,10); const dayKey = d.toDateString(); if(!map.has(key)) map.set(key, new Set()); map.get(key).add(dayKey); } const weeks = [...map.entries()].map(([wk, days])=>({week:wk, sessions: days.size})).sort((a,b)=>a.week.localeCompare(b.week)); let cur=0,best=0,perfect=0; for(const w of weeks){ if(w.sessions>=3){cur++; best=Math.max(best,cur);} else cur=0; if(w.sessions>=5) perfect++; } return {current: cur, best, perfectWeeks: perfect}; }
async function apiGet(params){ const url = new URL(CONFIG.API_URL); Object.entries({token: CONFIG.TOKEN, ...params}).forEach(([k,v])=>url.searchParams.set(k,v)); const res = await fetch(url, { method:'GET' }); return res.json(); }
async function apiPost(action, payload){ const url = new URL(CONFIG.API_URL); url.searchParams.set('action', action); url.searchParams.set('token', CONFIG.TOKEN); const res = await fetch(url, { method:'POST', body: JSON.stringify(payload) }); return res.json(); }
async function fetchAll(){ const data = await apiGet({action:'getAll'}); if(data.error){ console.error(data.error); toast('API error: '+data.error); return; } state.exercises = data.exercises||[]; state.splits = data.splits||[]; state.logs = data.logs||[]; state.byId = Object.fromEntries(state.exercises.map(e=>[e.id, e])); renderFilters(); renderList(); renderSummary(); }
$$('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>{ $$('[data-nav]').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); $$('.page').forEach(p=>p.classList.remove('active')); const page = btn.dataset.nav; state.page = page; store.set({page}); $('#page-'+page).classList.add('active'); }));
(function restoreUI(){ const s = store.get(); if(s.page){ state.page = s.page; $$('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===s.page)); $$('.page').forEach(p=>p.classList.remove('active')); $('#page-'+s.page).classList.add('active'); } if(s.period){ state.period=s.period; $$('.period-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.period===s.period)); } if(s.split){ state.currentSplit=s.split; } if(s.eq!==undefined){ state.eq=s.eq; } if(s.mg!==undefined){ state.mg=s.mg; } })();
$$('.period-tabs button').forEach(btn=>btn.addEventListener('click',()=>{ $$('.period-tabs button').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); state.period = btn.dataset.period; store.set({period: state.period}); renderSummary(); }));

function renderFilters(){
  const splitSel = $('#splitSelect');
  const splits = [...new Set(state.splits.map(s=>String(s.split_name||'').trim()))].filter(Boolean);
  splitSel.innerHTML = `<option value="">All</option>` + splits.map(s=>`<option>${s}</option>`).join('');
  splitSel.value = state.currentSplit||'';
  splitSel.onchange = ()=>{ state.currentSplit = splitSel.value; store.set({split: state.currentSplit}); renderList(); };

  // Equipment: keep the value lowercase for filtering, show Title Case in the UI
  const equipmentsRaw = [...new Set(state.exercises
    .map(e=>String(e.equipment||'').trim())
    .filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b));

  const equipmentOptions = equipmentsRaw.map(lbl=>{
    const val = lbl.toLowerCase();
    // Simple title case for display (preserve things like EZ/V-Bar if they’re already capitalized in the sheet)
    const display = lbl.replace(/\b\w/g, c=>c.toUpperCase()).replace(/\bEz\b/g,'EZ').replace(/\bV Bar\b/g,'V-Bar');
    return { value: val, label: display };
  });

  $('#equipmentFilter').innerHTML = `<option value="">Equipment</option>` +
    equipmentOptions.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');

  // Muscles: already Title Case in the sheet; use as-is for labels and filtering
  const muscles = uniqueMuscles(state.exercises);
  $('#muscleFilter').innerHTML = `<option value="">Muscle</option>` + muscles.map(x=>`<option>${x}</option>`).join('');

  // Restore persisted selection
  $('#equipmentFilter').value = state.eq||'';
  $('#muscleFilter').value = state.mg||'';

  $('#equipmentFilter').onchange = ()=>{
    state.eq = $('#equipmentFilter').value;
    store.set({eq: state.eq});
    renderList();
  };
  $('#muscleFilter').onchange = ()=>{
    state.mg = $('#muscleFilter').value;
    store.set({mg: state.mg});
    renderList();
  };

  $('#btnAddExercise').onclick = ()=> openAddWizard();
  $('#btnResetDone').onclick = ()=>{ localStorage.removeItem('doneMap'); renderList(); toast('Highlights reset'); };
}

function makeCardHTML(e){
  const sugg = suggestNext(e.id, chooseSide(e.id));
  const variation = e.variation ? `<span class="variation">• ${e.variation}</span>` : '';
  const equip = e.equipment ? e.equipment : '';
  const h = Number(e.default_height || 0);
  const setupLine = [equip, (h>0 ? `Height ${fmt(h)}` : '')].filter(Boolean).join(' • ');
  const done = isDone(e.id);

  // Left: 3 lines (name+variation, equipment+default height, weight)
  // Right pill: reps × sets
  return `
  <div class="card ${done?'done':''}" data-id="${e.id}">
    <div class="left">
      <div class="name-line">
        <span class="name">${e.name}</span>${variation}
      </div>
      <div class="meta line">${setupLine || '&nbsp;'}</div>
      <div class="weight line">${fmt(sugg.weight)} lb</div>
    </div>
    <div class="pill repsets" aria-label="Reps × Sets">${fmt(sugg.reps)} × ${fmt(sugg.sets)}</div>
  </div>`;
}

function renderList(){
  const eqVal = (state.eq||'').toLowerCase();
  const mgVal = state.mg||'';

  const wrapSel   = $('#selectedSplitWrap');
  const listSel   = $('#selectedSplitList');
  const otherTitle= $('#otherTitle');
  const otherList = $('#workoutList');

  // Start from all exercises
  let items = state.exercises.slice();

  // Equipment filter (compare lowercase)
  if(eqVal) items = items.filter(e=>String(e.equipment||'').toLowerCase() === eqVal);

  // Muscle filter (exact match on Title Case label)
  if(mgVal) items = items.filter(e=>musclesOf(e).includes(mgVal));

  // Helper: render groups by equipment
  const groupByEquipment = (arr) => {
    const map = new Map();
    for(const e of arr){
      const key = equipDisplay(e.equipment || '');
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    const keys = [...map.keys()].sort((a,b)=>a.localeCompare(b));
    return keys.map(k => `
      <div class="subgroup">
        <div class="group-title">${k}</div>
        <div class="cards">
          ${map.get(k).map(makeCardHTML).join('')}
        </div>
      </div>
    `).join('');
  };

  // With a selected split: keep the split section at top
  if(state.currentSplit){
    const splitRows = state.splits
      .filter(s=>String(s.split_name||'')===state.currentSplit)
      .sort((a,b)=>Number(a.order||0)-Number(b.order||0));
    const splitIds = splitRows.map(r=>r.exercise_id);

    const top  = splitIds.map(id=>items.find(e=>e.id===id)).filter(Boolean);
    const rest = items.filter(e=>!splitIds.includes(e.id));

    // Selected split section
    wrapSel.hidden = false;
    listSel.innerHTML = top.map(makeCardHTML).join('');

    // Others: if NO filters, group by equipment; otherwise flat list
    if(!eqVal && !mgVal){
      otherTitle.hidden = false;
      otherList.innerHTML = groupByEquipment(rest);
    } else {
      otherTitle.hidden = false;
      otherList.innerHTML = rest.map(makeCardHTML).join('');
    }
  } else {
    // No split selected
    wrapSel.hidden = true;
    otherTitle.hidden = true;

    // If NO filters, group all items by equipment; otherwise flat list
    if(!eqVal && !mgVal){
      otherList.innerHTML = groupByEquipment(items);
    } else {
      otherList.innerHTML = items.map(makeCardHTML).join('');
    }
  }

  // Click handlers
  $$('#workoutList .card, #selectedSplitList .card').forEach(c=>{
    c.addEventListener('click',()=>openLog(c.dataset.id));
  });

  // Empty state hint
  if(!items.length){
    otherList.innerHTML = `<div class="meta" style="padding:8px 4px;">No exercises match the current filters.</div>`;
  }
}


let modal, stepVals, curEx;
function openLog(exId){ curEx = state.byId[exId]; if(!curEx) return; modal = $('#logModal'); $('#logTitle').textContent = curEx.name; $('#logSub').textContent = [curEx.variation, musclesOf(curEx).join('/'), curEx.equipment].filter(Boolean).join(' • '); const side = chooseSide(exId); $$('#sideSeg button').forEach(b=>b.classList.toggle('active', b.dataset.side===side)); const sugg = suggestNext(exId, side); stepVals = { side, sets_done: Number(curEx.sets||3), planned_reps: sugg.reps||8, weight_lb: sugg.weight||0, height: sugg.height||0, fail_reps: Math.max(CONFIG.REP_MIN, sugg.reps||8), rpe_set2: 8 }; $$('.stack .stepper').forEach(bindStepper); $$('#sideSeg button').forEach(b=>b.onclick = ()=>{ $$('#sideSeg button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); stepVals.side = b.dataset.side; saveSide(curEx.id, stepVals.side); const s2=suggestNext(curEx.id, stepVals.side); stepVals.weight_lb=s2.weight; stepVals.planned_reps=s2.reps; stepVals.height=s2.height; updateSteppers(); }); $('#logNotes').value = ''; modal.showModal(); }
function updateSteppers(){ $$('.stack .stepper').forEach(node=>{ const field=node.dataset.field; const span=$('span',node); if(field && span) span.textContent = fmt(stepVals[field]); }); }
function bindStepper(node){ const field = node.dataset.field; const span = $('span', node) || node; const up=$('.up', node), dn=$('.down', node); const render=()=>{ if(span) span.textContent = fmt(stepVals[field]); }; render(); if(up) up.onclick=()=>{ stepVals[field] = Number(stepVals[field]||0) + (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1); render(); }; if(dn) dn.onclick=()=>{ stepVals[field] = Math.max(0, Number(stepVals[field]||0) - (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1)); render(); }; }
$('#btnLog').addEventListener('click', async (e)=>{ e.preventDefault(); $('#btnLog').disabled = true; const payload = { timestamp: new Date().toISOString(), date: today(), exercise_id: curEx.id, side: stepVals.side || 'both', sets_done: Number(stepVals.sets_done), planned_reps: Number(stepVals.planned_reps), weight_lb: Number(stepVals.weight_lb), height: Number(stepVals.height||0), rpe_set2: Number(stepVals.rpe_set2), fail_reps: Number(stepVals.fail_reps), notes: $('#logNotes').value||'' }; try{ const res = await apiPost('addLog', payload); if(res && !res.error){ flash(); toast('Logged'); modal.close(); markDone(curEx.id); fetchAll(); } else { toast('Error: '+(res.error||'unknown')); } } catch(err){ toast('Network error'); } finally{ $('#btnLog').disabled = false; } });
function openAddWizard(){ const d = $('#addModal'); d.showModal(); const steps = $$('.wizard .q'); let i=0; function show(){ steps.forEach((q,idx)=>{ q.style.display = (idx===i)?'block':'none'; }); $('#wizPrev').style.visibility = (i===0?'hidden':'visible'); $('#wizNext').style.display = (i<steps.length-1?'inline-block':'none'); $('#wizSave').style.display = (i===steps.length-1?'inline-block':'none'); } show(); $('#wizPrev').onclick = ()=>{ i=Math.max(0,i-1); show(); }; $('#wizNext').onclick = ()=>{ i=Math.min(steps.length-1,i+1); show(); }; $('#wizSave').onclick = saveExercise; }
async function saveExercise(){ const id = 'ex_'+Math.random().toString(36).slice(2,8); const body = { id, name: $('#exName').value.trim(), variation: $('#exVar').value.trim(), primary: $('#exPri').value.trim(), secondary: $('#exSec').value.trim(), tertiary: $('#exTer').value.trim(), equipment: $('#exEq').value.trim().toLowerCase(), sets: Number($('#exSets').value||3), default_weight: Number($('#exW').value||0), default_height: Number($('#exH').value||0), increment_lb: $('#exInc').value.trim() }; if(!body.name){ alert('Name required'); return; } const res = await apiPost('addExercise', body); if(res && !res.error){ $('#addModal').close(); fetchAll(); toast('Exercise added'); } else alert('Error: '+(res.error||'unknown')); }
function renderSummary(){ const wrap = $('#summaryContent'); const period = state.period; const logs = state.logs.filter(l=>inPeriod(l.date||l.timestamp, period)); const weights = {primary:3, secondary:2, tertiary:1}; const score = new Map(); for(const l of logs){ const ex = state.byId[l.exercise_id]; if(!ex) continue; for(const [slot,w] of Object.entries(weights)){ const m = (ex[slot]||'').trim(); if(!m) continue; score.set(m, (score.get(m)||0) + w); } } const allMuscles = uniqueMuscles(state.exercises); allMuscles.forEach(m=>{ if(!score.has(m)) score.set(m,0); }); const ranked = [...score.entries()].sort((a,b)=>b[1]-a[1]); const muscles = ranked.slice(0,10); const neglected = ranked.slice(-5); const improved = rankImprovements(period).slice(0,5); const st = streaks(state.logs); wrap.innerHTML = `<div class="block"><h4 style="margin:0 0 6px">Streaks</h4><div>Current: <b>${st.current}</b> weeks</div><div>Best: <b>${st.best}</b> weeks</div><div>Perfect weeks: <b>${st.perfectWeeks}</b></div></div><div class="block"><h4 style="margin:0 0 6px">Muscle Focus (${period})</h4>${muscles.length? '<ol>'+muscles.map(([m,s])=>`<li>${m}: ${s}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}</div><div class="block"><h4 style="margin:0 0 6px">Most Neglected (${period})</h4>${neglected.length? '<ol>'+neglected.map(([m,s])=>`<li>${m}: ${s}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}</div><div class="block"><h4 style="margin:0 0 6px">Most Improved (${period})</h4>${improved.length? '<ol>'+improved.map(x=>`<li>${state.byId[x.exercise_id]?.name||x.exercise_id}: +${x.delta.toFixed(1)}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}</div>`; }
fetchAll();
