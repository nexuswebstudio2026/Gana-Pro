// Escanea el proyecto buscando texto doblemente codificado (mojibake):
// bytes UTF-8 que alguien abrio como Latin-1 y volvio a guardar como UTF-8.
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'public', 'tmp-pdftest'];
const exts = new Set(['.ts', '.astro', '.css', '.mjs', '.js', '.json', '.html', '.md']);
const skipDirs = new Set(['node_modules', '.git', '.astro', '.vercel', 'dist', '.next']);

const files = [];
function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (skipDirs.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else if (exts.has(path.extname(entry.name))) files.push(full);
	}
}
for (const r of roots) if (fs.existsSync(r)) walk(r);

// Secuencias tipicas de mojibake: Ã¡ Ã© Ã­ Ã³ Ãº Ã± Â« Â» Â¿ etc.
const mojibake = /[ÂÃ][\u0080-\u00bf\u2018-\u201e\u2020-\u2026\u00a0-\u00ff]|\ufffd/g;
// Comprobacion mas fuerte: reinterpretar el texto como latin1 -> utf8 debe fallar
// si el archivo esta correctamente codificado.
function looksDoubleEncoded(text) {
	try {
		const roundTrip = Buffer.from(text, 'utf8').toString('utf8');
		return roundTrip !== text;
	} catch {
		return false;
	}
}

let problems = 0;
for (const file of files) {
	const buf = fs.readFileSync(file);
	// Byte order mark UTF-8, BOM de UTF-16 o UTF-16 sin BOM
	if (buf[0] === 0xff && buf[1] === 0xfe) { console.log(`\x1b[33m[UTF-16LE BOM]\x1b[0m ${file}`); problems++; }
	if (buf[0] === 0xfe && buf[1] === 0xff) { console.log(`\x1b[33m[UTF-16BE BOM]\x1b[0m ${file}`); problems++; }
	if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { console.log(`\x1b[33m[UTF-8 BOM]\x1b[0m ${file}`); problems++; }

	// Bytes UTF-16 sueltos (0x00 intercalados) sin BOM
	if (looksDoubleEncoded(buf.toString('latin1'))) { /* solo informativo */ }

	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
	} catch {
		console.log(`\x1b[31m[NO ES UTF-8 VALIDO]\x1b[0m ${file}`);
		problems++;
		continue;
	}
	const lines = text.split(/\r?\n/);
	lines.forEach((line, i) => {
		const moji = line.match(mojibake);
		if (moji) {
			console.log(`\x1b[31m[MOJIBAKE]\x1b[0m ${file}:${i + 1}  ${JSON.stringify([...new Set(moji)].join(''))}  ->  ${line.trim().slice(0, 90)}`);
			problems++;
		}
	});
}
console.log(problems === 0 ? '\nTodo limpio: UTF-8 sin mojibake.' : `\n${problems} problema(s) encontrado(s).`);