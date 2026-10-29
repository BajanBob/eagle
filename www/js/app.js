/* Eagle — application controller */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eagle.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('eagle.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const DEFAULTS = { temp: 'c', wind: 'kt', len: 'm', pres: 'hpa', satKind: 'ir', wuKey: '', wuStation: '', refreshMin: 10 };
  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));

  const SOURCES = [
    { key: 'wx', name: 'Open-Meteo forecast', what: 'NOAA GFS / HRRR blended with ECMWF, DWD and other national models' },
    { key: 'marine', name: 'Open-Meteo marine', what: 'Waves, swell, ocean currents, sea temperature' },
    { key: 'aq', name: 'Open-Meteo air quality', what: 'Copernicus CAMS particulates, gases and dust' },
    { key: 'nws', name: 'NOAA National Weather Service', what: 'Point forecast and active alerts (US only)' },
    { key: 'metar', name: 'NOAA Aviation Weather Center', what: 'Nearest airfield METAR' },
    { key: 'buoy', name: 'NOAA NDBC', what: 'Nearest moored buoy or C-MAN station' },
    { key: 'wu', name: 'Weather Underground', what: 'Nearest personal weather station' },
    { key: 'sarg', name: 'NOAA AOML / USF sargassum', what: '7-day Alternative Floating Algae Index composite' },
    { key: 'sat', name: 'NASA GIBS satellite', what: 'GOES infrared or VIIRS true colour map layer' },
  ];

  const state = { lat: null, lon: null, grid: '', source: 'grid', data: {}, status: {}, sample: false, seq: 0, drift: null };

  /* ---------- units ---------- */
  const ok = (v) => v != null && !isNaN(v);
  const fx = (v, d = 0) => (ok(v) ? (+v).toFixed(d) : '—');
  const U = {
    t: (c) => (ok(c) ? (settings.temp === 'f' ? c * 9 / 5 + 32 : +c) : null),
    tu: () => (settings.temp === 'f' ? '°F' : '°C'),
    dt: (c) => (ok(c) ? (settings.temp === 'f' ? c * 9 / 5 : +c) : null), // temperature difference
    w: (kmh) => (ok(kmh) ? ({ kt: kmh / 1.852, kmh: +kmh, mph: kmh / 1.609344, ms: kmh / 3.6 }[settings.wind]) : null),
    wu: () => ({ kt: 'kt', kmh: 'km/h', mph: 'mph', ms: 'm/s' }[settings.wind]),
    wd: () => (settings.wind === 'ms' ? 1 : 0),
    m: (m) => (ok(m) ? (settings.len === 'ft' ? m * 3.28084 : +m) : null),
    mu: () => (settings.len === 'ft' ? 'ft' : 'm'),
    vis: (m) => (ok(m) ? (settings.len === 'ft' ? m / 1609.344 : m / 1000) : null),
    visu: () => (settings.len === 'ft' ? 'mi' : 'km'),
    km: (km) => (ok(km) ? (settings.len === 'ft' ? km / 1.609344 : +km) : null),
    kmu: () => (settings.len === 'ft' ? 'mi' : 'km'),
    p: (h) => (ok(h) ? (settings.pres === 'inhg' ? h * 0.0295300 : +h) : null),
    pu: () => (settings.pres === 'inhg' ? 'inHg' : 'hPa'),
    pd: () => (settings.pres === 'inhg' ? 2 : 1),
  };
  const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const beaufort = (kmh) => (ok(kmh) ? BFT.filter((b) => kmh >= b).length : null);
  const BFT_NAME = ['Calm', 'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze', 'Strong breeze', 'Near gale', 'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane force'];
  function uvLevel(uv) {
    if (!ok(uv)) return ['lvl-none', '—'];
    if (uv < 3) return ['lvl-good', 'Low']; if (uv < 6) return ['lvl-moderate', 'Moderate']; if (uv < 8) return ['lvl-usg', 'High'];
    if (uv < 11) return ['lvl-bad', 'Very high']; return ['lvl-vbad', 'Extreme'];
  }
  function aqiLevel(a) {
    if (!ok(a)) return ['lvl-none', '—'];
    if (a <= 50) return ['lvl-good', 'Good']; if (a <= 100) return ['lvl-moderate', 'Moderate']; if (a <= 150) return ['lvl-usg', 'Unhealthy for sensitive groups'];
    if (a <= 200) return ['lvl-bad', 'Unhealthy']; if (a <= 300) return ['lvl-vbad', 'Very unhealthy']; return ['lvl-haz', 'Hazardous'];
  }
  const CAT = { VFR: 'lvl-good', MVFR: 'lvl-moderate', IFR: 'lvl-bad', LIFR: 'lvl-vbad' };

  /* ---------- time at the point ---------- */
  function pointTime(date, withSeconds) {
    const tz = state.data.wx && state.data.wx.tz;
    const o = { hour: '2-digit', minute: '2-digit', hour12: false };
    if (withSeconds) o.second = '2-digit';
    if (tz) { try { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, o)).format(date); } catch (e) { /* fall through */ } }
    if (state.lon == null) return '--:--';
    const off = Math.round(state.lon / 15);
    const d = new Date(date.getTime() + off * 3600000);
    return '≈' + d.toISOString().slice(11, withSeconds ? 19 : 16);
  }
  const tzLabel = () => (state.data.wx && state.data.wx.tz) || ('UTC' + (state.lon >= 0 ? '+' : '') + Math.round((state.lon || 0) / 15) + ' (estimated)');

  /* ---------- map ---------- */
  const view = new EagleView($('map'), { onPick: (lat, lon) => setLocation({ lat, lon, grid: Geo.toGrid(lat, lon, 6), source: 'map' }, { recenter: false }) });
  view.layers = Object.assign(view.layers, store.get('layers', {}));
  ['Night', 'Grid', 'Sat', 'Sarg', 'Drift'].forEach((n) => {
    const key = n.toLowerCase(), box = $('ly' + n);
    box.checked = !!view.layers[key];
    box.addEventListener('change', () => {
      view.layers[key] = box.checked; store.set('layers', view.layers);
      view.rasterKey = ''; view.invalidate();
      if (box.checked && (key === 'sat' || key === 'sarg')) loadOverlays();
      layerNote();
    });
  });
  function setMode(m) {
    view.setMode(m); store.set('mode', m);
    $('vGeo').setAttribute('aria-selected', m === 'geochron'); $('vGod').setAttribute('aria-selected', m === 'god');
  }
  $('vGeo').onclick = () => setMode('geochron');
  $('vGod').onclick = () => setMode('god');
  view.mode = store.get('mode', 'geochron') === 'god' ? 'geochron' : 'god';
  setMode(store.get('mode', 'geochron'));
  $('zIn').onclick = () => view.zoom(1.5);
  $('zOut').onclick = () => view.zoom(1 / 1.5);
  $('zHome').onclick = () => { if (state.lat != null) { view.setPoint(state.lat, state.lon, state.grid); view.k = Math.max(view.k, view.mode === 'god' ? 1.6 : 4); view.invalidate(); } };

  /* ---------- location ---------- */
  function showError(msg) { const el = $('locError'); el.textContent = msg || ''; el.hidden = !msg; }
  function setLocation(loc, opts = {}) {
    showError('');
    state.lat = loc.lat; state.lon = Geo.norm180(loc.lon); state.grid = loc.grid || Geo.toGrid(loc.lat, loc.lon, 6); state.source = loc.source || 'coords';
    $('locInput').value = state.grid;
    view.setPoint(state.lat, state.lon, state.grid, opts);
    store.set('last', { lat: state.lat, lon: state.lon, grid: state.grid, source: state.source });
    try { if (location.hash.slice(1) !== state.grid) history.replaceState(null, '', '#' + state.grid); } catch (e) { /* sandboxed */ }
    renderPoint();
    refresh();
  }
  $('locForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try { const p = Geo.parse($('locInput').value); setLocation(p, { recenter: true }); }
    catch (err) { showError(err.message); }
  });
  $('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return showError('Location isn’t available on this device. Enter a grid square or coordinates instead.');
    $('gpsBtn').disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => { $('gpsBtn').disabled = false; setLocation({ lat: p.coords.latitude, lon: p.coords.longitude, source: 'gps' }); },
      () => { $('gpsBtn').disabled = false; showError('Location permission was refused or unavailable here. Enter a grid square or coordinates instead.'); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  window.addEventListener('hashchange', () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && h !== state.grid && Geo.isGrid(h)) { try { setLocation(Geo.parse(h)); } catch (e) { /* ignore */ } }
  });
  $('copyBtn').addEventListener('click', async () => {
    const txt = `${state.grid}  ${state.lat.toFixed(5)}, ${state.lon.toFixed(5)}`;
    try { await navigator.clipboard.writeText(txt); $('copyBtn').textContent = 'Copied'; }
    catch (e) { const i = $('locInput'); i.value = txt; i.select(); $('copyBtn').textContent = 'Selected'; }
    setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1600);
  });

  /* ---------- fetching ---------- */
  let timer = null;
  function schedule() { clearInterval(timer); if (+settings.refreshMin > 0) timer = setInterval(refresh, settings.refreshMin * 60000); }

  async function refresh() {
    if (state.lat == null) return;
    const { lat, lon } = state, seq = ++state.seq;
    const jobs = {
      wx: () => Sources.weather(lat, lon), marine: () => Sources.marine(lat, lon), aq: () => Sources.airQuality(lat, lon),
      nws: () => Sources.nws(lat, lon), metar: () => Sources.metar(lat, lon), buoy: () => Sources.buoy(lat, lon),
      wu: () => Sources.wunderground(lat, lon, settings.wuKey, settings.wuStation), sarg: () => Sources.sargassum(lat, lon),
    };
    for (const k of Object.keys(jobs)) state.status[k] = { state: 'loading', note: 'Fetching…' };
    renderCards();
    const keys = Object.keys(jobs);
    const res = await Promise.allSettled(keys.map((k) => jobs[k]()));
    if (seq !== state.seq) return;
    state.data = {}; state.sample = false;
    res.forEach((r, i) => {
      const k = keys[i];
      if (r.status === 'fulfilled') { state.data[k] = r.value; state.status[k] = { state: 'live', at: new Date() }; }
      else {
        const e = r.reason || {};
        state.status[k] = { state: e.off ? 'off' : e.soft ? 'na' : 'error', note: e.message || 'Failed' };
        if (!e.soft && !e.off && k === 'buoy' && !Sources.isNative()) state.status[k].note = 'NDBC needs the installed app (no browser access). ' + (e.message || '');
      }
    });
    // Nothing core reachable (offline or sandboxed preview): fall back to clearly-labelled sample readings.
    if (['wx', 'marine', 'aq'].every((k) => state.status[k].state === 'error')) {
      const s = EagleSample.build(); state.sample = true;
      const map = { wx: s.wx, marine: s.marine, aq: s.aq, metar: s.metar, buoy: s.buoy, sarg: s.sarg };
      for (const k of Object.keys(map)) {
        if (state.status[k].state !== 'error') continue;
        if (k === 'sarg' && !(lon >= -98 && lon <= -38 && lat >= 0 && lat <= 38)) continue;
        state.data[k] = map[k]; state.status[k] = { state: 'sample', note: 'Illustrative values' };
      }
    }
    if (state.sample) for (const k of keys) if (state.status[k].state === 'error') state.status[k] = { state: 'na', note: 'Not reachable from here. The installed app fetches this live.' };
    $('sampleBanner').hidden = !state.sample;
    state.drift = Sources.drift(lat, lon, state.data.wx, state.data.marine);
    view.drift = state.drift;
    view.vectors = {
      wind: state.data.wx && ok(state.data.wx.windDir) ? { dir: state.data.wx.windDir, spd: state.data.wx.windSpd } : null,
      current: state.data.marine && ok(state.data.marine.curDir) ? { dir: state.data.marine.curDir, spd: state.data.marine.curVel } : null,
    };
    view.invalidate();
    renderPoint(); renderCards();
    loadOverlays();
  }

  let overlayBusy = {};
  async function loadOverlays() {
    // Sargassum overlay
    if (view.layers.sarg && !view.overlays.sarg && !overlayBusy.sarg) {
      overlayBusy.sarg = true;
      try { const o = Sources.sargassumOverlayUrl(); const img = await Sources.loadImage(o.url, { knockOut: true }); view.setOverlay('sarg', img, o.bbox); view.sampleBlobs = null; state.sargOverlay = 'live'; }
      catch (e) { state.sargOverlay = 'error'; view.sampleBlobs = state.sample ? EagleSample.blobs() : null; view.invalidate(); }
      overlayBusy.sarg = false; layerNote();
    }
    // Satellite overlay
    if (view.layers.sat && !overlayBusy.sat && (!view.overlays.sat || view.overlays.sat.meta !== settings.satKind)) {
      overlayBusy.sat = true; state.status.sat = { state: 'loading', note: 'Fetching imagery…' }; renderSources();
      try {
        const o = Sources.satelliteUrl(settings.satKind);
        const img = await Sources.loadImage(o.url);
        view.setOverlay('sat', img, o.bbox, settings.satKind);
        state.status.sat = { state: 'live', at: new Date(), note: o.label }; state.satLabel = o.label;
      } catch (e) { state.status.sat = { state: 'error', note: 'Imagery could not load (' + e.message + ')' }; state.satLabel = null; }
      overlayBusy.sat = false; renderSources(); layerNote();
    }
    if (!view.layers.sat && !state.status.sat) state.status.sat = { state: 'off', note: 'Turn on the Satellite layer' };
  }
  function layerNote() {
    const bits = [];
    if (view.layers.sat) bits.push(state.satLabel ? 'Satellite: ' + state.satLabel + ' (NASA GIBS)' : 'Satellite: imagery unavailable here');
    if (view.layers.sarg) bits.push(state.sargOverlay === 'live' ? 'Sargassum: NOAA AOML/USF 7-day AFAI composite' : state.sample ? 'Sargassum: illustrative sample mats' : 'Sargassum map: unavailable');
    if (view.layers.drift && state.drift) bits.push('Drift: current + 3% wind leeway');
    $('layerNote').textContent = bits.join(' · ');
  }

  /* ---------- rendering ---------- */
  function renderPoint() {
    if (state.lat == null) return;
    const now = new Date();
    $('pGrid').textContent = state.grid;
    $('hudGrid').textContent = state.grid;
    $('pLat').textContent = Geo.fmtLat(state.lat);
    $('pLon').textContent = Geo.fmtLon(state.lon);
    $('pointSrc').textContent = { grid: 'from grid square', coords: 'from coordinates', map: 'picked on map', gps: 'from device location' }[state.source] || '';
    const el = Geo.solarElevation(state.lat, state.lon, now);
    $('pEl').textContent = el.toFixed(1) + '°';
    $('pPhase').textContent = Geo.daylightPhase(el);
    const ev = Geo.sunEvents(state.lat, state.lon, now);
    $('pRise').textContent = ev.rise ? pointTime(ev.rise) : 'none in 36 h';
    $('pSet').textContent = ev.set ? pointTime(ev.set) : 'none in 36 h';
    $('hudSun').textContent = (el >= 0 ? '+' : '') + el.toFixed(1) + '° ' + Geo.compass(Geo.solarAzimuth(state.lat, state.lon, now));
  }

  function stateTag(k) {
    const s = state.status[k] || { state: 'off' };
    const label = { live: 'Live', sample: 'Sample', error: 'Error', off: 'Off', na: 'N/A', loading: 'Loading' }[s.state];
    return `<span class="state ${s.state}">${label}</span>`;
  }
  function card(key, title, body, srcName) {
    return `<article class="card" data-k="${key}"><header><h2>${title}</h2><span class="src">${esc(srcName || '')} ${stateTag(key)}</span></header>${body}</article>`;
  }
  function unavailable(k) { const s = state.status[k] || {}; return `<p class="note">${esc(s.note || 'Not available')}</p>`; }

  function rose(dirDeg, mode) {
    // mode "from": arrow drawn from the source side toward the centre (wind). "to": arrow points the way water flows (current).
    const ticks = Array.from({ length: 36 }, (_, i) => { const a = i * 10 * Math.PI / 180, r1 = i % 9 === 0 ? 44 : 49; return `<line x1="${58 + Math.sin(a) * r1}" y1="${58 - Math.cos(a) * r1}" x2="${58 + Math.sin(a) * 53}" y2="${58 - Math.cos(a) * 53}" stroke="var(--line)" stroke-width="${i % 9 === 0 ? 2 : 1}"/>`; }).join('');
    const rot = mode === 'to' ? dirDeg + 180 : dirDeg;
    const color = mode === 'to' ? 'var(--drift)' : 'var(--accent)';
    const needle = ok(dirDeg) ? `<g transform="rotate(${rot} 58 58)"><line x1="58" y1="16" x2="58" y2="90" stroke="${color}" stroke-width="3" stroke-linecap="round"/><path d="M58 100 L50 84 L66 84 Z" fill="${color}"/><circle cx="58" cy="16" r="4" fill="none" stroke="${color}" stroke-width="2"/></g>` : '';
    return `<svg class="rose" viewBox="0 0 116 116" role="img" aria-label="${mode === 'to' ? 'Flowing toward' : 'From'} ${fx(dirDeg)} degrees">
      <circle cx="58" cy="58" r="53" fill="var(--space)" stroke="var(--line)"/>${ticks}
      <text x="58" y="11" text-anchor="middle" dy="3">N</text><text x="108" y="58" text-anchor="middle" dy="3">E</text><text x="58" y="108" text-anchor="middle" dy="3">S</text><text x="8" y="58" text-anchor="middle" dy="3">W</text>
      ${needle}<circle cx="58" cy="58" r="3" fill="var(--fg)"/></svg>`;
  }

  function spark(times, series, { hours = 24, fmt = (v) => v } = {}) {
    if (!times || !series.length) return '';
    const now = Date.now();
    let i0 = times.findIndex((t) => Date.parse(t) >= now - 3600000); if (i0 < 0) return '';
    const i1 = Math.min(times.length, i0 + hours + 1);
    const W = 300, H = 56, pad = 4;
    const vals = series.flatMap((s) => s.data.slice(i0, i1).filter(ok));
    if (!vals.length) return '';
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const n = i1 - i0, X = (i) => pad + (i / (n - 1)) * (W - pad * 2), Y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
    let svg = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Next ${hours} hours">`;
    for (let g = 1; g < 4; g++) svg += `<line x1="0" x2="${W}" y1="${(H / 4) * g}" y2="${(H / 4) * g}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    series.forEach((s, si) => {
      const pts = s.data.slice(i0, i1).map((v, i) => (ok(v) ? [X(i), Y(v)] : null)).filter(Boolean);
      if (!pts.length) return;
      const d = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
      if (si === 0) svg += `<path d="${d} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z" fill="${s.color}" opacity="0.14"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" vector-effect="non-scaling-stroke" ${si ? 'stroke-dasharray="4 3"' : ''}/>`;
      const last = pts[pts.length - 1]; svg += `<circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${s.color}"/>`;
    });
    svg += '</svg>';
    const legend = series.map((s) => `<span style="color:${s.color}">${s.name}</span>`).join(' · ');
    return svg + `<div class="spark-cap"><span>now</span><span>${legend} · ${fmt(lo)}–${fmt(hi)}</span><span>+${hours}h</span></div>`;
  }

  function renderCards() {
    const d = state.data, out = [];

    // Atmosphere
    const w = d.wx;
    out.push(card('wx', 'Atmosphere', w ? `
      <div class="hero"><div><span class="num">${fx(U.t(w.temp), 1)}</span><span class="unit">${U.tu()}</span></div>
        <div class="aside">Feels like ${fx(U.t(w.feels), 0)}${U.tu()}<br>Dew-point spread ${fx(U.dt(w.temp - w.dew), 1)}${U.tu()}</div></div>
      <dl class="kv cols3">
        <div><dt>Humidity</dt><dd>${fx(w.rh)}<small>%</small></dd></div>
        <div><dt>Dew point</dt><dd>${fx(U.t(w.dew), 1)}<small>${U.tu()}</small></dd></div>
        <div><dt>Pressure</dt><dd>${fx(U.p(w.pressure), U.pd())}<small> ${U.pu()}</small></dd></div>
        <div><dt>Visibility</dt><dd>${fx(U.vis(w.vis), 1)}<small> ${U.visu()}</small></dd></div>
        <div><dt>Precip</dt><dd>${fx(w.precip, 1)}<small> mm</small></dd></div>
        <div><dt>Cloud</dt><dd>${fx(w.cloud)}<small>%</small></dd></div>
      </dl>
      <div class="bars">${[['Low', w.cloudLow], ['Middle', w.cloudMid], ['High', w.cloudHigh]].map(([n, v]) => `<div class="bar-row"><span class="lab">${n} cloud</span><span class="track"><span class="fill" style="width:${ok(v) ? v : 0}%;display:block"></span></span><span class="val">${fx(v)}%</span></div>`).join('')}</div>
      ${w.hourly ? spark(w.hourly.time, [{ name: 'Temp', color: 'var(--accent)', data: w.hourly.temp.map(U.t) }, { name: 'Dew pt', color: 'var(--drift)', data: w.hourly.dew.map(U.t) }], { fmt: (v) => v.toFixed(0) + U.tu() }) : ''}
    ` : unavailable('wx'), 'Open-Meteo'));

    // Wind
    state.status.wind = state.status.wx; state.status.uv = state.status.wx;
    out.push(card('wind', 'Wind', w ? `
      <div class="windrow">${rose(w.windDir, 'from')}
        <div><div class="hero" style="margin:0 0 6px"><div><span class="num">${fx(U.w(w.windSpd), U.wd())}</span><span class="unit">${U.wu()}</span></div></div>
          <dl class="kv cols2">
            <div><dt>From</dt><dd>${fx(w.windDir)}° <small>${Geo.compass(w.windDir)}</small></dd></div>
            <div><dt>Gusts</dt><dd>${fx(U.w(w.gust), U.wd())}<small> ${U.wu()}</small></dd></div>
            <div style="grid-column:1/-1"><dt>Beaufort</dt><dd>Force ${fx(beaufort(w.windSpd))} <small>${BFT_NAME[beaufort(w.windSpd)] || ''}</small></dd></div>
          </dl></div></div>
      ${w.hourly ? spark(w.hourly.time, [{ name: 'Wind', color: 'var(--fg)', data: w.hourly.wind.map(U.w) }, { name: 'Gust', color: 'var(--accent)', data: (w.hourly.gust || []).map(U.w) }], { fmt: (v) => v.toFixed(0) + ' ' + U.wu() }) : ''}
    ` : unavailable('wx'), 'Open-Meteo'));

    // UV
    const uvNow = w ? w.uv : d.aq && d.aq.uv, uvMax = w && w.daily ? w.daily.uvMax : null;
    const [uvc, uvn] = uvLevel(uvNow);
    out.push(card('uv', 'UV exposure', (w || d.aq) ? `
      <div class="hero"><div><span class="num">${fx(uvNow, 1)}</span><span class="unit">UV index</span></div><div class="aside"><span class="pill ${uvc}">${uvn}</span></div></div>
      <div class="uvscale"><i style="left:${Math.min(100, (ok(uvNow) ? uvNow : 0) / 12 * 100)}%"></i></div>
      <div class="uvticks"><span>0</span><span>3</span><span>6</span><span>8</span><span>11+</span></div>
      <p class="note">Today’s peak ${fx(uvMax, 1)} (${uvLevel(uvMax)[1]}).${ok(uvMax) && uvMax >= 8 ? ' Unprotected skin can burn in about 15 minutes near midday.' : ''}</p>
      ${w && w.hourly ? spark(w.hourly.time, [{ name: 'UV', color: 'var(--sun)', data: w.hourly.uv }], { fmt: (v) => v.toFixed(0) }) : ''}
    ` : unavailable('wx'), 'Open-Meteo'));

    // Air quality
    const a = d.aq, [aqc, aqn] = aqiLevel(a && a.usAqi);
    out.push(card('aq', 'Air quality', a ? `
      <div class="hero"><div><span class="num">${fx(a.usAqi)}</span><span class="unit">US AQI</span></div><div class="aside"><span class="pill ${aqc}">${aqn}</span></div></div>
      <dl class="kv cols3">
        <div><dt>PM2.5</dt><dd>${fx(a.pm25, 1)}<small> µg/m³</small></dd></div>
        <div><dt>PM10</dt><dd>${fx(a.pm10, 1)}<small> µg/m³</small></dd></div>
        <div><dt>Ozone</dt><dd>${fx(a.o3)}<small> µg/m³</small></dd></div>
        <div><dt>NO₂</dt><dd>${fx(a.no2, 1)}<small> µg/m³</small></dd></div>
        <div><dt>SO₂</dt><dd>${fx(a.so2, 1)}<small> µg/m³</small></dd></div>
        <div><dt>Dust</dt><dd>${fx(a.dust)}<small> µg/m³</small></dd></div>
      </dl>
      ${ok(a.dust) && a.dust > 50 ? '<p class="note">Elevated Saharan dust is in the air.</p>' : ''}
    ` : unavailable('aq'), 'CAMS via Open-Meteo'));

    // Marine
    const m = d.marine, dr = state.drift;
    out.push(card('marine', 'Waves, current and drift', m ? `
      <div class="windrow">${rose(m.curDir, 'to')}
        <div><dl class="kv cols2">
          <div><dt>Waves</dt><dd>${fx(U.m(m.waveH), 1)}<small> ${U.mu()}</small></dd></div>
          <div><dt>Period</dt><dd>${fx(m.wavePer, 1)}<small> s</small></dd></div>
          <div><dt>From</dt><dd>${fx(m.waveDir)}° <small>${Geo.compass(m.waveDir)}</small></dd></div>
          <div><dt>Sea temp</dt><dd>${fx(U.t(m.sst), 1)}<small>${U.tu()}</small></dd></div>
          <div><dt>Current</dt><dd>${fx(U.w(m.curVel), 1)}<small> ${U.wu()}</small></dd></div>
          <div><dt>Setting</dt><dd>${fx(m.curDir)}° <small>${Geo.compass(m.curDir)}</small></dd></div>
        </dl></div></div>
      <dl class="kv cols3" style="margin-top:10px">
        <div><dt>Swell</dt><dd>${fx(U.m(m.swellH), 1)}<small> ${U.mu()}</small></dd></div>
        <div><dt>Swell period</dt><dd>${fx(m.swellPer, 1)}<small> s</small></dd></div>
        <div><dt>Wind waves</dt><dd>${fx(U.m(m.windWaveH), 1)}<small> ${U.mu()}</small></dd></div>
      </dl>
      ${dr ? `<p class="note">An object adrift here moves about <b>${fx(U.km(dr.km), 0)} ${U.kmu()}</b> toward <b>${fx(dr.brg)}° ${Geo.compass(dr.brg)}</b> in ${dr.hours} h (surface current plus 3% wind leeway). Track is on the map.</p>` : ''}
      ${m.hourly ? spark(m.hourly.time, [{ name: 'Wave ht', color: 'var(--drift)', data: m.hourly.waveH.map(U.m) }], { hours: 48, fmt: (v) => v.toFixed(1) + ' ' + U.mu() }) : ''}
    ` : unavailable('marine'), 'Open-Meteo marine'));

    // Sargassum
    const s = d.sarg;
    let sargBody = unavailable('sarg');
    if (s) {
      const lvl = !ok(s.coverPct) ? ['lvl-none', 'Cloud-obscured'] : s.coverPct === 0 ? ['lvl-good', 'None detected'] : s.coverPct < 2 ? ['lvl-moderate', 'Scattered'] : s.coverPct < 8 ? ['lvl-usg', 'Moderate'] : ['lvl-bad', 'Heavy'];
      sargBody = `
        <div class="hero"><div><span class="num">${fx(s.coverPct, 1)}</span><span class="unit">% of clear water</span></div><div class="aside"><span class="pill ${lvl[0]}">${lvl[1]}</span></div></div>
        <dl class="kv cols2">
          <div><dt>Nearest mat</dt><dd>${ok(s.nearestKm) ? fx(U.km(s.nearestKm), 0) + '<small> ' + U.kmu() + ' ' + Geo.compass(s.nearestBrg) + '</small>' : '—'}</dd></div>
          <div><dt>Peak AFAI</dt><dd>${ok(s.maxAfai) ? (s.maxAfai * 1000).toFixed(2) + '<small> ×10⁻³</small>' : '—'}</dd></div>
          <div><dt>Search radius</dt><dd>${fx(U.km(s.windowKm), 0)}<small> ${U.kmu()}</small></dd></div>
          <div><dt>Composite ending</dt><dd>${s.time ? s.time.toISOString().slice(0, 10) : '—'}</dd></div>
        </dl>
        <p class="note">Floating algae detected by satellite over the past 7 days. Pixels under cloud are excluded.</p>`;
    }
    out.push(card('sarg', 'Sargassum', sargBody, 'NOAA AOML / USF'));

    // Aviation
    const mt = d.metar;
    out.push(card('metar', 'Aviation', mt ? `
      <div class="hero"><div><span class="num" style="font-size:30px">${esc(mt.id)}</span></div><div class="aside">${esc(mt.name || '')}<br>${fx(U.km(mt.distKm), 0)} ${U.kmu()} ${Geo.compass(mt.brg)} · ${mt.obsTime ? mt.obsTime.toISOString().slice(11, 16) + 'Z' : ''}</div>
        ${mt.cat ? `<span class="pill ${CAT[mt.cat] || 'lvl-none'}">${esc(mt.cat)}</span>` : ''}</div>
      <dl class="kv cols3">
        <div><dt>Wind</dt><dd>${fx(mt.wdir)}°/${fx(mt.wspd)}<small>kt</small>${ok(mt.wgst) ? '<small> G' + mt.wgst + '</small>' : ''}</dd></div>
        <div><dt>Temp / dew</dt><dd>${fx(U.t(mt.temp))}/${fx(U.t(mt.dewp))}<small>${U.tu()}</small></dd></div>
        <div><dt>Altimeter</dt><dd>${fx(U.p(mt.altim), U.pd())}<small> ${U.pu()}</small></dd></div>
      </dl>
      <pre class="raw">${esc(mt.raw || '')}</pre>
    ` : unavailable('metar'), 'aviationweather.gov'));

    // Buoy
    const b = d.buoy;
    out.push(card('buoy', 'Marine station', b ? `
      <div class="hero"><div><span class="num" style="font-size:30px">${esc(b.id)}</span></div><div class="aside">${esc(b.name || '')}<br>${fx(U.km(b.distKm), 0)} ${U.kmu()} ${Geo.compass(b.brg)} · ${b.time && !isNaN(b.time) ? b.time.toISOString().slice(11, 16) + 'Z' : ''}</div></div>
      <dl class="kv cols3">
        <div><dt>Wind</dt><dd>${fx(b.wdir)}°/${fx(U.w(ok(b.wspd) ? b.wspd * 3.6 : null), U.wd())}<small> ${U.wu()}</small></dd></div>
        <div><dt>Gust</dt><dd>${fx(U.w(ok(b.gst) ? b.gst * 3.6 : null), U.wd())}<small> ${U.wu()}</small></dd></div>
        <div><dt>Sig. wave</dt><dd>${fx(U.m(b.wvht), 1)}<small> ${U.mu()}</small></dd></div>
        <div><dt>Dom. period</dt><dd>${fx(b.dpd)}<small> s</small></dd></div>
        <div><dt>Water</dt><dd>${fx(U.t(b.wtmp), 1)}<small>${U.tu()}</small></dd></div>
        <div><dt>Pressure</dt><dd>${fx(U.p(b.pres), U.pd())}<small> ${U.pu()}</small></dd></div>
      </dl>` : unavailable('buoy'), 'NOAA NDBC'));

    // NWS
    const n = d.nws;
    out.push(card('nws', 'NWS forecast', n ? `
      ${n.alerts.map((x) => `<div class="alert"><b>${esc(x.event)}</b> · ${esc(x.severity)}<br>${esc(x.headline || '')}</div>`).join('')}
      ${n.forecast.map((f) => `<div class="fc"><b>${esc(f.name)}</b><span class="t">${esc(f.temp)}°${esc(f.unit)}</span><span>${esc(f.short)}</span><span class="t">${esc(f.wind)}</span></div>`).join('')}
      <p class="note">Office ${esc(n.office)}${n.place ? ' · near ' + esc(n.place) : ''}</p>
    ` : unavailable('nws'), 'api.weather.gov'));

    // Wunderground
    const u = d.wu;
    out.push(card('wu', 'Personal weather station', u ? `
      <div class="hero"><div><span class="num">${fx(U.t(u.temp), 1)}</span><span class="unit">${U.tu()}</span></div><div class="aside">${esc(u.stationId)}${u.neighborhood ? ' · ' + esc(u.neighborhood) : ''}<br>${fx(U.km(u.distKm), 1)} ${U.kmu()} away</div></div>
      <dl class="kv cols3">
        <div><dt>Humidity</dt><dd>${fx(u.rh)}<small>%</small></dd></div>
        <div><dt>Dew point</dt><dd>${fx(U.t(u.dew), 1)}<small>${U.tu()}</small></dd></div>
        <div><dt>Wind</dt><dd>${fx(U.w(u.windSpd), U.wd())}<small> ${U.wu()} ${Geo.compass(u.windDir)}</small></dd></div>
        <div><dt>Gust</dt><dd>${fx(U.w(u.gust), U.wd())}<small> ${U.wu()}</small></dd></div>
        <div><dt>UV</dt><dd>${fx(u.uv, 1)}</dd></div>
        <div><dt>Solar</dt><dd>${fx(u.solar)}<small> W/m²</small></dd></div>
      </dl>` : unavailable('wu'), 'Weather Underground'));

    $('cards').innerHTML = out.join('') + '<article class="card" id="srcCard"></article>';
    renderSources();
    layerNote();
  }

  function renderSources() {
    const el = $('srcCard'); if (!el) return;
    const rows = SOURCES.map((s) => {
      const st = state.status[s.key] || { state: 'off', note: s.key === 'sat' ? 'Turn on the Satellite layer' : '' };
      const at = st.at ? ' · ' + st.at.toTimeString().slice(0, 5) : '';
      return `<li><span>${esc(s.name)}</span>${stateTag(s.key)}<span class="why">${esc(st.state === 'live' && !st.note ? s.what : (st.note || s.what))}${at}</span></li>`;
    }).join('');
    el.innerHTML = `<header><h2>Data sources</h2><span class="src">${Sources.isNative() ? 'native network' : 'browser network'}</span></header><ul class="srclist">${rows}</ul>`;
  }

  /* ---------- settings ---------- */
  const dlg = $('settings');
  $('settingsBtn').addEventListener('click', () => {
    $('uTemp').value = settings.temp; $('uWind').value = settings.wind; $('uLen').value = settings.len; $('uPres').value = settings.pres;
    $('satKind').value = settings.satKind; $('wuKey').value = settings.wuKey; $('wuStation').value = settings.wuStation; $('refreshMin').value = String(settings.refreshMin);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const prevWu = settings.wuKey + '|' + settings.wuStation, prevSat = settings.satKind;
    Object.assign(settings, {
      temp: $('uTemp').value, wind: $('uWind').value, len: $('uLen').value, pres: $('uPres').value, satKind: $('satKind').value,
      wuKey: $('wuKey').value.trim(), wuStation: $('wuStation').value.trim().toUpperCase(), refreshMin: +$('refreshMin').value,
    });
    store.set('settings', settings);
    schedule(); renderCards();
    if (prevWu !== settings.wuKey + '|' + settings.wuStation) refresh();
    if (prevSat !== settings.satKind && view.layers.sat) loadOverlays();
  });
  $('refreshBtn').addEventListener('click', () => { view.overlays.sarg = null; view.overlays.sat = null; view.rasterKey = ''; refresh(); });

  /* ---------- clock ---------- */
  function tick() {
    const now = new Date();
    $('hudUtc').textContent = now.toISOString().slice(11, 19);
    $('hudLocal').textContent = state.lat == null ? '--:--' : pointTime(now, false);
    $('hudLocal').title = tzLabel();
  }
  setInterval(tick, 1000); tick();
  setInterval(() => { view.invalidate(); renderPoint(); }, 60000);

  /* ---------- start ---------- */
  let start = null;
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && Geo.isGrid(h)) { try { start = Geo.parse(h); } catch (e) { start = null; } }
  if (!start) start = store.get('last', null);
  if (!start) { const s = EagleSample.home; start = { lat: s.lat, lon: s.lon, grid: Geo.toGrid(s.lat, s.lon, 6), source: 'coords' }; }
  setLocation(start, { recenter: true });
  schedule();
})();
