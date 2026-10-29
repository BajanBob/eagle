# Eagle

A world map and globe that pull weather, cloud cover, wind, dew point, humidity, UV, air quality, waves, ocean drift and sargassum for one reference point. Set the point with a Maidenhead grid square (`GK03ec`), latitude/longitude (`13.10, -59.62`, `13°06'N 59°37'W`), device location, or a tap on the map.

One shared app (`www/`) runs everywhere:

| Platform | Shell | Output |
|---|---|---|
| Linux x64 | Electron | `.AppImage`, `.deb` |
| Raspberry Pi (Pi 4/5 64-bit, Pi 3/4 32-bit) | Electron | `arm64` and `armv7l` `.AppImage`, `.deb` |
| Windows 10/11 | Electron | installer `.exe`, portable `.exe` (x64 + ARM64) |
| macOS (Intel + Apple Silicon) | Electron | universal `.dmg`, `.zip` |
| Android | Capacitor | `.apk` |
| iOS / iPadOS | Capacitor | Xcode project, simulator build, unsigned `.ipa` |

## Build everything with no local setup (recommended)

1. Create a GitHub repository and push this folder to it.
2. Open **Actions → Build Eagle → Run workflow**.
3. When it finishes (about 15 minutes), download the installers from the run's **Artifacts** section.
4. Push a tag such as `v1.0.0` to also attach every installer to a GitHub Release.

The workflow uses GitHub's Linux, Windows and macOS runners, so you don't need a Mac to get the macOS and iOS builds.

## Build on your own machine

Requires Node.js 20+.

```bash
npm install
npm start                # run the desktop app
npm run dist:linux       # Linux x64 → dist/
npm run dist:pi          # Raspberry Pi arm64 + armv7l → dist/
npm run dist:win         # Windows (run on Windows, or Linux with Wine)
npm run dist:mac         # macOS (run on a Mac)
```

**Android APK** (needs Android Studio / Android SDK and JDK 21):

```bash
npm run android:add      # once: creates android/
npm run icons            # optional: app icon + splash from assets/
npm run android:apk      # → android/app/build/outputs/apk/debug/app-debug.apk
```

**iOS** (needs a Mac with Xcode 16+):

```bash
npm run ios:add          # once: creates ios/
npm run icons
npm run ios:open         # opens Xcode; pick your team under Signing, then Run or Archive
```

## Installing

- **Raspberry Pi:** `sudo apt install ./Eagle-1.0.0-linux-arm64.deb` (64-bit Raspberry Pi OS) or the `armv7l` file on 32-bit. For a wall display: `eagle --kiosk`. If the screen flickers or stays blank, start with `eagle --no-gpu`.
- **Linux AppImage:** `chmod +x Eagle-*.AppImage && ./Eagle-*.AppImage`.
- **Windows:** the builds are unsigned, so SmartScreen shows "Windows protected your PC". Choose **More info → Run anyway**.
- **macOS:** unsigned. Right-click the app → **Open** the first time. If macOS says the app is damaged, run `xattr -cr /Applications/Eagle.app`.
- **Android:** copy the APK to the phone and open it; allow "Install unknown apps" for your file manager when asked. For the Play Store, add the signing secrets below and use the release APK.
- **iOS:** Apple only allows signed apps on devices. Either open the Xcode project and run it with your Apple ID, or re-sign `Eagle-ios-unsigned.ipa` with AltStore or Sideloadly. App Store/TestFlight needs a paid Apple Developer account.

### Optional Android release signing in CI

Add these repository secrets: `ANDROID_KEYSTORE_BASE64` (your `.jks`, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The workflow then also produces `Eagle-release.apk`.

## Data sources

| Panel | Source | Notes |
|---|---|---|
| Temperature, feels-like, humidity, dew point, pressure, visibility, cloud cover (low/mid/high), wind, gusts, UV, hourly trends | Open-Meteo forecast API | Blends NOAA GFS/HRRR with ECMWF, DWD and others. No key. |
| Waves, swell, wind waves, sea temperature, ocean current | Open-Meteo marine API | No key. |
| US AQI, PM2.5, PM10, ozone, NO₂, SO₂, CO, Saharan dust | Open-Meteo air-quality API (Copernicus CAMS) | No key. |
| Point forecast and active alerts | NOAA National Weather Service `api.weather.gov` | US and territories only. |
| Nearest METAR, flight category | NOAA Aviation Weather Center `aviationweather.gov` | No key. |
| Nearest buoy / C-MAN station | NOAA National Data Buoy Center | Works in the installed apps (NDBC doesn't allow browser access). |
| Personal weather station | Weather Underground / The Weather Company PWS API | Needs your API key: Settings → Weather Underground. Keys come with a registered PWS. |
| Sargassum mats, coverage, nearest mat | NOAA AOML / USF Alternative Floating Algae Index, 7-day composite (ERDDAP `noaa_aoml_atlantic_oceanwatch_AFAI_7D`) | Covers 0–38°N, 38–98°W (tropical Atlantic, Caribbean, Gulf). |
| Satellite layer | NASA GIBS: GOES-East/West band 13 infrared (10-minute) or NOAA-20 VIIRS true colour (daily) | Toggle in the map's layer chips; pick imagery in Settings. |
| Drift track | Computed: hourly surface current plus 3% wind leeway, 48 h | Shown on the map with +12 h marks. |

All requests in the desktop and phone apps go through the native layer (Electron main process / Capacitor HTTP), restricted to the hosts above.

## Map

- **Map:** flat world map with the live day/night terminator and civil, nautical and astronomical twilight bands. The strip along the bottom shows local solar time at each meridian; `12` marks where the sun is highest right now.
- **Globe:** a 3D globe. Drag to spin, scroll or pinch to zoom.
- Maidenhead fields (`GK`) are labelled at world scale; zoom in and 2°×1° squares (`GK03`) appear.
- Tap anywhere to move the reference point. A link ending in `#GK03ec` opens Eagle on that square.

## Project layout

```
www/                 shared app (HTML, CSS, JS, d3, Natural Earth land outlines)
electron/            desktop shell + allow-listed network bridge
capacitor.config.json  Android/iOS shell config
scripts/             native permission patcher, single-file builder
assets/, build/      icons and splash screens
.github/workflows/   one-click builds for all six platforms
```

Land outlines: Natural Earth 1:50m (public domain). Maps rendered with d3 (ISC licence).
