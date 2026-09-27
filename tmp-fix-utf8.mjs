// Temporal: repara el mojibake (doble codificación) de un archivo .astro.
// Convierte únicamente las secuencias mal codificadas (Â…, Ã…, â€…) tomando sus
// bytes en Windows-1252 y decodificándolos como UTF-8 real.
import fs from 'node:fs';

const file = process.argv[2] || 'src/pages/dashboard.astro';
const original = fs.readFileSync(file, 'utf8');

const dec1252 = new TextDecoder('windows-1252', { fatal: true });
const utf8 = new TextDecoder('utf-8', { fatal: true });

const byteOf = new Map();
for (let b = 0; b < 256; b++) {
	const ch = dec1252.decode(new Uint8Array([b]));
	if (!byteOf.has(ch)) byteOf.set(ch, b);
}

function decodeMojibake(seq) {
	const bytes = [];
	for (const ch of seq) {
		const b = byteOf.get(ch);
		if (b === undefined) return null;
		bytes.push(b);
	}
	try {
		return utf8.decode(new Uint8Array(bytes));
	} catch {
		return null;
	}
}

const replaced = new Map();

// Caracteres de Windows-1252 cuyo byte es una continuación UTF-8 (0x80-0xBF):
// incluye los "especiales" (€ “ ” ‘ ’ š † …) y el rango Latin-1.
const contBytes = [];
for (let b = 0x80; b <= 0xbf; b++) contBytes.push(dec1252.decode(new Uint8Array([b])));
const escapeClass = (chars) =>
	chars.map((c) => c.replace(/[\\\]^$.*+?()[{}|/-]/g, '\\$&')).join('');
const CONT = `[${escapeClass(contBytes)}]`;
const LEAD = '[\u00C2\u00C3\u00E2\u00F0]';

const passes = [
	// Tres caracteres: guiones y comillas tipográficos (â€” â€¦ â†’).
	new RegExp(`${LEAD}${CONT}${CONT}`, 'g'),
	// Dos caracteres: acentos y símbolos (Ã¡ Ã© Ã“ Ãš Ã‘ Âº Â· Â± Â¡).
	new RegExp(`${LEAD}${CONT}`, 'g'),
];

let text = original;
for (const re of passes) {
	text = text.replace(re, (m) => {
		const fixed = decodeMojibake(m);
		if (!fixed) return m;
		replaced.set(m, fixed);
		return fixed;
	});
}

const hadBom = text.charCodeAt(0) === 0xfeff;
if (hadBom) text = text.slice(1);

const leftovers = [...text.matchAll(/[\u00C2\u00C3\u00E2\u00F0][^\x00-\x7F]?/g)].map((m) => ({
	seq: m[0],
	ctx: text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).replace(/\r?\n/g, '\\n'),
}));

const chars = new Map();
for (const ch of text) {
	if (ch.codePointAt(0) > 0x7f) chars.set(ch, (chars.get(ch) || 0) + 1);
}

fs.writeFileSync(
	'tmp-fix-utf8.out.txt',
	[
		`archivo: ${file}`,
		`BOM inicial: ${hadBom} (se elimina)`,
		`secuencias corregidas: ${replaced.size}`,
		...[...replaced.entries()].map(([k, v]) => `   ${JSON.stringify(k)} -> ${JSON.stringify(v)}`),
		`U+FFFD introducidos: ${(text.match(/\uFFFD/g) || []).length}`,
		`secuencias sospechosas restantes: ${leftovers.length}`,
		...leftovers.map((l) => `   ${JSON.stringify(l.seq)}  …${l.ctx}…`),
		'caracteres no ASCII resultantes:',
		...[...chars.entries()].map(([k, v]) => `   ${JSON.stringify(k)} U+${k.codePointAt(0).toString(16).toUpperCase()} x${v}`),
	].join('\n'),
	'utf8'
);

fs.writeFileSync(file, text, 'utf8');
console.log('secuencias corregidas:', replaced.size, '| restantes:', leftovers.length);
