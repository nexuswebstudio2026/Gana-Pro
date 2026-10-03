// Inventario de TODOS los caracteres no ASCII por archivo, para detectar
// doble codificacion (mojibake) que un regex laxo podria dejar pasar.
import fs from 'node:fs';
import path from 'node:path';

function walk(d, acc = []) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		if (['node_modules', '.git', 'dist', 'tmp-pdftest'].includes(e.name)) continue;
		const p = path.join(d, e.name);
		if (e.isDirectory()) walk(p, acc);
		else acc.push(p);
	}
	return acc;
}

const files = walk('src').concat(walk('public'));
const exts = new Set(['.ts', '.astro', '.css', '.js', '.mjs', '.json', '.html', '.svg', '.md']);

for (const f of files) {
	if (!exts.has(path.extname(f))) continue;
	const buf = fs.readFileSync(f);
	const s = buf.toString('utf8');

	const chars = new Map();
	for (const ch of s) {
		if (ch.codePointAt(0) > 126) chars.set(ch, (chars.get(ch) || 0) + 1);
	}
	if (!chars.size) continue;

	// Sospechosos tipicos de UTF-8 leido como Windows-1252 y re-guardado.
	const suspects = [...chars.keys()].filter((c) => {
		const cp = c.codePointAt(0);
		return (
			(c >= '\u00c0' && c <= '\u00ff' && !'áéíóúñÁÉÍÓÚÑüÜçÇºª°') ||
			c === '\u201c' || c === '\u201d' || c === '\u2018' || c === '\u2019'
		);
	});

	const cps = [...chars.keys()]
		.sort()
		.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
		.join(' ');

	console.log(`\n${f}`);
	console.log(`  normales: ${cps}`);
	if (suspects.length) {
		console.log(`  SOSPECHOSOS: ${suspects.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase() + ' "' + c + '"').join(' ')}`);
		for (const bad of suspects) {
			const i = s.indexOf(bad);
			console.log(`    contexto: ${JSON.stringify(s.slice(Math.max(0, i - 50), i + 50))}`);
		}
	}
}