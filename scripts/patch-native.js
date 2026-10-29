// Adds location permissions to the generated Android and iOS projects so "Use my location" works.
// Usage: node scripts/patch-native.js android|ios
const fs = require('fs');
const path = require('path');
const which = process.argv[2];

if (which === 'android') {
  const f = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let x = fs.readFileSync(f, 'utf8');
  for (const p of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'INTERNET']) {
    if (!x.includes(`android.permission.${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
  }
  fs.writeFileSync(f, x);
  console.log('Patched', f);
} else if (which === 'ios') {
  const f = path.join('ios', 'App', 'App', 'Info.plist');
  let x = fs.readFileSync(f, 'utf8');
  if (!x.includes('NSLocationWhenInUseUsageDescription')) {
    const add = '\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>Eagle uses your location to pinpoint your reference point and grid square.</string>\n';
    const i = x.lastIndexOf('</dict>');
    x = x.slice(0, i) + add + x.slice(i);
  }
  fs.writeFileSync(f, x);
  console.log('Patched', f);
} else {
  console.error('Usage: node scripts/patch-native.js android|ios');
  process.exit(1);
}
