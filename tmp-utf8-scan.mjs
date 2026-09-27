// Temporal: inventario de mojibake (texto mal codificado) en el código fuente.
import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.astro', '.ts', '.mjs', '.js', '.json', '.md', '.css', '.html', '.txt']);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.astro', '.vercel', 'dist']);

const markers = /[ÃÂâð]/;

function walk(dir, acc = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (IGNORE_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name), acc);
		} else if (EXT.has(path.extname(entry.name).toLowerCase())) {
			acc.push(path.join(dir, entry.name));
		}
	}
	return acc;
}

const files = [...walk('src'), ...walk('public')];
const lines = [];

for (const file of files) {
	const text = fs.readFileSync(file, 'utf8');
	const all = [...text.matchAll(new RegExp(markers, 'g'))];
	if (all.length === 0) continue;
	lines.push(`=== ${file} :: ${all.length} marcas ===`);
	const seen = new Set();
	for (const m of all) {
		const start = Math.max(0, (m.index ?? 0) - 30);
		const ctx = text.slice(start, (m.index ?? 0) + 30).replace(/\r?\n/g, '\\n');
		if (seen.has(ctx)) continue;
		seen.add(ctx);
		lines.push(`   …${ctx}…`);
	}
}

fs.writeFileSync('tmp-utf8-scan.out.txt', lines.join('\n'), 'utf8');
console.log('archivos con mojibake:', lines.filter((l) => l.startsWith('===')).length);
