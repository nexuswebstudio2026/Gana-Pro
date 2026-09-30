const fs = require('fs');
const root = 'c:/Users/JAC ROSABLANCA/Documents/GitHub/gana-pro';
// dashboard-sections.css era el volcado temporal del <style is:global> original.
// Ya fue repartido en org-chart.css + org-focus.css + org-tree.css + users-table.css
// (verificación: 0 reglas faltantes), así que se elimina para no duplicar CSS.
fs.rmSync(root + '/src/styles/dashboard-sections.css');
['[section].astro.bak', '[section].astro.bak2', '[section].astro.bak3'].forEach((f) => {
  try { fs.rmSync(root + '/src/pages/dashboard/' + f); console.log('rm ' + f); } catch {}
});
['org-chart.ts.bak', 'org-chart.ts.bak2'].forEach((f) => {
  try { fs.rmSync(root + '/src/scripts/' + f); console.log('rm ' + f); } catch {}
});
try { fs.rmSync(root + '/tmp-extract.cjs'); console.log('rm tmp-extract.cjs'); } catch {}
console.log('CLEANUP OK');
