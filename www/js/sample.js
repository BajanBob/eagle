/* Eagle — sample readings used only when live feeds cannot be reached (offline, or a sandboxed preview).
 * Values are illustrative for Bridgetown, Barbados in late October and are always labelled "Sample" in the UI. */
(function () {
  function hours(n) {
    const t0 = new Date(); t0.setMinutes(0, 0, 0); t0.setHours(t0.getHours() - 1);
    return Array.from({ length: n }, (_, i) => new Date(t0.getTime() + i * 3600000).toISOString().slice(0, 16));
  }
  function build() {
    const time = hours(72);
    const hr = time.map((t) => new Date(t + 'Z').getUTCHours() - 4);
    const diurnal = (h) => Math.sin(((h - 9) / 24) * 2 * Math.PI);
    const wx = {
      temp: 27.6, feels: 31.2, rh: 78, dew: 23.5, cloud: 38, cloudLow: 30, cloudMid: 12, cloudHigh: 20,
      windSpd: 24, windDir: 92, gust: 37, pressure: 1011.6, precip: 0, uv: 0, vis: 24000, isDay: 0, tz: 'America/Barbados',
      hourly: {
        time,
        temp: hr.map((h) => +(27.8 + 1.9 * diurnal(h)).toFixed(1)),
        dew: hr.map((h) => +(23.4 + 0.4 * diurnal(h + 3)).toFixed(1)),
        rh: hr.map((h) => Math.round(78 - 9 * diurnal(h))),
        cloud: hr.map((h, i) => Math.round(35 + 25 * Math.abs(Math.sin(i / 5)))),
        wind: hr.map((h, i) => Math.round(22 + 5 * diurnal(h) + 3 * Math.sin(i / 7))),
        windDir: hr.map((h, i) => Math.round(90 + 12 * Math.sin(i / 9))),
        gust: hr.map((h, i) => Math.round(34 + 6 * diurnal(h))),
        uv: hr.map((h) => Math.max(0, +(10.5 * Math.sin(((h - 6) / 12) * Math.PI)).toFixed(1))),
      },
      daily: { uvMax: 10.4 },
    };
    const marine = {
      waveH: 1.7, waveDir: 82, wavePer: 7.4, swellH: 1.3, swellDir: 68, swellPer: 9.6, windWaveH: 0.9,
      curVel: 1.4, curDir: 292, sst: 28.9,
      hourly: { time, waveH: time.map((_, i) => +(1.6 + 0.2 * Math.sin(i / 8)).toFixed(2)), curVel: time.map((_, i) => +(1.3 + 0.3 * Math.sin(i / 6)).toFixed(2)), curDir: time.map((_, i) => Math.round(290 + 10 * Math.sin(i / 10))) },
    };
    const aq = { usAqi: 41, euAqi: 33, pm25: 9.6, pm10: 34.2, o3: 58, no2: 2.1, so2: 1.4, co: 118, dust: 27, uv: 0 };
    const obs = new Date(); obs.setUTCMinutes(0, 0, 0);
    const z = obs.toISOString().slice(8, 10) + obs.toISOString().slice(11, 13) + '00Z';
    const metar = { id: 'TBPB', name: 'Bridgetown/Grantley Adams Intl', raw: `TBPB ${z} 09013KT 9999 FEW018 SCT045 27/23 Q1012`, temp: 27, dewp: 23, wdir: 90, wspd: 13, wgst: null, visib: '6+', altim: 1012, cat: 'VFR', distKm: 11.8, brg: 101, obsTime: obs };
    const buoy = { id: '41040', name: 'NORTH EQUATORIAL ONE', distKm: 699, brg: 72, time: obs, wdir: 80, wspd: 7.5, gst: 9.3, wvht: 2.1, dpd: 8, mwd: 75, pres: 1012.4, atmp: 27.1, wtmp: 28.4, dewp: null };
    const sarg = { time: new Date(Date.now() - 86400000), valid: 1180, hits: 64, coverPct: 5.4, maxAfai: 0.0021, nearestKm: 23, nearestBrg: 108, windowKm: 111 };
    return { wx, marine, aq, metar, buoy, sarg };
  }
  /** Illustrative mats for the preview map only: [lon, lat, radiusDeg, alpha]. */
  function blobs() {
    let s = 42; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const out = [];
    const belt = (lon0, lon1, lat0, lat1, n) => { for (let i = 0; i < n; i++) { const t = rnd(); out.push([lon0 + (lon1 - lon0) * t + (rnd() - 0.5) * 3, lat0 + (lat1 - lat0) * t + (rnd() - 0.5) * 2.5, 0.12 + rnd() * 0.35, 0.35 + rnd() * 0.45]); } };
    belt(-45, -56, 6, 12, 90); belt(-56, -62, 11, 15, 55); belt(-62, -80, 14, 20, 50); belt(-30, -45, 4, 8, 60);
    return out;
  }
  window.EagleSample = { build, blobs, home: { lat: 13.0975, lon: -59.6167, name: 'Bridgetown, Barbados' } };
})();
