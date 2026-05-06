// Compares the merged BFF behaviour against Server_local.js's original contract.
const BASE = 'http://localhost:3000';
const tests = [];
const log = (label, ok, extra = '') => {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${extra ? ' — ' + extra : ''}`);
  tests.push(ok);
};

// 1) Health — confirms env keys are loaded
const h = await fetch(`${BASE}/api/health`).then(r => r.json());
log('health endpoint', h.status === 'ok');
log('CWA key loaded',          h.keys.cwa);
log('MOE key loaded',          h.keys.moe);
log('TDX credentials loaded',  h.keys.tdx);
log('OWM fallback key loaded', h.keys.owm);

// 2) /api/weather — must match Server_local.js's contract
const w = await fetch(
  `${BASE}/api/weather?lat=25.0497&lng=121.5180&city=Taipei&city_cwa=${encodeURIComponent('臺北市')}`
).then(r => r.json());
log('weather: temperature present', typeof w.temperature === 'number', `${w.temperature}°C`);
log('weather: tempRange present',   /\d+–\d+°C/.test(w.tempRange), w.tempRange);
log('weather: rainProb present',    /\d+%/.test(w.rainProb), w.rainProb);
log('weather: aqiLevel present',    typeof w.aqiLevel === 'string', w.aqiLevel);
log('weather: condCode present',    w.condCode != null, `code ${w.condCode}`);
log('weather: matrix description',  typeof w.description === 'string', `"${w.description}"`);

// 3) /api/tdx — scenic spots + youbike
const t = await fetch(`${BASE}/api/tdx?lat=25.0497608&lng=121.5179966`).then(r => r.json());
log('tdx: scenic_spots array', Array.isArray(t.scenic_spots), `${t.scenic_spots.length} spots`);
log('tdx: youbike array',      Array.isArray(t.youbike),      `${t.youbike.length} stations`);
if (t.scenic_spots[0]) {
  const s = t.scenic_spots[0];
  log('tdx spot has name_zh', !!s.name_zh, s.name_zh);
  log('tdx spot has name_en', 'name_en' in s);
  log('tdx spot has desc',    typeof s.desc === 'string');
  log('tdx spot has desc_zh (zh fallback preserved)', 'desc_zh' in s);
  // Translation contract: name_en is either translated OR equals name_zh (graceful fallback)
  const nameEnOk = s.name_en === s.name_zh || /[A-Za-z]/.test(s.name_en);
  log('tdx spot name_en valid (translated OR fallback)', nameEnOk,
      s.name_en === s.name_zh ? 'fallback to zh (LT unavailable)' : 'translated');
}
if (t.youbike[0]) {
  const b = t.youbike[0];
  log('tdx bike has name_display',  !!b.name_display, b.name_display.slice(0, 60) + '…');
  log('tdx bike has distance (m)',  typeof b.distance === 'number', `${b.distance}m`);
  log('tdx bike has rent count',    typeof b.available_rent === 'number',   `rent ${b.available_rent}`);
  log('tdx bike has return count',  typeof b.available_return === 'number', `dock ${b.available_return}`);
  const sorted = t.youbike.every((x, i, a) => i === 0 || a[i - 1].distance <= x.distance);
  log('tdx bike sorted by distance', sorted);
}

// 4) tdx error handling — Server_local.js returns 400 on missing coords
const errRes = await fetch(`${BASE}/api/tdx`);
log('tdx: 400 on missing coords', errRes.status === 400);

// 4b) /api/translate (MyMemory passthrough)
const tr = await fetch(`${BASE}/api/translate?q=${encodeURIComponent('台北')}`).then(r => r.json());
log('translate endpoint reachable', tr && 'translated' in tr);
log('translate has original', tr.original === '台北');
log('translate has fallback (translated === original OR translated)',
    tr.translated === '台北' || /[A-Za-z]/.test(tr.translated),
    tr.translated === tr.original ? 'fallback (MyMemory unavailable/quota)' : `→ ${tr.translated}`);
const trMissing = await fetch(`${BASE}/api/translate`);
log('translate: 400 when q missing', trMissing.status === 400);

// 5) /api/cafes still works (BFF own surface, kept from before merge)
const c = await fetch(`${BASE}/api/cafes`).then(r => r.json());
log('cafes endpoint still works', c.count > 0, `${c.count} cafés`);

const passed = tests.filter(Boolean).length;
console.log(`\n${passed}/${tests.length} checks passed`);
process.exit(passed === tests.length ? 0 : 1);
