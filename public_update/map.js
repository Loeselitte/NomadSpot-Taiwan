// NomadSpot Taiwan — map screen (Integrated with detail API & Drawer Logic)
const listEl = document.getElementById('entry-list');
const backdrop = document.getElementById('backdrop');
const detailPanel = document.getElementById('detail-panel');

const FALLBACK_IMG = "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=600&q=80";

const map = L.map('leaflet-map', { zoomControl: true }).setView([23.7, 121.0], 7);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

// Coffee-cup SVG marker (replaces the old dot)
const COFFEE_SVG = `
<svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 35 C 8 28, 2 22, 2 13 a13 13 0 1 1 26 0 c 0 9 -6 15 -13 22 z"
        fill="#864537" stroke="#FDFDF1" stroke-width="2"/>
  <g transform="translate(7.5, 5.5)" fill="#FDFDF1">
    <path d="M2 3 h9 v6 a3 3 0 0 1 -3 3 H5 a3 3 0 0 1 -3 -3 z"/>
    <path d="M11 4 a2.2 2.2 0 0 1 0 4.4" stroke="#FDFDF1" stroke-width="1.2" fill="none"/>
    <path d="M3 1.2 q0 1 1 1.6" stroke="#FDFDF1" stroke-width="0.9" fill="none" opacity="0.85"/>
    <path d="M6 0.8 q0 1.2 1 1.8" stroke="#FDFDF1" stroke-width="0.9" fill="none" opacity="0.85"/>
    <path d="M9 1.2 q0 1 1 1.6" stroke="#FDFDF1" stroke-width="0.9" fill="none" opacity="0.85"/>
  </g>
</svg>`;

function makeCafeIcon() {
  return L.divIcon({
    html: `<div class="cafe-pin-svg">${COFFEE_SVG}</div>`,
    className: 'cafe-pin',
    iconSize: [30, 36],
    iconAnchor: [15, 34],
  });
}

let cafes = [];
const markersById = new Map();   // id -> L.Marker
let highlightedId = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helper and Rendering Functions
// ─────────────────────────────────────────────────────────────────────────────

// Image Error Handling Fallback (Local -> API -> Fallback)
window.handleImgError = function(img, apiImgUrl) {
  // If the API image also fails, set the next onerror to directly use the ultimate fallback image (preventing infinite loops)
  img.onerror = function() {
    img.onerror = null;
    img.src = FALLBACK_IMG;
  };
  
  // Check if a valid API URL exists, load it if available, otherwise use the fallback image
  if (apiImgUrl && apiImgUrl !== 'undefined' && apiImgUrl !== 'null' && apiImgUrl !== '') {
    img.src = apiImgUrl;
  } else {
    img.src = FALLBACK_IMG;
  }
};

const AMENITY_LABELS = {
  wifi: "Wifi",
  power_outlets: "Power Outlet",
  restroom: "Restroom",
  outdoor_seating: "Outdoor seating",
  good_for_groups: "Good for groups",
  reservable: "Reservable",
  serves_meal: "Serves meals",
  no_time_limit: "No time limit",
  quiet: "Peace & Quiet",
};

function renderStars(rating) {
  if (rating == null) return '';
  const PATH = "M7,1 L8.53,4.9 L12.71,5.15 L9.47,7.8 L10.53,11.85 L7,9.6 L3.47,11.85 L4.53,7.8 L1.29,5.15 L5.47,4.9 Z";
  const star = (fill) => `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><path d="${PATH}" fill="${fill}"/></svg>`;
  const halfStar = (id) => `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hg${id}"><stop offset="50%" stop-color="#FFB800"/><stop offset="50%" stop-color="#D6D6D6"/></linearGradient></defs><path d="${PATH}" fill="url(#hg${id})"/></svg>`;

  const full  = Math.floor(rating);
  const frac  = rating % 1;
  const half  = frac >= 0.25 && frac < 0.75 ? 1 : 0;
  const extra = frac >= 0.75 ? 1 : 0;
  const empty = 5 - full - half - extra;

  return star("#FFB800").repeat(full + extra) + (half ? halfStar(rating) : "") + star("#D6D6D6").repeat(empty);
}

