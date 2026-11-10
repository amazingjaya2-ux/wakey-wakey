// Copies Capacitor's browser runtime into www/ so the plain-JS app can call native plugins
// without a bundler. Runs automatically after `npm install` and before `npm run sync`.
const fs = require('fs');
const path = require('path');
const src = require.resolve('@capacitor/core/dist/capacitor.js');
fs.copyFileSync(src, path.join(__dirname, '..', 'www', 'capacitor.js'));
console.log('copied capacitor.js into www/');
