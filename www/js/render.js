/* Eagle — map engine. Two views share one renderer:
 *   "geochron": equirectangular world with live day/night terminator and solar-hour strip
 *   "god":      orthographic globe you can spin and zoom
 */
(function () {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  class EagleView {
    constructor(canvas, { onPick, onView } = {}) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.mode = 'geochron';
      this.k = 1; this.center = [-40, 15]; this.rot = [-59.6, 13.1];
      this.point = null; this.label = '';
      this.layers = { night: true, grid: true, sat: false, sarg: true, drift: true };
      this.overlays = { sat: null, sarg: null };
      this.sampleBlobs = null; this.drift = null; this.vectors = null;
      this.onPick = onPick; this.onView = onView;
      this.land = window.EAGLE_LAND;
      this.graticule = d3.geoGraticule10();
      this.raster = null; this.rasterKey = '';
      this.idleTimer = null; this.dragging = false;
      this.readPalette();
      this.bind();
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }

    readPalette() {
      this.pal = {
        space: css('--space') || '#070b12', ocean: css('--ocean') || '#0c1d2b', land: css('--land') || '#1f3326', coast: css('--coast') || '#6f8f74',
        grat: css('--grat') || 'rgba(160,190,210,.10)', grid: css('--gridline') || 'rgba(232,176,74,.35)', gridText: css('--gridtext') || 'rgba(232,176,74,.85)',
        night: css('--night') || '3,6,14', accent: css('--accent') || '#e8b04a', sun: css('--sun') || '#ffd166', drift: css('--drift') || '#7fd1c7',
        sarg: css('--sarg') || '#c9a227', ink: css('--fg') || '#dfe7ee', dim: css('--muted') || '#8796a5',
      };
    }

    /* ---------- geometry ---------- */
    resize() {
      const r = this.c.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(200, r.width); this.h = Math.max(200, r.height); this.dpr = dpr;
      this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px';
      this.invalidate();
    }
    projection() {
      const { w, h } = this;
      if (this.mode === 'god') {
        return d3.geoOrthographic().scale((Math.min(w, h) / 2) * 0.9 * this.k).translate([w / 2, h / 2])
          .rotate([-this.rot[0], -this.rot[1]]).clipAngle(90).precision(0.3);
      }
      const s0 = Math.min(w / (2 * Math.PI), h / Math.PI);
      const s = s0 * this.k;
      // keep the poles from leaving the frame
      const maxLat = Math.max(0, 90 - (h / 2) / s * DEG);
      this.center[1] = Math.max(-maxLat, Math.min(maxLat, this.center[1]));
      return d3.geoEquirectangular().scale(s).translate([w / 2, h / 2]).rotate([-this.center[0], 0]).center([0, this.center[1]]).precision(0.3);
    }
    degPerPx() { return DEG / this.projection().scale(); }

    setMode(m) {
      if (m !== this.mode) { (this.kBy = this.kBy || {})[this.mode] = this.k; this.k = (this.kBy && this.kBy[m]) || (m === 'god' ? 1.15 : 1.6); }
      this.mode = m; this.rasterKey = ''; this.invalidate();
    }
    setPoint(lat, lon, label, { recenter = true } = {}) {
      this.point = { lat, lon }; this.label = label || '';
      if (recenter) { this.rot = [lon, lat]; this.center = [lon, Math.max(-60, Math.min(60, lat))]; }
      this.invalidate();
    }
    zoom(f) {
      this.k = Math.max(this.mode === 'god' ? 0.6 : 1, Math.min(this.mode === 'god' ? 40 : 60, this.k * f));
      this.invalidate();
    }

    /* ---------- interaction ---------- */
    bind() {
      const c = this.c, ptrs = new Map();
      let start = null, moved = 0, pinch0 = null;
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
        if (ptrs.size === 1) { start = [e.offsetX, e.offsetY]; moved = 0; }
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this.k }; }
      });
      c.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
        if (ptrs.size === 2 && pinch0) {
          const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          this.k = pinch0.k; this.zoom(d / pinch0.d); moved += 10; return;
        }
        const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 4) return;
        this.dragging = true;
        const dpp = this.degPerPx();
        if (this.mode === 'god') {
          this.rot[0] -= dx * dpp; this.rot[1] = Math.max(-89, Math.min(89, this.rot[1] + dy * dpp));
        } else {
          this.center[0] = ((this.center[0] - dx * dpp + 540) % 360) - 180; this.center[1] += dy * dpp;
        }
        this.invalidate(true);
      });
      const end = (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.delete(e.pointerId);
        if (ptrs.size < 2) pinch0 = null;
        if (ptrs.size === 0) {
          if (moved < 4 && start && this.onPick) {
            const ll = this.projection().invert(start);
            if (ll && isFinite(ll[0]) && (this.mode !== 'god' || d3.geoDistance(ll, this.rot) < Math.PI / 2)) this.onPick(ll[1], ll[0]);
          }
          this.dragging = false; this.invalidate();
        }
      };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      c.addEventListener('keydown', (e) => {
        const step = 10 * this.degPerPx() * 4;
        const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (k) {
          e.preventDefault();
          if (this.mode === 'god') { this.rot[0] += k[0] * step; this.rot[1] = Math.max(-89, Math.min(89, this.rot[1] + k[1] * step)); }
          else { this.center[0] += k[0] * step; this.center[1] += k[1] * step; }
          this.invalidate();
        } else if (e.key === '+' || e.key === '=') this.zoom(1.25);
        else if (e.key === '-') this.zoom(0.8);
      });
    }

    invalidate(fast) {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(fast); });
      clearTimeout(this.idleTimer);
      if (fast) this.idleTimer = setTimeout(() => this.invalidate(false), 160);
    }

    /* ---------- raster overlays (satellite, sargassum) reprojected to the current view ---------- */
    setOverlay(name, srcCanvasOrImg, bbox, meta) {
      if (!srcCanvasOrImg) { this.overlays[name] = null; this.rasterKey = ''; this.invalidate(); return; }
      const c = document.createElement('canvas'); c.width = srcCanvasOrImg.width || srcCanvasOrImg.naturalWidth; c.height = srcCanvasOrImg.height || srcCanvasOrImg.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(srcCanvasOrImg, 0, 0);
      let data = null; try { data = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { data = null; }
      this.overlays[name] = { data, w: c.width, h: c.height, bbox, meta, canvas: c };
      this.rasterKey = ''; this.invalidate();
    }
    buildRaster(proj) {
      const active = ['sat', 'sarg'].filter((n) => this.layers[n] && this.overlays[n] && this.overlays[n].data);
      const key = active.join(',') + '|' + this.mode + '|' + proj.scale().toFixed(2) + '|' + proj.rotate().map((v) => v.toFixed(2)).join() + '|' + this.w + 'x' + this.h;
      if (key === this.rasterKey) return this.raster;
      this.rasterKey = key;
      if (!active.length) { this.raster = null; return null; }
      const f = 2, W = Math.ceil(this.w / f), H = Math.ceil(this.h / f);
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const ox = out.getContext('2d'), img = ox.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ll = proj.invert([x * f + 1, y * f + 1]);
          if (!ll || !isFinite(ll[0])) continue;
          if (this.mode === 'god' && d3.geoDistance(ll, this.rot) > Math.PI / 2) continue;
          let r = 0, g = 0, b = 0, a = 0;
          for (const n of active) {
            const o = this.overlays[n], [w0, s0, e0, n0] = o.bbox;
            let lon = ll[0]; if (lon < w0) lon += 360; if (lon > e0) lon -= 360;
            if (lon < w0 || lon > e0 || ll[1] < s0 || ll[1] > n0) continue;
            const sx = Math.min(o.w - 1, ((lon - w0) / (e0 - w0)) * o.w | 0), sy = Math.min(o.h - 1, ((n0 - ll[1]) / (n0 - s0)) * o.h | 0);
            const i = (sy * o.w + sx) * 4, sa = o.data[i + 3] / 255 * (n === 'sat' ? 0.85 : 1);
            if (sa <= 0) continue;
            r = r * (1 - sa) + o.data[i] * sa; g = g * (1 - sa) + o.data[i + 1] * sa; b = b * (1 - sa) + o.data[i + 2] * sa; a = a + sa * (1 - a);
          }
          if (a > 0) { const j = (y * W + x) * 4; d[j] = r / a; d[j + 1] = g / a; d[j + 2] = b / a; d[j + 3] = a * 255; }
        }
      }
      ox.putImageData(img, 0, 0);
      this.raster = out; return out;
    }

    /* ---------- drawing ---------- */
    draw(fast) {
      const { ctx, w, h, dpr, pal } = this;
      const proj = this.projection();
      const path = d3.geoPath(proj, ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = pal.space; ctx.fillRect(0, 0, w, h);
      if (this.mode === 'god') this.drawStars();

      // ocean
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = pal.ocean; ctx.fill();
      if (this.mode === 'god') {
        const r = proj.scale(), g = ctx.createRadialGradient(w / 2 - r * 0.3, h / 2 - r * 0.35, r * 0.1, w / 2, h / 2, r);
        g.addColorStop(0, 'rgba(120,170,210,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = g; ctx.fill();
      }

      // land
      ctx.beginPath(); path(this.land);
      ctx.fillStyle = pal.land; ctx.globalAlpha = this.layers.sat && this.overlays.sat ? 0.35 : 1; ctx.fill(); ctx.globalAlpha = 1;

      // raster overlays
      if (!fast || !this.dragging) {
        const ras = (this.layers.sat || this.layers.sarg) ? this.buildRaster(proj) : null;
        if (ras) { ctx.imageSmoothingEnabled = true; ctx.drawImage(ras, 0, 0, w, h); }
      } else if (this.raster) { /* skip while dragging */ }

      ctx.beginPath(); path(this.land); ctx.strokeStyle = pal.coast; ctx.lineWidth = 0.6; ctx.stroke();

      // illustrative sargassum (sample mode only)
      if (this.layers.sarg && this.sampleBlobs && !this.overlays.sarg) this.drawSampleBlobs(proj);

      // graticule
      ctx.beginPath(); path(this.graticule); ctx.strokeStyle = pal.grat; ctx.lineWidth = 0.5; ctx.stroke();

      if (this.layers.grid) this.drawMaidenhead(proj, path);
      if (this.layers.night) this.drawNight(path);
      this.drawSun(proj);
      if (this.layers.drift && this.drift) this.drawDrift(proj, path);
      if (this.point) this.drawPoint(proj);

      // rim
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(160,190,210,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      if (this.mode === 'geochron') this.drawSolarStrip(proj);
      if (this.onView) this.onView(this);
    }

    drawStars() {
      const { ctx, w, h } = this;
      if (!this.stars) { let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); this.stars = Array.from({ length: 220 }, () => [rnd(), rnd(), rnd()]); }
      ctx.fillStyle = 'rgba(220,230,255,0.55)';
      for (const [x, y, z] of this.stars) { ctx.globalAlpha = 0.2 + z * 0.6; ctx.fillRect(x * w, y * h, z > 0.85 ? 1.6 : 1, z > 0.85 ? 1.6 : 1); }
      ctx.globalAlpha = 1;
    }

    drawNight(path) {
      const { ctx, pal } = this;
      const s = Geo.sun(new Date());
      const anti = [Geo.norm180(s.lon + 180), -s.lat];
      // night (sun below horizon) then civil, nautical, astronomical twilight layers
      const bands = [[90.833, 0.34], [84, 0.16], [78, 0.14], [72, 0.14]];
      for (const [r, a] of bands) {
        ctx.beginPath(); path(d3.geoCircle().center(anti).radius(r).precision(1)());
        ctx.fillStyle = `rgba(${pal.night},${a})`; ctx.fill();
      }
      ctx.beginPath(); path(d3.geoCircle().center(anti).radius(90.833).precision(1)());
      ctx.strokeStyle = 'rgba(255,209,102,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }

    drawSun(proj) {
      const s = Geo.sun(new Date());
      if (this.mode === 'god' && d3.geoDistance([s.lon, s.lat], this.rot) > Math.PI / 2) return;
      const p = proj([s.lon, s.lat]); if (!p) return;
      const { ctx, pal } = this;
      ctx.save(); ctx.translate(p[0], p[1]);
      ctx.strokeStyle = pal.sun; ctx.fillStyle = pal.sun; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke(); }
      ctx.restore();
    }

    drawMaidenhead(proj, path) {
      const { ctx, pal } = this;
      const lines = [];
      const meridian = (lon, a = -90, b = 90) => { const c = []; for (let la = a; la <= b; la += 1) c.push([lon, la]); return c; };
      const parallel = (lat, a = -180, b = 180) => { const c = []; for (let lo = a; lo <= b; lo += 1) c.push([lo, lat]); return c; };
      for (let lon = -180; lon < 180; lon += 20) lines.push(meridian(lon));
      for (let lat = -80; lat < 90; lat += 10) lines.push(parallel(lat));
      ctx.beginPath(); path({ type: 'MultiLineString', coordinates: lines });
      ctx.strokeStyle = pal.grid; ctx.lineWidth = 0.8; ctx.stroke();

      const dpp = this.degPerPx();
      const fc = this.mode === 'god' ? this.rot : [this.center[0], this.center[1]];
      ctx.font = '600 11px ' + (css('--font-data') || 'monospace'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // squares when zoomed in enough that a 2° square is at least ~34px wide
      const showSquares = 2 / dpp > 34;
      if (showSquares) {
        const sq = [], span = Math.min(60, dpp * Math.max(this.w, this.h));
        const lo0 = Math.floor((fc[0] - span) / 2) * 2, lo1 = fc[0] + span, la0 = Math.floor(fc[1] - span), la1 = Math.min(90, fc[1] + span);
        for (let lo = lo0; lo <= lo1; lo += 2) sq.push(meridian(lo, Math.max(-90, la0), la1));
        for (let la = Math.max(-90, la0); la <= la1; la += 1) sq.push(parallel(la, lo0, lo1));
        ctx.beginPath(); path({ type: 'MultiLineString', coordinates: sq });
        ctx.strokeStyle = pal.grid; ctx.globalAlpha = 0.45; ctx.lineWidth = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = pal.gridText;
        for (let lo = lo0 + 1; lo <= lo1; lo += 2) for (let la = Math.max(-89.5, la0 + 0.5); la <= la1; la += 1) {
          const p = proj([lo, la]); if (!p || p[0] < -20 || p[0] > this.w + 20 || p[1] < -20 || p[1] > this.h + 20) continue;
          if (this.mode === 'god' && d3.geoDistance([lo, la], this.rot) > 1.35) continue;
          ctx.fillText(Geo.toGrid(la, lo, 4), p[0], p[1]);
        }
      } else {
        ctx.fillStyle = pal.gridText;
        for (let lo = -170; lo < 180; lo += 20) for (let la = -85; la < 90; la += 10) {
          const p = proj([lo, la]); if (!p) continue;
          if (this.mode === 'god' && d3.geoDistance([lo, la], this.rot) > 1.35) continue;
          ctx.fillText(Geo.toGrid(la, lo, 2).slice(0, 2), p[0], p[1]);
        }
      }
    }

    drawSampleBlobs(proj) {
      const { ctx, pal } = this;
      ctx.fillStyle = pal.sarg;
      for (const [lon, lat, r, a] of this.sampleBlobs) {
        if (this.mode === 'god' && d3.geoDistance([lon, lat], this.rot) > Math.PI / 2) continue;
        const p = proj([lon, lat]); if (!p) continue;
        const px = Math.max(1.2, r / this.degPerPx());
        ctx.globalAlpha = a; ctx.beginPath(); ctx.ellipse(p[0], p[1], px * 1.8, px * 0.7, -0.35, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawDrift(proj, path) {
      const { ctx, pal } = this, pts = this.drift.pts;
      ctx.save();
      ctx.beginPath(); path({ type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) });
      ctx.setLineDash([5, 4]); ctx.strokeStyle = pal.drift; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = pal.drift; ctx.font = '600 10px ' + (css('--font-data') || 'monospace'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const p of pts) {
        if (p.h === 0 || p.h % 12) continue;
        if (this.mode === 'god' && d3.geoDistance([p.lon, p.lat], this.rot) > Math.PI / 2) continue;
        const q = proj([p.lon, p.lat]); if (!q) continue;
        ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillText('+' + p.h + 'h', q[0] + 6, q[1]);
      }
      ctx.restore();
    }

    arrow(x, y, toDeg, len, color, width = 2) {
      const { ctx } = this, a = (toDeg - 90) * RAD;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(a - 0.45) * 8, ey - Math.sin(a - 0.45) * 8); ctx.lineTo(ex - Math.cos(a + 0.45) * 8, ey - Math.sin(a + 0.45) * 8); ctx.closePath(); ctx.fill();
    }

    drawPoint(proj) {
      const { ctx, pal } = this, { lat, lon } = this.point;
      if (this.mode === 'god' && d3.geoDistance([lon, lat], this.rot) > Math.PI / 2) return;
      const p = proj([lon, lat]); if (!p) return;
      const [x, y] = p;
      // vectors: wind (toward) and surface current
      if (this.vectors) {
        if (this.vectors.wind) this.arrow(x, y, this.vectors.wind.dir + 180, 26 + Math.min(30, this.vectors.wind.spd), pal.ink, 2);
        if (this.vectors.current) this.arrow(x, y, this.vectors.current.dir, 20 + Math.min(30, this.vectors.current.spd * 10), pal.drift, 2);
      }
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 16, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 16); ctx.stroke();
      ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      if (this.label) {
        ctx.font = '700 12px ' + (css('--font-data') || 'monospace');
        const tw = ctx.measureText(this.label).width + 12;
        const bx = Math.min(this.w - tw - 4, x + 14), by = y - 30;
        ctx.fillStyle = 'rgba(7,11,18,0.85)'; ctx.fillRect(bx, by, tw, 20);
        ctx.strokeStyle = pal.accent; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 19);
        ctx.fillStyle = pal.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(this.label, bx + 6, by + 10.5);
      }
    }

    drawSolarStrip(proj) {
      const { ctx, w, h, pal } = this;
      const y = h - 18, s = Geo.sun(new Date());
      ctx.fillStyle = 'rgba(7,11,18,0.72)'; ctx.fillRect(0, y - 4, w, 22);
      ctx.font = '600 10px ' + (css('--font-data') || 'monospace'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let hr = 0; hr < 24; hr++) {
        const lon = Geo.norm180(s.lon + (hr - 12) * 15);
        const p = proj([lon, 0]); if (!p) continue;
        for (const dx of [0, -360 / this.degPerPx(), 360 / this.degPerPx()]) {
          const x = p[0] + dx; if (x < -12 || x > w + 12) continue;
          const noon = hr === 12, midnight = hr === 0;
          ctx.fillStyle = noon ? pal.sun : midnight ? pal.dim : pal.ink;
          ctx.globalAlpha = noon || midnight ? 1 : 0.7;
          ctx.fillText(String(hr).padStart(2, '0'), x, y + 7);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  window.EagleView = EagleView;
})();
