// Temporal: auditoría de codificación UTF-8 del sitio.
import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.astro', '.ts', '.mjs', '.js', '.json', '.md', '.css', '.html']);
const IGNORE = new Set(['node_modules', '.git', '.astro', '.vercel', 'dist']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function walk(dir, acc = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (IGNORE.has(entry.name)) continue;
			walk(path.join(dir, entry.name), acc);
		} else if (EXT.has(path.extname(entry.name).toLowerCase())) {
			acc.push(path.join(dir, entry.name));
		}
	}
	return acc;
}

const out = [];
let invalid = 0;
let withBom = 0;

for (const file of walk('.')) {
	const buf = fs.readFileSync(file);
	let status = 'ok';
	try {
		utf8.decode(buf);
	} catch {
		status = 'BYTES-INVALIDOS';
		invalid++;
	}
	const bom = buf.length > 2 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
	if (bom) withBom++;
	out.push(`${status}${bom ? ' BOM' : ''}  ${file}`);
}

out.push('');
out.push('=== HTML: charset y lang ===');
for (const file of walk('src')) {
	if (path.extname(file) !== '.astro') continue;
	const text = fs.readFileSync(file, 'utf8');
	if (!text.includes('<html')) continue;
	const charset = /<meta\s+charset="utf-8"/i.test(text) || /<meta\s+http-equiv="content-type"[^>]*charset=utf-8/i.test(text);
	const langEs = /<html[^>]*lang="es"/i.test(text);
	out.push(`${charset ? 'charset-utf8 OK ' : 'SIN CHARSET    '} ${langEs ? 'lang=es OK ' : 'lang FALTA '} ${file}`);
}

out.push('');
out.push(`archivos revisados: ${out.length}`);
out.push(`archivos con bytes inválidos: ${invalid}`);
out.push(`archivos con BOM: ${withBom}`);

fs.writeFileSync('tmp-utf8-audit.out.txt', out.join('\n'), 'utf8');
console.log('archivos inválidos:', invalid, '| con BOM:', withBom);
