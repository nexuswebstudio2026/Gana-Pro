// Extrae el texto del PDF de Chrome para ver como quedaron los acentos.
import fs from 'node:fs';
import zlib from 'node:zlib';

const buf = fs.readFileSync(process.argv[2] || 'C:/temp/pdftest/out.pdf');
const raw = buf.toString('latin1');

// 1. Fuentes declaradas
const fonts = [...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#\-,._]+)/g)].map((m) => m[1]);
console.log('FUENTES:', [...new Set(fonts)].join(', ') || '(ninguna: texto como imagenes)');
const enc = [...raw.matchAll(/\/Encoding\s*\/([A-Za-z0-9-]+)/g)].map((m) => m[1]);
console.log('ENCODINGS:', [...new Set(enc)].join(', ') || '(ninguno)');
console.log('Tiene ToUnicode:', raw.includes('/ToUnicode'));
console.log('Subroutines (Type3/subset):', /\/Subtype\s*\/Type3/.test(raw));

// 2. Objetos comprimidos
const streams = [];
const re = /stream\r?\n/g;
let m;
while ((m = re.exec(raw))) {
	const start = m.index + m[0].length;
	const end = raw.indexOf('endstream', start);
	if (end < 0) continue;
	let data = Buffer.from(raw.slice(start, end), 'latin1');
	try {
		streams.push(zlib.inflateSync(data));
	} catch {
		/* no es Flate */
	}
}
console.log('Streams descomprimidos:', streams.length);

// 3. Operadores de texto
const textOps = streams
	.map((s) => s.toString('latin1'))
	.filter((s) => /BT|Tj|TJ/.test(s));
let joined = textOps.join('\n');
console.log('--- Operadores de texto encontrados:', (joined.match(/\bT[jJ]\b/g) || []).length);

// 4. Cadenas literales entre parentesis (texto en WinAnsi) y hex (Identity-H)
const literals = [...joined.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)].map((x) => x[1]);
if (literals.length) {
	console.log('--- Cadenas literales (primeras 25):');
	for (const l of literals.slice(0, 25)) {
		// Decodifica escapes PDF y muestra como latin1 -> lo que vera el usuario
		const dec = l.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) =>
			({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[e] ?? String.fromCharCode(parseInt(e, 8))
		);
		console.log('   bytes hex:', Buffer.from(l, 'latin1').toString('hex'));
		console.log('   latin1   :', dec);
	}
} else {
	console.log('(No hay cadenas literales: el texto va en hex <...> con glifos)');
}