function renderWeatherHTML(wx) {
  if (!wx) return '';
  const desc = wx.description || "Weather updated";
  const temp = wx.temperature ? `${Math.round(wx.temperature)}°C` : (wx.tempRange || "--°C");
  const rain = wx.rainProb || "--%"; 
  const aqi  = wx.aqiLevel ? `Air Quality: ${wx.aqiLevel}` : "Air Quality: --";

  return `
    <div class="weather-box">
      <div class="summary">${desc}</div>
      <div class="stats">
        <span>${temp}</span>
        <span>·</span>
        <span>💧 ${rain}</span>
        <span>·</span>
        <span>💨 ${aqi}</span>
      </div>
    </div>`;
}

// Module-scoped reference to the spots currently rendered in the detail panel.
// Lets the lazy-load click handler look up the original Chinese description
// without smuggling potentially-quoted text through data-attributes.
let _currentSpots = [];

function renderAttractionsHTML(spots, fallbackLandmark) {
  _currentSpots = Array.isArray(spots) ? spots : [];
  if (_currentSpots.length > 0) {
    return _currentSpots.map((s, i) => {
      const nameEn = (s.name_en ?? "").trim();
      const nameZh = (s.name_zh ?? "").trim();
      const heading = nameEn || nameZh || "Unknown";
      const subtitle = (nameEn && nameZh && nameEn !== nameZh)
        ? `<div class="attraction-zh" style="font-size:12px; color:var(--color-label-alt)">${nameZh}</div>`
        : "";
      // Description is intentionally NOT pre-rendered — see handleLearnMore()
      const hasDesc = !!(s.desc_zh || s.description);
      const learnMore = hasDesc
        ? `<button class="btn-learn-more" data-spot-idx="${i}" type="button">Learn more →</button>`
        : '';
      return `
        <div class="info-row attraction-card" data-spot-idx="${i}"
             style="flex-direction:column; gap:6px; margin-bottom:8px; border-left:2px solid var(--color-line); padding-left:10px;">
          <div style="font-weight:600">${heading}</div>
          ${subtitle}
          ${learnMore}
        </div>`;
    }).join("");
  } else if (fallbackLandmark) {
    return `<div class="info-row"><span class="ic">🗺️</span><span>Near ${fallbackLandmark}</span></div>`;
  }
  return `<p class="no-data" style="font-size:13px; color:var(--color-label-alt)">No nearby attractions found.</p>`;
}

