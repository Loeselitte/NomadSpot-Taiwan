// NomadSpot Taiwan — BFF (Backend For Frontend)
// =============================================================================
// Aggregates the local cafés.json catalog with multi-source live data:
//   • Weather: Open-Meteo + CWA + MOE air quality (with OpenWeather fallback)
//   • TDX: nearby scenic spots + YouBike availability
// All upstreams are cached / wrapped in safeFetch() so the browser only ever
// talks to a single same-origin BFF.
// =============================================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// =============================================================================
// Constants & mappings
// =============================================================================

const AMENITY_LABELS = {
  wifi: 'Wifi',
  power_outlets: 'Power Outlet',
  restroom: 'Restroom',
  outdoor_seating: 'Outdoor Seating',
  good_for_groups: 'Good for Groups',
  reservable: 'Reservable',
  serves_meal: 'Serves Meals',
  no_time_limit: 'No Time Limit',
  quiet: 'Quiet',
};

const CITY_TO_TW = {
  Taipei: '臺北市',     'New Taipei': '新北市', Hualien: '花蓮縣',
  Taitung: '臺東縣',    Yilan: '宜蘭縣',         Tainan: '臺南市',
  Kaohsiung: '高雄市',  Pingtung: '屏東縣',      Taichung: '臺中市',
  Changhua: '彰化縣',   Nantou: '南投縣',        Yunlin: '雲林縣',
};

// =============================================================================
// Café catalog — load + normalize
// =============================================================================

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

function normalizeCafe(raw) {
  const lat = raw.coordinates?.lat ?? raw.lat;
  const lng = raw.coordinates?.lng ?? raw.lng;
  const facilities = raw.amenities
    ? Object.entries(raw.amenities).filter(([, v]) => v).map(([k]) => AMENITY_LABELS[k] || k)
    : (raw.facilities || []);
  const igHandle = raw.instagram_url
    ? raw.instagram_url.replace(/\/+$/, '').split('/').filter(Boolean).pop()
    : (raw.instagram || null);
  const seed = `${raw.id}-${slugify(raw.name)}`;
  const thumbnail = raw.thumbnail || `https://picsum.photos/seed/${seed}/800/500`;
  return {
    id: typeof raw.id === 'number' ? `cafe-${raw.id}` : raw.id,
    name: (raw.name || '').trim(),
    region: raw.region || 'Unknown',
    city: raw.city || '',
    cityZh: raw.city_cwa || CITY_TO_TW[raw.city] || null,
    lat, lng,
    address: raw.address || '',
    phone: raw.phone || null,
    rating: typeof raw.rating === 'number' ? raw.rating : 0,
    reviewCount: raw.review_count ?? null,
    priceLevel: (raw.price_range || raw.priceLevel || '').trim() || '$',
    instagram: igHandle,
    instagramUrl: raw.instagram_url || null,
    mapsUrl: raw.maps_url || null,
    landmark: raw.landmark || null,
    notes: raw.notes || null,
    facilities,
    hours: raw.opening_hours || raw.hours || {},
    thumbnail,
  };
}

let cafesCache = null;
async function loadCafes() {
  if (cafesCache) return cafesCache;
  const raw = await readFile(path.join(__dirname, 'data', 'cafes.json'), 'utf8');
  cafesCache = JSON.parse(raw).map(normalizeCafe);
  return cafesCache;
}

// =============================================================================
// Network helpers
// =============================================================================

