/* Eagle — data sources. Every fetcher returns a normalized object or throws.
 * In the desktop app (Electron) and phone apps (Capacitor) requests go through the
 * native layer, so sources without browser CORS headers (NDBC, some NOAA endpoints) work too. */
(function () {
  const TIMEOUT_MS = 15000;
  const isNative = () => !!(window.eagleNative || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));

  async function get(url, type = 'json') {
    if (window.eagleNative) {
      const r = await window.eagleNative.fetch(url, type);
      if (!r || !r.ok) throw new Error(r && r.status ? 'HTTP ' + r.status : (r && r.error) || 'Network error');
      return r.data;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: type === 'json' ? { Accept: 'application/geo+json, application/json' } : {} });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      if (res.status === 204) return type === 'json' ? [] : '';
      if (type === 'json') return await res.json();
      if (type === 'dataurl') {
        const blob = await res.blob();
        return await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = bad; fr.readAsDataURL(blob); });
      }
      return await res.text();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timed out');
      if (e instanceof TypeError) throw new Error('Blocked or offline');
      throw e;
    } finally { clearTimeout(timer); }
  }

  const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const f4 = (n) => (+n).toFixed(4);

  /* ---- Open-Meteo forecast (NOAA GFS/HRRR blended with other national models) ---- */
  async function weather(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?' + q({
      latitude: f4(lat), longitude: f4(lon), timezone: 'auto', forecast_days: 3, wind_speed_unit: 'kmh',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,uv_index,visibility,is_day',
      hourly: 'temperature_2m,dew_point_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
      daily: 'sunrise,sunset,uv_index_max',
    });
    const j = await get(url);
    const c = j.current || {};
    return {
      temp: c.temperature_2m, feels: c.apparent_temperature, rh: c.relative_humidity_2m, dew: c.dew_point_2m,
      cloud: c.cloud_cover, cloudLow: c.cloud_cover_low, cloudMid: c.cloud_cover_mid, cloudHigh: c.cloud_cover_high,
      windSpd: c.wind_speed_10m, windDir: c.wind_direction_10m, gust: c.wind_gusts_10m,
      pressure: c.pressure_msl, precip: c.precipitation, uv: c.uv_index, vis: c.visibility, isDay: c.is_day,
      time: c.time, tz: j.timezone, utcOffset: j.utc_offset_seconds,
      hourly: j.hourly ? {
        time: j.hourly.time, temp: j.hourly.temperature_2m, dew: j.hourly.dew_point_2m, rh: j.hourly.relative_humidity_2m,
        cloud: j.hourly.cloud_cover, wind: j.hourly.wind_speed_10m, windDir: j.hourly.wind_direction_10m, gust: j.hourly.wind_gusts_10m, uv: j.hourly.uv_index,
      } : null,
      daily: j.daily ? { uvMax: j.daily.uv_index_max && j.daily.uv_index_max[0] } : null,
    };
  }

  /* ---- Open-Meteo marine: waves, swell, ocean currents, sea surface temperature ---- */
  async function marine(lat, lon) {
    const url = 'https://marine-api.open-meteo.com/v1/marine?' + q({
      latitude: f4(lat), longitude: f4(lon), timezone: 'auto', forecast_days: 3,
      current: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,ocean_current_velocity,ocean_current_direction,sea_surface_temperature',
      hourly: 'wave_height,ocean_current_velocity,ocean_current_direction',
    });
    const j = await get(url);
    const c = j.current || {};
    if (c.wave_height == null && c.ocean_current_velocity == null && c.sea_surface_temperature == null) {
      const e = new Error('No marine data at this point (on land?)'); e.soft = true; throw e;
    }
    return {
      waveH: c.wave_height, waveDir: c.wave_direction, wavePer: c.wave_period,
      swellH: c.swell_wave_height, swellDir: c.swell_wave_direction, swellPer: c.swell_wave_period, windWaveH: c.wind_wave_height,
      curVel: c.ocean_current_velocity, curDir: c.ocean_current_direction, sst: c.sea_surface_temperature,
      hourly: j.hourly ? { time: j.hourly.time, waveH: j.hourly.wave_height, curVel: j.hourly.ocean_current_velocity, curDir: j.hourly.ocean_current_direction } : null,
    };
  }

  /* ---- Open-Meteo air quality (CAMS) ---- */
  async function airQuality(lat, lon) {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?' + q({
      latitude: f4(lat), longitude: f4(lon), timezone: 'auto',
      current: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust,uv_index',
    });
    const c = (await get(url)).current || {};
    return { usAqi: c.us_aqi, euAqi: c.european_aqi, pm25: c.pm2_5, pm10: c.pm10, o3: c.ozone, no2: c.nitrogen_dioxide, so2: c.sulphur_dioxide, co: c.carbon_monoxide, dust: c.dust, uv: c.uv_index };
  }

  /* ---- NOAA National Weather Service (US territory only) ---- */
  async function nws(lat, lon) {
    let pt;
    try { pt = await get(`https://api.weather.gov/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`); }
    catch (e) { if (/HTTP 404/.test(e.message)) { const s = new Error('Outside NWS coverage (US only)'); s.soft = true; throw s; } throw e; }
    const p = pt.properties || {};
    const [fc, al] = await Promise.allSettled([
      p.forecast ? get(p.forecast) : Promise.reject(new Error('No forecast')),
      get(`https://api.weather.gov/alerts/active?point=${(+lat).toFixed(4)},${(+lon).toFixed(4)}`),
    ]);
    return {
      office: p.cwa, place: p.relativeLocation && p.relativeLocation.properties ? p.relativeLocation.properties.city + ', ' + p.relativeLocation.properties.state : '',
      forecast: fc.status === 'fulfilled' ? (fc.value.properties.periods || []).slice(0, 4).map((x) => ({ name: x.name, short: x.shortForecast, temp: x.temperature, unit: x.temperatureUnit, wind: (x.windSpeed || '') + ' ' + (x.windDirection || '') })) : [],
      alerts: al.status === 'fulfilled' ? (al.value.features || []).map((f) => ({ event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline, ends: f.properties.ends })) : [],
    };
  }

  /* ---- Aviation: nearest METAR from NOAA Aviation Weather Center ---- */
  async function metar(lat, lon) {
    for (const pad of [1.5, 4, 8]) {
      const bbox = [lat - pad, lon - pad, lat + pad, lon + pad].map((v) => v.toFixed(2)).join(',');
      let list;
      try { list = await get(`https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json&hours=2`); }
      catch (e) { if (/HTTP 204/.test(e.message)) list = []; else throw e; }
      if (Array.isArray(list) && list.length) {
        const best = list.map((m) => ({ m, d: Geo.distanceKm(lat, lon, m.lat, m.lon) })).sort((a, b) => a.d - b.d)[0];
        const m = best.m;
        return {
          id: m.icaoId, name: m.name, raw: m.rawOb, temp: m.temp, dewp: m.dewp, wdir: m.wdir, wspd: m.wspd, wgst: m.wgst,
          visib: m.visib, altim: m.altim, cat: m.fltCat, distKm: best.d, brg: Geo.bearing(lat, lon, m.lat, m.lon),
          obsTime: m.obsTime ? new Date(m.obsTime * 1000) : (m.reportTime ? new Date(m.reportTime) : null), clouds: m.clouds,
        };
      }
    }
    const e = new Error('No reporting airfield within ~900 km'); e.soft = true; throw e;
  }

  /* ---- NOAA NDBC: nearest moored buoy / C-MAN station ---- */
  let ndbcStations = null;
  async function buoy(lat, lon) {
    if (!ndbcStations) {
      const xml = await get('https://www.ndbc.noaa.gov/activestations.xml', 'text');
      ndbcStations = [];
      const re = /<station\s+([^>]+?)\/?>/g; let m;
      while ((m = re.exec(xml))) {
        const a = {}; m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { a[k] = v; });
        if (a.met === 'y' && a.lat && a.lon) ndbcStations.push({ id: a.id, name: a.name, lat: +a.lat, lon: +a.lon });
      }
    }
    const near = ndbcStations.map((s) => ({ s, d: Geo.distanceKm(lat, lon, s.lat, s.lon) })).filter((x) => x.d < 600).sort((a, b) => a.d - b.d).slice(0, 4);
    if (!near.length) { const e = new Error('No NDBC station within 600 km'); e.soft = true; throw e; }
    for (const { s, d } of near) {
      try {
        const txt = await get(`https://www.ndbc.noaa.gov/data/realtime2/${s.id.toUpperCase()}.txt`, 'text');
        const lines = txt.split('\n').filter(Boolean);
        const head = lines[0].replace(/^#/, '').trim().split(/\s+/);
        const row = lines[2].trim().split(/\s+/);
        const v = (k) => { const i = head.indexOf(k); if (i < 0) return null; const x = row[i]; return x === 'MM' || x == null ? null : +x; };
        return {
          id: s.id.toUpperCase(), name: s.name, distKm: d, brg: Geo.bearing(lat, lon, s.lat, s.lon), lat: s.lat, lon: s.lon,
          time: new Date(Date.UTC(v('YY'), v('MM') - 1, v('DD'), v('hh'), v('mm'))),
          wdir: v('WDIR'), wspd: v('WSPD'), gst: v('GST'), wvht: v('WVHT'), dpd: v('DPD'), mwd: v('MWD'), pres: v('PRES'), atmp: v('ATMP'), wtmp: v('WTMP'), dewp: v('DEWP'),
        };
      } catch (e) { /* try the next station */ }
    }
    throw new Error('Nearby stations have no recent report');
  }

  /* ---- Weather Underground personal weather stations (needs your API key) ---- */
  async function wunderground(lat, lon, key, stationId) {
    if (!key) { const e = new Error('Add your Weather Underground API key in Settings'); e.off = true; throw e; }
    let sid = stationId;
    if (!sid) {
      const near = await get(`https://api.weather.com/v3/location/near?geocode=${(+lat).toFixed(3)},${(+lon).toFixed(3)}&product=pws&format=json&apiKey=${encodeURIComponent(key)}`);
      sid = near && near.location && near.location.stationId && near.location.stationId[0];
      if (!sid) throw new Error('No personal weather station nearby');
    }
    const j = await get(`https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(sid)}&format=json&units=m&numericPrecision=decimal&apiKey=${encodeURIComponent(key)}`);
    const o = j.observations && j.observations[0];
    if (!o) throw new Error('Station ' + sid + ' sent no observation');
    const m = o.metric || {};
    return {
      stationId: o.stationID, neighborhood: o.neighborhood, obsTime: new Date(o.obsTimeUtc), distKm: Geo.distanceKm(lat, lon, o.lat, o.lon),
      temp: m.temp, dew: m.dewpt, rh: o.humidity, windSpd: m.windSpeed, gust: m.windGust, windDir: o.winddir, pressure: m.pressure, uv: o.uv, solar: o.solarRadiation, precipRate: m.precipRate,
    };
  }

  /* ---- Sargassum: NOAA AOML / USF Alternative Floating Algae Index, 7-day composite ---- */
  const AFAI = { ds: 'noaa_aoml_atlantic_oceanwatch_AFAI_7D', host: 'https://cwcgom.aoml.noaa.gov/erddap/griddap/', bbox: [-98, 0, -38, 38], threshold: 0.00015 };
  const inAfai = (lat, lon) => lon >= AFAI.bbox[0] && lon <= AFAI.bbox[2] && lat >= AFAI.bbox[1] && lat <= AFAI.bbox[3];
  async function sargassum(lat, lon) {
    if (!inAfai(lat, lon)) { const e = new Error('Satellite sargassum coverage is the tropical Atlantic, Caribbean and Gulf (0–38°N, 38–98°W)'); e.soft = true; throw e; }
    const pad = 1.0;
    const la0 = Math.max(0, lat - pad).toFixed(3), la1 = Math.min(38, lat + pad).toFixed(3);
    const lo0 = Math.max(-98, lon - pad).toFixed(3), lo1 = Math.min(-38, lon + pad).toFixed(3);
    const j = await get(`${AFAI.host}${AFAI.ds}.json?AFAI%5B(last)%5D%5B(${la0}):6:(${la1})%5D%5B(${lo0}):6:(${lo1})%5D`);
    const rows = (j.table && j.table.rows) || [];
    let valid = 0, hits = 0, max = -Infinity, nearest = null, time = rows[0] && rows[0][0];
    for (const [, la, lo, v] of rows) {
      if (v == null || isNaN(v)) continue;
      valid++; if (v > max) max = v;
      if (v > AFAI.threshold) {
        hits++;
        const d = Geo.distanceKm(lat, lon, la, lo);
        if (!nearest || d < nearest.d) nearest = { d, brg: Geo.bearing(lat, lon, la, lo) };
      }
    }
    return {
      time: time ? new Date(time) : null, valid, hits, coverPct: valid ? (hits / valid) * 100 : null, maxAfai: valid ? max : null,
      nearestKm: nearest ? nearest.d : null, nearestBrg: nearest ? nearest.brg : null, windowKm: Math.round(pad * 111),
    };
  }
  function sargassumOverlayUrl() {
    // Rendered by ERDDAP as an equirectangular transparent PNG over the dataset extent.
    const cb = encodeURIComponent('Rainbow|C|Linear|0.00015|0.003|');
    return { url: `${AFAI.host}${AFAI.ds}.transparentPng?AFAI%5B(last)%5D%5B(0.0):3:(38.0)%5D%5B(-98.0):3:(-38.0)%5D&.colorBar=${cb}`, bbox: AFAI.bbox };
  }

  /* ---- NASA GIBS satellite imagery (equirectangular WMS) ---- */
  function satelliteUrl(kind) {
    const base = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=2048&HEIGHT=1024&STYLES=';
    if (kind === 'ir') {
      const t = new Date(Date.now() - 40 * 60000); t.setUTCSeconds(0, 0); t.setUTCMinutes(t.getUTCMinutes() - (t.getUTCMinutes() % 10));
      const ts = t.toISOString().slice(0, 16) + ':00Z';
      return { url: `${base}&LAYERS=GOES-West_ABI_Band13_Clean_Infrared,GOES-East_ABI_Band13_Clean_Infrared&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${ts}`, bbox: [-180, -90, 180, 90], label: 'GOES-East + West infrared clouds, ' + ts.replace('T', ' ').replace(':00Z', ' UTC') };
    }
    const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return { url: `${base}&LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor&FORMAT=image/jpeg&TIME=${d}`, bbox: [-180, -90, 180, 90], label: 'NOAA-20 VIIRS true color, ' + d };
  }

  /** Loads an overlay image. Returns an HTMLImageElement whose pixels are readable. */
  async function loadImage(url, { knockOut = false } = {}) {
    let src = url, cors = true;
    if (isNative()) { try { src = await get(url, 'dataurl'); cors = false; } catch (e) { src = url; } }
    const img = await new Promise((ok, bad) => {
      const im = new Image(); if (cors) im.crossOrigin = 'anonymous';
      im.onload = () => ok(im); im.onerror = () => bad(new Error('Image did not load'));
      im.src = src;
    });
    if (!knockOut) return img;
    // ERDDAP paints the lowest palette colour over clear water; make the most common colour transparent.
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    try {
      const id = x.getImageData(0, 0, c.width, c.height), d = id.data, counts = new Map();
      for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
      let top = null, n = 0; counts.forEach((v, k) => { if (v > n) { n = v; top = k; } });
      if (top != null) for (let i = 0; i < d.length; i += 4) if (((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) === top) d[i + 3] = 0;
      x.putImageData(id, 0, 0);
    } catch (e) { /* tainted canvas: draw as-is */ }
    return c;
  }

  /* ---- Drift projection: surface current plus 3% wind leeway, hourly steps ---- */
  function drift(lat, lon, wx, mar, hours = 48, leeway = 0.03) {
    if (!mar || !mar.hourly || !mar.hourly.time) return null;
    const now = Date.now();
    const mh = mar.hourly, wh = wx && wx.hourly;
    let i0 = mh.time.findIndex((t) => Date.parse(t) >= now - 3600000); if (i0 < 0) i0 = 0;
    const pts = [{ lat, lon, h: 0 }];
    let p = { lat, lon };
    for (let h = 0; h < hours && i0 + h < mh.time.length; h++) {
      const cv = mh.curVel[i0 + h], cd = mh.curDir[i0 + h];
      let vx = 0, vy = 0;
      if (cv != null && cd != null) { vx += cv * Math.sin(cd * Geo.RAD); vy += cv * Math.cos(cd * Geo.RAD); }
      if (wh && wh.wind) {
        const wi = wh.time.indexOf(mh.time[i0 + h]);
        if (wi >= 0 && wh.wind[wi] != null) { const to = (wh.windDir[wi] + 180) * Geo.RAD; vx += leeway * wh.wind[wi] * Math.sin(to); vy += leeway * wh.wind[wi] * Math.cos(to); }
      }
      const spd = Math.hypot(vx, vy); // km per hour
      if (spd > 0) p = Geo.destination(p.lat, p.lon, Geo.norm360(Math.atan2(vx, vy) * Geo.DEG), spd);
      pts.push({ lat: p.lat, lon: p.lon, h: h + 1 });
    }
    const end = pts[pts.length - 1];
    return { pts, hours: end.h, km: Geo.distanceKm(lat, lon, end.lat, end.lon), brg: Geo.bearing(lat, lon, end.lat, end.lon) };
  }

  window.Sources = { get, isNative, weather, marine, airQuality, nws, metar, buoy, wunderground, sargassum, sargassumOverlayUrl, satelliteUrl, loadImage, drift, AFAI };
})();
