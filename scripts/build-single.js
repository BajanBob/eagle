// Builds a single self-contained HTML file of Eagle (for sharing or hosting as one page).
// d3 is loaded from cdnjs; everything else is inlined. Output: dist-single/eagle.html
const fs = require('fs');
const path = require('path');
const www = path.join(__dirname, '..', 'www');
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const body = html.split('<!--EAGLE:BODY-->')[1].split('<!--/EAGLE:BODY-->')[0];
const css = fs.readFileSync(path.join(www, 'styles.css'), 'utf8');
const js = ['js/land.js', 'js/geo.js', 'js/sources.js', 'js/sample.js', 'js/render.js', 'js/app.js']
  .map((f) => fs.readFileSync(path.join(www, f), 'utf8')).join('\n;\n').replace(/<\/script/gi, '<\\/script');
const out = `<title>Eagle</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap">
<style>
${css}
</style>
${body}
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(__dirname, '..', 'dist-single'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist-single', 'eagle.html'), out);
console.log('Wrote dist-single/eagle.html', (out.length / 1024).toFixed(0) + ' KB');