// Lazy-load + translate one spot's description on user click.
// Single-flight per spot: button is disabled while in flight; on hard
// failure the user can retry or fall back to seeing the Chinese original.
async function handleLearnMore(btn) {
  const idx = Number(btn.dataset.spotIdx);
  const spot = _currentSpots[idx];
  const sourceText = spot?.desc_zh || spot?.description || '';
  if (!sourceText) {
    btn.textContent = 'No description available';
    btn.disabled = true;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const r = await fetch(`/api/translate?q=${encodeURIComponent(sourceText)}&source=zh-TW&target=en`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const text = (j.translated && j.translated.trim()) ? j.translated : sourceText;
    const div = document.createElement('div');
    div.className = 'attraction-desc';
    div.style.cssText = 'font-size:13px; color:var(--color-label-alt); line-height:1.5; margin-top:2px;';
    div.textContent = text;
    btn.replaceWith(div);
  } catch (e) {
    // Hard failure → offer the Chinese original as a one-tap fallback
    btn.disabled = false;
    btn.textContent = 'Show original (zh) ↻';
    btn.onclick = () => {
      const div = document.createElement('div');
      div.className = 'attraction-desc';
      div.style.cssText = 'font-size:13px; color:var(--color-label-alt); line-height:1.5; margin-top:2px;';
      div.textContent = sourceText;
      btn.replaceWith(div);
    };
  }
}

function renderYoubikeHTML(stations) {
  if (!stations || stations.length === 0) {
    return `<p class="no-data" style="font-size:13px; color:var(--color-label-alt)">No YouBike stations nearby.</p>`;
  }

  return stations.slice(0, 5).map((s) => {
    const displayName = s.name_display || (s.name_en ? `${s.name_en} (${s.name_zh})` : s.name_zh);
    const dist = s.distance != null ? `${s.distance}m` : "";
    const rentNum = s.available_rent ?? "—";
    const returnNum = s.available_return ?? "—";
    
    return `
      <div class="info-row" style="align-items:center; justify-content:space-between; border-bottom:1px dashed var(--color-line); padding:6px 0;">
        <div>
          <div style="font-weight:500; font-size:13px;"><img src="/assets/icons/bicycle.svg" alt="Bike" width="16" height="16" style="vertical-align:middle; margin-right:4px;"> ${displayName}</div>
          <div style="font-size:12px; color:var(--color-label-alt)">${dist} away</div>
        </div>
        <div style="text-align:right; font-size:12px;">
          <div><strong style="color:${rentNum === 0 ? 'var(--color-caution)' : 'inherit'}">${rentNum}</strong> bikes</div>
          <div><strong style="color:${returnNum === 0 ? 'var(--color-caution)' : 'inherit'}">${returnNum}</strong> slots</div>
        </div>
      </div>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Map Data Loading & Filtering
// ─────────────────────────────────────────────────────────────────────────────

async function loadCafes() {
  try {
    const res = await fetch('/api/cafes');
    const data = await res.json();
    cafes = data.items || data; 
    renderList(cafes);
    renderPins(cafes);
  } catch (err) {
    listEl.innerHTML = `<div class="loading">Failed to load cafés: ${err.message}</div>`;
  }
}

function renderList(items) {
  if (!items.length) {
    listEl.innerHTML = '<div class="loading">No cafés match the filter.</div>';
    return;
  }
  listEl.innerHTML = items.map(c => {
    const ratingDisplay = c.rating ? `★ ${c.rating.toFixed(1)}` : 'No rating';
    const priceDisplay = c.priceLevel || (c.price_level ? c.price_level : '');
    
    // Image logic: priority Local -> API -> Fallback
    const localImgUrl = `assets/cafe-images/${c.id}.jpg`;
    const apiImgUrl = c.thumbnail || c.image_url || '';
    
    const region = c.region || '';
    const city = c.city || '';
    
    return `
      <article class="cafe-card" data-id="${c.id}">
        <div class="thumb">
          <img class="thumb-img" src="${localImgUrl}" alt="${c.name}" loading="lazy"
               onerror="handleImgError(this, '${apiImgUrl}')" />
          <span class="region-tag">${region.toUpperCase()} · ${city.toUpperCase()}</span>
        </div>
        <div class="meta">
          <h3>${c.name}</h3>
          <div class="detail-line">
            <span class="rating">${ratingDisplay}</span>
            ${priceDisplay ? `<span>·</span><span>${priceDisplay}</span>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
  
  listEl.querySelectorAll('.cafe-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function renderPins(items) {
  // Build markers for ALL items once, then control visibility via setMarkerSubset.
  items.forEach(c => {
    const lat = c.lat || (c.coordinates ? c.coordinates.lat : null);
    const lng = c.lng || (c.coordinates ? c.coordinates.lng : null);
    if (!lat || !lng) return;
    if (markersById.has(c.id)) return;

    const m = L.marker([lat, lng], { icon: makeCafeIcon() })
      .bindTooltip(c.name, { direction: 'top', offset: [0, -28] });
    m.on('click', () => openDetail(c.id));
    m.addTo(map);
    markersById.set(c.id, m);
  });
}

// Show pins only for the given subset (used by region/facility filters)
function setMarkerSubset(items) {
  const visibleIds = new Set(items.map(c => c.id));
  markersById.forEach((m, id) => {
    if (visibleIds.has(id)) {
      if (!map.hasLayer(m)) m.addTo(map);
    } else {
      if (map.hasLayer(m)) map.removeLayer(m);
    }
  });
  clearHighlight();
}

function highlightMarker(id) {
  highlightedId = id;
  markersById.forEach((m, mid) => {
    const el = m.getElement();
    if (!el) return;
    const pin = el.querySelector('.cafe-pin-svg');
    if (!pin) return;
    pin.classList.toggle('highlighted', mid === id);
    pin.classList.toggle('dimmed', mid !== id);
  });
}

function clearHighlight() {
  highlightedId = null;
  markersById.forEach(m => {
    const el = m.getElement();
    if (!el) return;
    const pin = el.querySelector('.cafe-pin-svg');
    if (pin) pin.classList.remove('dimmed', 'highlighted');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Drawer Logic 
// ─────────────────────────────────────────────────────────────────────────────

async function openDetail(rawId) {
  const id = parseInt(rawId, 10) || rawId;
  
  detailPanel.style.display = 'flex';
  // eslint-disable-next-line no-unused-expressions
  detailPanel.offsetHeight;
  detailPanel.classList.add('open');
  detailPanel.innerHTML = `<div class="loading">Loading details...</div>`;
  backdrop.classList.add('open');

  try {
    const res = await fetch(`/api/cafes/${id}`);
    if (!res.ok) throw new Error('Not found');
    const c = await res.json();

    const lat = c.lat || (c.coordinates ? c.coordinates.lat : null);
    const lng = c.lng || (c.coordinates ? c.coordinates.lng : null);

    let wx = null, tdx = null;
    if (lat && lng) {
      const cityParams = `city=${c.city || ''}&city_cwa=${c.city_cwa || ''}`;
      [wx, tdx] = await Promise.all([
        fetch(`/api/weather?lat=${lat}&lng=${lng}&${cityParams}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tdx?lat=${lat}&lng=${lng}`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const hoursData = c.hours || c.opening_hours || {};
    const hoursRows = Object.entries(hoursData).length > 0 
      ? Object.entries(hoursData).map(([day, hrs]) =>
          `<div class="row ${day === today ? 'today' : ''}"><span>${day}</span><span>${hrs}</span></div>`
        ).join('')
      : '<p style="font-size:14px; color:var(--color-label-alt)">No hours available</p>';

    const facilitiesData = c.facilities || (c.amenities ? Object.keys(c.amenities).filter(k => c.amenities[k]) : []);
    const facilitiesHTML = facilitiesData.map(f => {
      const label = AMENITY_LABELS[f] || f;
      return `<span class="chip">${label}</span>`;
    }).join('');

    const weatherBlock = renderWeatherHTML(wx || c.weather);
    const attractionsBlock = renderAttractionsHTML(tdx?.scenic_spots, c.landmark);
    const youbikeBlock = renderYoubikeHTML(tdx?.youbike);
    
    // Image logic: priority Local -> API -> Fallback
    const localImgUrl = `/assets/cafe-images/${c.id}.jpg`;
    const apiImgUrl = c.thumbnail || c.image_url || '';
    
    const ratingHtml = c.rating ? `<span>${renderStars(c.rating)} ${c.rating.toFixed(1)}</span>` : '';
    const priceHtml = (c.priceLevel || c.price_level) ? ` · ${c.priceLevel || c.price_level}` : '';

    const directionsHref = c.mapsUrl || c.maps_url ||
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

    detailPanel.innerHTML = `
      <div class="detail-header">
        <div>
          <h2>${c.name}</h2>
          <div class="sub" style="display:flex; align-items:center; gap:4px; margin-top:6px;">
            <span class="rating" style="display:flex; align-items:center; gap:2px">${ratingHtml}</span>
            ${priceHtml}
          </div>
        </div>
        <button class="icon-btn" id="close-btn" aria-label="Close">✕</button>
      </div>

      <div class="detail-body">
        <img class="hero" src="${localImgUrl}" alt="${c.name}" onerror="handleImgError(this, '${apiImgUrl}')" />

        ${weatherBlock}

        <div class="info-row"><span class="ic"><img src="/assets/icons/location.svg" alt="Location" width="16" height="16"></span><span>${c.address || "No address provided"}</span></div>
        ${c.instagram || c.instagram_url ? `<div class="info-row"><span class="ic"><img src="/assets/icons/Instagram.svg" alt="Instagram" width="16" height="16"></span><a href="${c.instagram_url || c.instagramUrl || '#'}" target="_blank" rel="noopener">${c.instagram || 'Instagram'}</a></div>` : ''}
        ${c.phone ? `<div class="info-row"><span class="ic"><img src="/assets/icons/phone.svg" alt="Phone" width="16" height="16"></span><a href="tel:${c.phone.replace(/\s/g, "")}">${c.phone}</a></div>` : ''}
        ${c.notes ? `<div class="info-row"><span class="ic">📝</span><span>${c.notes}</span></div>` : ''}

        <div class="facilities">${facilitiesHTML}</div>

        <h3 class="section-title">Open Hours</h3>
        <div class="hours-list">${hoursRows}</div>

        <h3 class="section-title" style="margin-top:16px;">YouBike Nearby</h3>
        <div style="display:flex; flex-direction:column; gap:8px;">${youbikeBlock}</div>

        <h3 class="section-title" style="margin-top:16px;">Things to do near ${c.name}</h3>
        <div style="display:flex; flex-direction:column; gap:8px;">${attractionsBlock}</div>
      </div>

      <div class="detail-footer">
        <a target="_blank" rel="noopener" href="${directionsHref}">
          <button class="btn-block">Get Directions</button>
        </a>
      </div>
    `;

    document.getElementById('close-btn').addEventListener('click', closeDetail);
    if (lat && lng) {
      map.flyTo([lat, lng], 14, { duration: 0.6 });
    }
    highlightMarker(c.id);

  } catch (err) {
    detailPanel.innerHTML = `
      <div class="detail-header">
        <h2>Error</h2>
        <button class="icon-btn" id="close-btn-err" aria-label="Close">✕</button>
      </div>
      <div class="loading">Café not found or network error. (${err.message})</div>`;
    document.getElementById('close-btn-err')?.addEventListener('click', closeDetail);
  }
}

function closeDetail() {
  detailPanel.classList.remove('open');
  setTimeout(() => { detailPanel.style.display = 'none'; }, 240);
  backdrop.classList.remove('open');
  clearHighlight();
}

// Event delegation: catches every Learn more click inside the (re-rendered) panel
detailPanel.addEventListener('click', e => {
  const btn = e.target.closest('.btn-learn-more');
  if (btn) handleLearnMore(btn);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Sheet & Drawer Interactions
// ─────────────────────────────────────────────────────────────────────────────

const aside = document.querySelector('.aside');
const asideDrag = document.getElementById('aside-drag');
const filterDrag = document.getElementById('filter-drag');

const isMobile = () => window.innerWidth <= 768;

/**
 * Bottom-sheet drag controller.
 * @param sheet  the .aside or .filter-drawer element
 * @param handle the .drag-handle inside it
 * @param opts.peekPx      how many px peek above bottom when collapsed (aside only)
 * @param opts.dismissOn  'collapse' (aside snaps to peek) or 'close' (drawer slides off)
 */
function makeDraggable(sheet, handle, { dismissOn = 'collapse' } = {}) {
  let startY = 0;
  let startTransY = 0;
  let dragging = false;
  let moved = 0;                             // total px travelled
  const TAP_SLOP = 8;                        // < this counts as a tap

  const getCurrentTranslateY = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
    return m.m42 || 0;
  };

  const onPointerDown = e => {
    if (!isMobile()) return;
    dragging = true;
    moved = 0;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    startTransY = getCurrentTranslateY();
    sheet.classList.add('dragging');
    handle.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = e => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const delta = y - startY;
    moved = Math.abs(delta);
    let next = startTransY + delta;
    next = Math.max(0, next);
    sheet.style.transform = `translateY(${next}px)`;
  };

  const onPointerUp = e => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    const finalY = getCurrentTranslateY();
    const sheetH = sheet.getBoundingClientRect().height;

    // Tiny movement = treat as a tap that toggles the sheet
    if (moved < TAP_SLOP) {
      if (dismissOn === 'collapse') sheet.classList.toggle('expanded');
      // Suppress the synthetic click that pointerup would otherwise fire
      e?.preventDefault?.();
      return;
    }

    if (dismissOn === 'collapse') {
      if (finalY > sheetH * 0.35) sheet.classList.remove('expanded');
      else                        sheet.classList.add('expanded');
    } else {
      if (finalY > sheetH * 0.30) {
        sheet.classList.remove('open');
        if (sheet === drawer) closeDrawer();
      }
    }
  };

  handle.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  // Block any auto-fired click after a drag (browser fires click on pointerup)
  handle.addEventListener('click', e => {
    if (moved >= TAP_SLOP) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

makeDraggable(aside, asideDrag, { dismissOn: 'collapse' });

// Mobile: tapping the "Browse Cafés" header bar also opens the sheet
document.querySelector('.aside .panel-header').addEventListener('click', () => {
  if (!isMobile()) return;
  aside.classList.toggle('expanded');
});

// --- Filter drawer ---
const drawer = document.getElementById('filter-drawer');
const regionList = document.getElementById('region-list');
const facilityList = document.getElementById('facility-list');
const applyBtn = document.getElementById('filter-apply');
const clearBtn = document.getElementById('filter-clear');

const filterState = { region: null, facilities: new Set(), openToday: false };

// Today helper — used by both the filter and (later) any "is currently open" UI
function getTodayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}
function isOpenToday(cafe) {
  const today = getTodayName();
  const h = cafe.hours?.[today] || cafe.opening_hours?.[today];
  return !!h && !/closed/i.test(h);
}

function computeFiltered() {
  let out = cafes;
  if (filterState.region) {
    out = out.filter(c => (c.region || '').toLowerCase() === filterState.region.toLowerCase());
  }
  if (filterState.facilities.size) {
    out = out.filter(c => {
      const arr = c.facilities || (c.amenities ? Object.keys(c.amenities).filter(k => c.amenities[k]) : []);
      return [...filterState.facilities].every(f => arr.includes(f));
    });
  }
  if (filterState.openToday) {
    out = out.filter(isOpenToday);
  }
  return out;
}

function openDrawer() {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  buildFacilityChips();
  updateResultCount();        // ensure count is fresh on every open
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  if (detailPanel.style.display === 'none') backdrop.classList.remove('open');
}

function buildFacilityChips() {
  if (facilityList.children.length) return; 
  const set = new Set();
  cafes.forEach(c => {
    const arr = c.facilities || (c.amenities ? Object.keys(c.amenities).filter(k => c.amenities[k]) : []);
    arr.forEach(f => set.add(f));
  });
  facilityList.innerHTML = [...set].sort().map(f => {
    const label = AMENITY_LABELS[f] || f;
    return `<span class="chip" data-facility="${f}">${label}</span>`;
  }).join('');
  
  facilityList.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.facility;
      if (filterState.facilities.has(f)) filterState.facilities.delete(f);
      else filterState.facilities.add(f);
      chip.classList.toggle('active');
      onFilterChanged();
    });
  });
}

regionList.addEventListener('click', e => {
  const li = e.target.closest('li[data-region]');
  if (!li) return;
  const region = li.dataset.region;
  if (filterState.region === region) {
    filterState.region = null;
    li.classList.remove('active');
  } else {
    filterState.region = region;
    regionList.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
  }
  onFilterChanged();
});

// "Open today" toggle
const openTodaySwitch = document.getElementById('open-today-switch');
const openTodayRow    = document.getElementById('open-today-row');
function toggleOpenToday() {
  filterState.openToday = !filterState.openToday;
  openTodaySwitch.classList.toggle('on', filterState.openToday);
  openTodaySwitch.setAttribute('aria-checked', String(filterState.openToday));
  onFilterChanged();
}
openTodaySwitch.addEventListener('click', toggleOpenToday);
// Tapping the row label toggles too
openTodayRow.addEventListener('click', e => {
  if (e.target === openTodaySwitch) return;     // already handled
  toggleOpenToday();
});

function updateFilterBadge() {
  const btn = document.getElementById('filter-btn');
  const badge = document.getElementById('filter-badge');
  const count = (filterState.region ? 1 : 0) + filterState.facilities.size;
  badge.textContent = String(count);
  btn.classList.toggle('active', count > 0);
}

function updateResultCount() {
  const el = document.getElementById('filter-result-count');
  if (!el) return;
  const n = computeFiltered().length;
  el.textContent = `${n} ${n === 1 ? 'café' : 'cafés'} found`;
  el.classList.toggle('zero', n === 0);
}

// Reactive: every filter mutation calls this so the count + badge stay live
function onFilterChanged() {
  updateResultCount();
  updateFilterBadge();
}

function applyFilters() {
  const out = computeFiltered();
  renderList(out);
  setMarkerSubset(out);
  updateFilterBadge();
  updateResultCount();
  if (out.length) {
    const group = L.featureGroup([...markersById.values()].filter(m => map.hasLayer(m)));
    if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 12 });
  }
}

function clearFilters() {
  filterState.region = null;
  filterState.facilities.clear();
  filterState.openToday = false;
  regionList.querySelectorAll('li').forEach(x => x.classList.remove('active'));
  facilityList.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  const sw = document.getElementById('open-today-switch');
  if (sw) { sw.classList.remove('on'); sw.setAttribute('aria-checked', 'false'); }
  renderList(cafes);
  setMarkerSubset(cafes);
  onFilterChanged();
  map.flyTo([23.7, 121.0], 7, { duration: 0.6 });
}

document.getElementById('filter-btn').addEventListener('click', openDrawer);
document.getElementById('filter-close').addEventListener('click', closeDrawer);
applyBtn.addEventListener('click', () => { applyFilters(); closeDrawer(); });
clearBtn.addEventListener('click', () => { clearFilters(); });

// Wire the filter drawer's drag handle (mobile only)
makeDraggable(drawer, filterDrag, { dismissOn: 'close' });

backdrop.addEventListener('click', () => { 
  if (drawer.classList.contains('open')) closeDrawer(); 
  if (detailPanel.classList.contains('open')) closeDetail();
});

loadCafes();