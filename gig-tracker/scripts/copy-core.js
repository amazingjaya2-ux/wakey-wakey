// Copies browser builds of Capacitor and Supabase into www/vendor so the plain-JS app
// can use them without a bundler. Runs after `npm install` and before `npm run sync`.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });
for (const [pkg, file] of [
  ['@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js'],
]) {
  fs.copyFileSync(require.resolve(pkg), path.join(out, file));
  console.log('copied', file, 'into www/vendor/');
}
