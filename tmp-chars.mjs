// Temporal: inventario de caracteres no ASCII (para reparar la codificación).
import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.astro', '.ts', '.mjs', '.js', '.json', '.md', '.css', '.html', '.txt', '.env', '.example']);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.astro', '.vercel', 'dist']);

function walk(dir, acc = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (IGNORE_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name), acc);
		} else if (EXT.has(path.extname(entry.name).toLowerCase()) || entry.name.startsWith('.env')) {
			acc.push(path.join(dir, entry.name));
		}
	}
	return acc;
}

// Marcadores ampliados: 'Ã', 'Â', 'â', 'ð' y cualquier par de chars 0xC0-0xFF.
const suspicious = /(?:\u00C2|\u00C3|\u00E2|\u00F0)[\u0080-\u00FF\u2018-\u2122\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/;

const out = [];
for (const file of walk('.')) {
	const text = fs.readFileSync(file, 'utf8');
	const suspiciousHits = (text.match(new RegExp(suspicious, 'g')) || []).length;
	const apos = (text.match(/\uFFFD/g) || []).length;
	if (suspiciousHits === 0 && apos === 0) continue;

	const chars = new Map();
	for (const ch of text) {
		if (ch.codePointAt(0) > 0x7f) {
			const code = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
			const key = `${ch} ${code}`;
			chars.set(key, (chars.get(key) || 0) + 1);
		}
	}
	out.push(`=== ${file} | sospechosos=${suspiciousHits} | U+FFFD=${apos} ===`);
	for (const [k, v] of [...chars.entries()].sort((a, b) => b[1] - a[1])) out.push(`   ${k} x${v}`);
}

fs.writeFileSync('tmp-chars.out.txt', out.join('\n'), 'utf8');
console.log('bloques:', out.filter((l) => l.startsWith('===')).length);
