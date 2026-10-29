/* Eagle — geodesy, Maidenhead grid squares and solar geometry */
(function () {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const norm180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  const norm360 = (x) => ((x % 360) + 360) % 360;

  /* ---------- Maidenhead locator ---------- */
  function toGrid(lat, lon, precision = 6) {
    lat = Math.max(-90, Math.min(89.999999, lat));
    lon = norm180(lon);
    if (lon === 180) lon = -180;
    let L = lon + 180, A = lat + 90;
    let s = String.fromCharCode(65 + Math.floor(L / 20)) + String.fromCharCode(65 + Math.floor(A / 10));
    L %= 20; A %= 10;
    s += Math.floor(L / 2) + '' + Math.floor(A);
    if (precision >= 6) {
      L %= 2; A %= 1;
      s += String.fromCharCode(97 + Math.min(23, Math.floor(L * 12))) + String.fromCharCode(97 + Math.min(23, Math.floor(A * 24)));
      if (precision >= 8) {
        L %= 1 / 12; A %= 1 / 24;
        s += Math.min(9, Math.floor(L * 120)) + '' + Math.min(9, Math.floor(A * 240));
      }
    }
    return s;
  }

  const GRID_RE = /^([A-R]{2})(\d{2})?([A-X]{2})?(\d{2})?$/i;
  function isGrid(s) {
    const m = String(s).trim().match(GRID_RE);
    if (!m) return false;
    // digits only valid after field, subsquare only after square, extended only after subsquare
    if (m[3] && !m[2]) return false;
    if (m[4] && !m[3]) return false;
    return true;
  }
  function fromGrid(s) {
    s = String(s).trim();
    if (!isGrid(s)) throw new Error('Not a Maidenhead grid square');
    const u = s.toUpperCase();
    let lon = -180 + (u.charCodeAt(0) - 65) * 20, lat = -90 + (u.charCodeAt(1) - 65) * 10, dlon = 20, dlat = 10;
    if (u.length >= 4) { lon += +u[2] * 2; lat += +u[3]; dlon = 2; dlat = 1; }
    if (u.length >= 6) { lon += (u.charCodeAt(4) - 65) / 12; lat += (u.charCodeAt(5) - 65) / 24; dlon = 1 / 12; dlat = 1 / 24; }
    if (u.length >= 8) { lon += (+u[6]) / 120; lat += (+u[7]) / 240; dlon = 1 / 120; dlat = 1 / 240; }
    return { lat: lat + dlat / 2, lon: lon + dlon / 2, bounds: [lon, lat, lon + dlon, lat + dlat] };
  }

  /* ---------- Coordinate parsing ---------- */
  function parseNumber(part) {
    // decimal or DMS like 13°06'30"N or 13 06 30 N or -59.6
    const hemi = (part.match(/[NSEW]/i) || [''])[0].toUpperCase();
    const nums = (part.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    let v = Math.abs(nums[0]) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
    if (nums[0] < 0 || hemi === 'S' || hemi === 'W') v = -v;
    return { v, hemi };
  }
  function parse(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('Enter a grid square (e.g. GK03) or latitude, longitude');
    const compact = raw.replace(/\s+/g, '');
    if (isGrid(compact)) {
      const g = fromGrid(compact);
      return { lat: g.lat, lon: g.lon, grid: compact.slice(0, 2).toUpperCase() + compact.slice(2, 4) + compact.slice(4, 6).toLowerCase() + compact.slice(6), source: 'grid' };
    }
    // split into two coordinate parts
    let parts;
    if (raw.includes(',')) parts = raw.split(',');
    else {
      const m = raw.match(/^(.*?[NS])\s*(.*[EW])$/i);
      parts = m ? [m[1], m[2]] : raw.split(/\s+/);
    }
    if (parts.length !== 2) throw new Error('Could not read that. Try "13.10, -59.61", "13.1N 59.6W" or a grid square like GK03');
    let a = parseNumber(parts[0]), b = parseNumber(parts[1]);
    if (!a || !b) throw new Error('Could not read the numbers in that position');
    if ('EW'.includes(a.hemi) && a.hemi && 'NS'.includes(b.hemi) && b.hemi) [a, b] = [b, a];
    const lat = a.v, lon = b.v;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Latitude must be within ±90 and longitude within ±180');
    return { lat, lon, grid: toGrid(lat, lon, 6), source: 'coords' };
  }

  function fmtLat(v) { return Math.abs(v).toFixed(3) + '°' + (v >= 0 ? 'N' : 'S'); }
  function fmtLon(v) { return Math.abs(v).toFixed(3) + '°' + (v >= 0 ? 'E' : 'W'); }

  /* ---------- Spherical helpers ---------- */
  const R_KM = 6371.0088;
  function distanceKm(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    return norm360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * DEG);
  }
  function destination(lat, lon, brgDeg, km) {
    const d = km / R_KM, b = brgDeg * RAD, p1 = lat * RAD, l1 = lon * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * DEG, lon: norm180(l2 * DEG) };
  }
  const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) { return deg == null || isNaN(deg) ? '—' : POINTS[Math.round(norm360(deg) / 22.5) % 16]; }

  /* ---------- Sun ---------- */
  function sun(date = new Date()) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const g = norm360(357.529 + 0.98560028 * d) * RAD;
    const L = norm360(280.459 + 0.98564736 * d);
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const eps = (23.439 - 0.00000036 * d) * RAD;
    const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG;
    const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG);
    const gmst = norm360((18.697374558 + 24.06570982441908 * d) * 15);
    const lon = norm180(ra - gmst);
    return { lat: decl, lon, decl, ra, gmst };
  }
  function solarElevation(lat, lon, date = new Date()) {
    const s = sun(date);
    const H = (s.gmst + lon - s.ra) * RAD;
    const sinEl = Math.sin(lat * RAD) * Math.sin(s.decl * RAD) + Math.cos(lat * RAD) * Math.cos(s.decl * RAD) * Math.cos(H);
    return Math.asin(sinEl) * DEG;
  }
  function solarAzimuth(lat, lon, date = new Date()) {
    const s = sun(date);
    return bearing(lat, lon, s.lat, s.lon);
  }
  /** Next sunrise / sunset within 36h, scanning by 2-minute steps then bisecting. */
  function sunEvents(lat, lon, from = new Date()) {
    const h0 = -0.833, out = { rise: null, set: null };
    let t = from.getTime(), prev = solarElevation(lat, lon, new Date(t)) - h0;
    for (let i = 1; i <= 36 * 30 && (!out.rise || !out.set); i++) {
      const tn = t + 120000, cur = solarElevation(lat, lon, new Date(tn)) - h0;
      if ((prev < 0) !== (cur < 0)) {
        let a = t, b = tn;
        for (let k = 0; k < 12; k++) { const m = (a + b) / 2; const v = solarElevation(lat, lon, new Date(m)) - h0; if ((v < 0) === (prev < 0)) a = m; else b = m; }
        const when = new Date((a + b) / 2);
        if (cur > 0 && !out.rise) out.rise = when;
        if (cur < 0 && !out.set) out.set = when;
      }
      t = tn; prev = cur;
    }
    return out;
  }
  /** Local apparent solar time at a longitude, in hours 0..24 */
  function solarHour(lon, date = new Date()) {
    const s = sun(date);
    return norm360(lon - s.lon + 180) / 15;
  }
  function daylightPhase(el) {
    if (el > 0) return 'Day';
    if (el > -6) return 'Civil twilight';
    if (el > -12) return 'Nautical twilight';
    if (el > -18) return 'Astronomical twilight';
    return 'Night';
  }

  window.Geo = {
    RAD, DEG, norm180, norm360, toGrid, fromGrid, isGrid, parse, fmtLat, fmtLon,
    distanceKm, bearing, destination, compass, sun, solarElevation, solarAzimuth, sunEvents, solarHour, daylightPhase,
  };
})();