async function safeFetch(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeout || 8000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      console.error(`[API ERR] ${res.status}  ${url.split('?')[0]}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[NET ERR] ${url.split('?')[0]} — ${e.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getAqiLevel(aqi) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy (Sensitive)';
  return 'Unhealthy';
}

/** Weather Description Matrix (temp band × precipitation prob) */
function getWeatherDescription(tempMin, tempMax, pop /*, aqiLvl */) {
  const t = (parseFloat(tempMin) + parseFloat(tempMax)) / 2;
  const tCat = t < 15 ? 'cold' : t < 20 ? 'cool' : t < 25 ? 'mild' : t < 30 ? 'warm' : 'hot';
  const rCat = pop <= 20 ? 'dry' : pop <= 50 ? 'chance' : pop <= 80 ? 'rainy' : 'heavy';
  const matrix = {
    cold: { dry: 'Crisp and cold — bundle up!', chance: 'Cold with drizzle',  rainy: 'Chilly and rainy',  heavy: 'Cold and wet'      },
    cool: { dry: 'Crisp and clear — jacket weather', chance: 'A sweater day', rainy: 'Cool and grey',     heavy: 'Chilly and grey'   },
    mild: { dry: 'Perfect café weather!', chance: 'Comfortable',              rainy: 'Fresh but rainy',   heavy: 'Mild but rainy'    },
    warm: { dry: 'Warm and sunny!',       chance: 'A bit humid and warm',     rainy: 'Warm with showers', heavy: 'Steamy and showery'},
    hot:  { dry: 'A scorcher — find AC!', chance: 'Hot and muggy',            rainy: 'Hot and stormy',    heavy: 'Sweltering rain'   },
  };
  return matrix[tCat][rCat];
}

// =============================================================================
// MyMemory translation — Chinese → English via axios.
// Free public API: ~5 000 words/day anonymous, 10 000/day with a real `de` email.
// ► REPLACE the placeholder MYMEMORY_EMAIL below (or set MYMEMORY_EMAIL in .env)
//   with your real address to claim the higher daily quota.
// =============================================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

const MYMEMORY_URL      = 'https://api.mymemory.translated.net/get';
const MYMEMORY_EMAIL    = process.env.MYMEMORY_EMAIL    || 'your_email@example.com';
const MYMEMORY_LANGPAIR = process.env.MYMEMORY_LANGPAIR || 'zh-TW|en';
const MYMEMORY_DELAY_MS = Number(process.env.MYMEMORY_DELAY_MS || 700); // ≥ 500 ms
const MYMEMORY_TIMEOUT  = 8000;

// Per-process cache + circuit-breaker (shared across requests)
const translateCache = new Map();           // key `${langpair}:${text}` -> string
const TRANSLATE_CACHE_MAX = 5000;
let translateCooldownUntil = 0;             // skip outbound calls until this ts

function cacheGet(key) { return translateCache.get(key); }
function cacheSet(key, val) {
  if (translateCache.size >= TRANSLATE_CACHE_MAX) {
    const first = translateCache.keys().next().value;
    translateCache.delete(first);
  }
  translateCache.set(key, val);
}

/**
 * Translate ONE string with MyMemory. Always resolves — every failure path
 * (timeout, non-2xx, daily-quota warning, hard 429) returns the original
 * text so callers never have to handle errors.
 *
 * MyMemory takes a single `q` per call, so callers MUST iterate sequentially
 * (see myMemoryTranslateBatch) with a delay to stay under the rate limit.
 *
 * @param {string} text       source text
 * @param {string} [langpair] e.g. "zh-TW|en"
 * @returns {Promise<string>} translated text or original on any failure
 */
async function myMemoryTranslate(text, langpair = MYMEMORY_LANGPAIR) {
  if (!text || typeof text !== 'string') return text || '';

  // Cache hit short-circuits everything
  const cacheKey = `${langpair}:${text}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit;

  // Circuit-breaker: a recent 429 / quota-exceeded suppresses outbound calls
  if (Date.now() < translateCooldownUntil) return text;

  try {
    const res = await axios.get(MYMEMORY_URL, {
      params: {
        q: text,
        langpair,
        de: MYMEMORY_EMAIL,         // remember to set MYMEMORY_EMAIL in .env
      },
      timeout: MYMEMORY_TIMEOUT,
    });

    const translated = res.data?.responseData?.translatedText;
    const status     = res.data?.responseStatus;

    // Quota-exceeded responses sometimes come back as HTTP 200 with the
    // warning embedded in the translated text — treat that as failure.
    const looksLikeQuotaWarning = typeof translated === 'string'
      && /MYMEMORY WARNING|YOU USED ALL AVAILABLE FREE TRANSLATIONS/i.test(translated);

    if (
      typeof translated === 'string' &&
      translated.trim() &&
      !looksLikeQuotaWarning &&
      status !== 429 && status !== 403
    ) {
      cacheSet(cacheKey, translated);
      return translated;
    }

    if (looksLikeQuotaWarning || status === 429 || status === 403) {
      translateCooldownUntil = Date.now() + 5 * 60 * 1000;   // 5 min back-off
      console.warn(`[MyMemory] quota/limit signalled (status ${status}); cooling down 5 min`);
    }
    return text;
  } catch (e) {
    if (e.response?.status === 429) {
      translateCooldownUntil = Date.now() + 60 * 1000;
      console.warn('[MyMemory] 429 rate-limited; cooling down 60s');
    } else {
      console.error(`[MyMemory] ${e.message}`);
    }
    return text;
  }
}

/**
 * Translate an array of strings sequentially with throttling.
 * Uses a for-of loop so we never fire parallel requests at MyMemory.
 */
async function myMemoryTranslateBatch(texts, {
  langpair = MYMEMORY_LANGPAIR,
  delayMs  = MYMEMORY_DELAY_MS,
} = {}) {
  const out = [];
  for (const text of texts) {
    out.push(await myMemoryTranslate(text, langpair));
    await sleep(delayMs);                   // throttle every call ≥ 500 ms
  }
  return out;
}

// =============================================================================
// TDX OAuth 2.0 token cache
// =============================================================================

const tdxCache = { token: null, expiresAt: 0 };

async function getTDXToken() {
  if (tdxCache.token && Date.now() < tdxCache.expiresAt) return tdxCache.token;
  const { TDX_CLIENT_ID, TDX_CLIENT_SECRET } = process.env;
  if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET) {
    console.error('[TDX] credentials missing in .env');
    return null;
  }
  try {
    const res = await fetch(
      'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: TDX_CLIENT_ID,
          client_secret: TDX_CLIENT_SECRET,
        }),
      }
    );
    if (!res.ok) {
      console.error(`[TDX Auth] HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.access_token) return null;
    tdxCache.token = data.access_token;
    tdxCache.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    console.log('[TDX] token acquired');
    return tdxCache.token;
  } catch (e) {
    console.error('[TDX Auth] network error', e.message);
    return null;
  }
}

// =============================================================================
// Weather fallback (OpenWeather)
// =============================================================================

async function fetchOWMFallback(lat, lng) {
  if (!process.env.OWM_API_KEY) return null;
  const [wxRes, aqRes] = await Promise.all([
    safeFetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${process.env.OWM_API_KEY}&units=metric`),
    safeFetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lng}&appid=${process.env.OWM_API_KEY}`),
  ]);
  if (!wxRes) return null;

  const temp = Math.round(wxRes.main?.temp ?? 20);
  const tempMin = Math.round(wxRes.main?.temp_min ?? temp);
  const tempMax = Math.round(wxRes.main?.temp_max ?? temp);
  const clouds = wxRes.clouds?.all ?? 0;
  const rain1h = wxRes.rain?.['1h'] ?? 0;
  const pop = rain1h > 5 ? 90 : rain1h > 1 ? 70 : rain1h > 0 ? 50 : Math.round(clouds * 0.6);
  const owmToAqi = { 1: 25, 2: 75, 3: 125, 4: 175, 5: 250 };
  const aqiVal = owmToAqi[aqRes?.list?.[0]?.main?.aqi] ?? 50;

  return { temperature: temp, tempMin, tempMax, pop, condCode: wxRes.weather?.[0]?.id ?? 800, aqiLvl: getAqiLevel(aqiVal) };
}

// =============================================================================
// Routes — Cafés
// =============================================================================

app.get('/api/cafes', async (req, res) => {
  try {
    const cafes = await loadCafes();
    const { region, city, q, facility } = req.query;
    let out = cafes;
    if (region)   out = out.filter(c => c.region.toLowerCase() === String(region).toLowerCase());
    if (city)     out = out.filter(c => c.city.toLowerCase()   === String(city).toLowerCase());
    if (facility) out = out.filter(c => c.facilities.map(f => f.toLowerCase()).includes(String(facility).toLowerCase()));
    if (q) {
      const needle = String(q).toLowerCase();
      out = out.filter(c =>
        c.name.toLowerCase().includes(needle) ||
        c.address.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle));
    }
    res.json({ count: out.length, items: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cafes/:id', async (req, res) => {
  try {
    const cafes = await loadCafes();
    const cafe = cafes.find(c => c.id === req.params.id);
    if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
    res.json(cafe);   // weather/tdx fetched separately by the FE
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Routes — Weather (CWA + Open-Meteo + MOE air quality, OWM fallback)
// =============================================================================

app.get('/api/weather', async (req, res) => {
  const { lat, lng, city, city_cwa } = req.query;
  const countyZH = city_cwa || CITY_TO_TW[city] || city;

  const [omRaw, cwaRaw, moeRaw] = await Promise.all([
    (lat && lng)
      ? safeFetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m&timezone=Asia%2FTaipei`)
      : Promise.resolve(null),
    (process.env.CWA_API_KEY && countyZH)
      ? safeFetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=${process.env.CWA_API_KEY}&locationName=${encodeURIComponent(countyZH)}`)
      : Promise.resolve(null),
    (process.env.MOE_API_KEY && countyZH)
      ? safeFetch(`https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=${process.env.MOE_API_KEY}&format=JSON&limit=20&filters=County,EQ,${encodeURIComponent(countyZH)}`)
      : Promise.resolve(null),
  ]);

  // CWA: pick the forecast slot that contains "now"
  let cwa = { tempMin: 20, tempMax: 25, pop: 0, condCode: 1 };
  const loc = cwaRaw?.records?.location?.[0];
  if (loc) {
    const elMap = {};
    loc.weatherElement.forEach(e => { elMap[e.elementName] = e.time; });
    const now = new Date();
    let pIdx = (elMap['Wx'] || []).findIndex(p => new Date(p.startTime) <= now && now < new Date(p.endTime));
    if (pIdx < 0) pIdx = 0;
    const getVal = key => elMap[key]?.[pIdx]?.parameter;
    cwa = {
      tempMin: getVal('MinT')?.parameterName || 20,
      tempMax: getVal('MaxT')?.parameterName || 25,
      pop:     parseInt(getVal('PoP')?.parameterName || '0'),
      condCode: getVal('Wx')?.parameterValue || 1,
    };
  }

  const moeRecords = moeRaw?.records || [];
  const validAqi = moeRecords.filter(r => r.aqi && !isNaN(r.aqi));
  const avgAqi = validAqi.length
    ? Math.round(validAqi.reduce((s, r) => s + parseInt(r.aqi), 0) / validAqi.length)
    : 50;
  const aqiLvl = getAqiLevel(avgAqi);

  // If everything upstream failed, try OpenWeather fallback
  if (!omRaw && !loc && !validAqi.length && lat && lng) {
    const owm = await fetchOWMFallback(lat, lng);
    if (owm) {
      return res.json({
        temperature: owm.temperature,
        tempRange: `${owm.tempMin}–${owm.tempMax}°C`,
        rainProb: `${owm.pop}%`,
        aqiLevel: owm.aqiLvl,
        condCode: owm.condCode,
        description: getWeatherDescription(owm.tempMin, owm.tempMax, owm.pop, owm.aqiLvl),
        source: 'owm',
      });
    }
  }

  res.json({
    temperature: omRaw?.current?.temperature_2m ?? cwa.tempMax,
    tempRange:   `${cwa.tempMin}–${cwa.tempMax}°C`,
    rainProb:    `${cwa.pop}%`,
    aqiLevel:    aqiLvl,
    condCode:    cwa.condCode,
    description: getWeatherDescription(cwa.tempMin, cwa.tempMax, cwa.pop, aqiLvl),
    source: 'cwa+om+moe',
  });
});

// =============================================================================
// Routes — TDX (nearby scenic spots + YouBike availability)
// =============================================================================

app.get('/api/tdx', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'Missing coordinates' });

  const token = await getTDXToken();
  if (!token) return res.json({ scenic_spots: [], youbike: [] });

  const headers = { Authorization: `Bearer ${token}` };
  const spatial = `$spatialFilter=nearby(${lat},${lng},500)&$format=JSON`;

  const [spotsRaw, stationsRaw, availRaw] = await Promise.all([
    safeFetch(`https://tdx.transportdata.tw/api/basic/v2/Tourism/ScenicSpot?$top=5&${spatial}`, { headers }),
    safeFetch(`https://tdx.transportdata.tw/api/advanced/v2/Bike/Station/NearBy?$top=8&${spatial}`, { headers }),
    safeFetch(`https://tdx.transportdata.tw/api/advanced/v2/Bike/Availability/NearBy?$top=8&${spatial}`, { headers }),
  ]);

  const scenic_spots = (spotsRaw?.value || spotsRaw || []).map(s => {
    const zhName = s.ScenicSpotName || 'Unknown Spot';
    const rawDesc = s.DescriptionDetail || s.Description || '';
    const desc = rawDesc.length > 80 ? rawDesc.slice(0, 80) + '…' : rawDesc;
    return { name_zh: zhName, name_en: zhName, desc, desc_zh: desc };
  });

  // --- MyMemory enrichment (zh → en) — NAMES ONLY ---
  // We translate spot NAMES eagerly (cheap, ≤ 5 strings) so the list is
  // immediately readable. DESCRIPTIONS are deferred: the FE renders a
  // "Learn more" button per spot and only POSTs to /api/translate when
  // the user actually wants to read it. This keeps initial /api/tdx fast,
  // saves MyMemory quota, and matches the lazy-load UX requirement.
  if (scenic_spots.length) {
    try {
      for (const s of scenic_spots) {
        const enName = await myMemoryTranslate(s.name_zh);
        if (enName && enName !== s.name_zh) s.name_en = enName;
        await sleep(MYMEMORY_DELAY_MS);
        // Strip the eagerly-translated `desc`; keep `desc_zh` for lazy fetch.
        delete s.desc;
      }
    } catch (e) {
      console.error('[/api/tdx] translation enrichment failed:', e.message);
    }
  }

  const availMap = new Map((availRaw?.value || availRaw || []).map(a => [a.StationUID, a]));
  const youbike = (stationsRaw?.value || stationsRaw || [])
    .map(s => {
      const a = availMap.get(s.StationUID);
      return {
        name_display: s.StationName?.En
          ? `${s.StationName.En} (${s.StationName.Zh_tw})`
          : s.StationName?.Zh_tw,
        distance: haversineMeters(parseFloat(lat), parseFloat(lng),
                                  s.StationPosition.PositionLat, s.StationPosition.PositionLon),
        available_rent:   a?.AvailableRentBikes ?? 0,
        available_return: a?.AvailableReturnBikes ?? 0,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  res.json({ scenic_spots, youbike });
});

// =============================================================================
// Health
// =============================================================================

// =============================================================================
// Routes — Translation passthrough (MyMemory)
// =============================================================================

/**
 * GET /api/translate?q=…&source=zh-TW&target=en
 * Returns { original, translated, source, target } — `translated` falls back
 * to `original` whenever MyMemory fails or hits the daily quota.
 */
app.get('/api/translate', async (req, res) => {
  const q = req.query.q;
  const source = req.query.source || 'zh-TW';
  const target = req.query.target || 'en';
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const translated = await myMemoryTranslate(String(q), `${source}|${target}`);
    res.json({ original: q, translated, source, target });
  } catch (e) {
    // Defensive: myMemoryTranslate already swallows its own errors.
    res.json({ original: q, translated: q, source, target, fallback: true, error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ts: Date.now(),
    keys: {
      cwa: !!process.env.CWA_API_KEY,
      moe: !!process.env.MOE_API_KEY,
      tdx: !!process.env.TDX_CLIENT_ID,
      owm: !!process.env.OWM_API_KEY,
      mymemory_email: MYMEMORY_EMAIL !== 'your_email@example.com',
    },
  });
});

// if not Vercel (Production) env., then activate local port and console.log
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ NomadSpot Taiwan BFF → http://localhost:${PORT}`);
    console.log(`   CWA: ${process.env.CWA_API_KEY ? '✓' : '✗'}  MOE: ${process.env.MOE_API_KEY ? '✓' : '✗'}  TDX: ${process.env.TDX_CLIENT_ID ? '✓' : '✗'}  OWM: ${process.env.OWM_API_KEY ? '✓' : '✗'}`);
  });
}

// export app to Vercel
export default app;
