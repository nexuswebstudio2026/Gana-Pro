// Decodifica el texto real del PDF usando los CMaps ToUnicode de cada fuente.
import fs from 'node:fs';
import zlib from 'node:zlib';

const buf = fs.readFileSync(process.argv[2] || 'C:/temp/pdftest/out.pdf');
const raw = buf.toString('latin1');

function inflateAll() {
	const out = [];
	const re = /stream\r?\n/g;
	let m;
	while ((m = re.exec(raw))) {
		const start = m.index + m[0].length;
		const end = raw.indexOf('endstream', start);
		if (end < 0) continue;
		try {
			out.push(zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')));
		} catch {}
	}
	return out;
}

const streams = inflateAll();

// --- Parsea los CMaps ToUnicode: "src" -> { hex -> char } ---
const cmaps = new Map();
for (const s of streams) {
	const t = s.toString('latin1');
	if (!t.includes('beginbfchar') && !t.includes('beginbfrange')) continue;
	const map = new Map();
	for (const blk of t.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
		for (const [, src, dst] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
			map.set(parseInt(src, 16), hexToStr(dst));
		}
	}
	for (const blk of t.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
		for (const [, lo, hi, dst] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
			const a = parseInt(lo, 16);
			const b = parseInt(hi, 16);
			const d0 = parseInt(dst, 16);
			for (let i = 0; i <= b - a; i++) map.set(a + i, String.fromCharCode(d0 + i));
		}
	}
	cmaps.set(map.size, map);
}
function hexToStr(hex) {
	let out = '';
	for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
	return out;
}

// --- Asocia cada recurso de fuente (/F1, /F2...) con su CMap ---
const fontToMap = new Map();
const fontRe = /\/Type\s*\/Font[\s\S]{0,400}?\/BaseFont\s*\/[^\s\/]+[\s\S]{0,400}?>>/g;
let fm;
while ((fm = fontRe.exec(raw))) {
	const nameM = fm[0].match(/\/(F\d+)\s/);
	const tuM = fm[0].match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
	if (!nameM) continue;
	if (tuM) {
		const objNum = parseInt(tuM[1], 10);
		const objRe = new RegExp(`(?:^|[^0-9])${objNum}\\s+0\\s+obj`);
		const mm = objRe.exec(raw);
		if (mm) {
			const st = raw.indexOf('stream', mm.index);
			const sIdx = raw.indexOf('\n', st) + 1;
			const eIdx = raw.indexOf('endstream', sIdx);
			try {
				const cm = zlib.inflateSync(Buffer.from(raw.slice(sIdx, eIdx), 'latin1')).toString('latin1');
				const map = new Map();
				for (const blk of cm.match(/beginbfchar([\s\S]*?)endbfchar/g) || [])
					for (const [, src, dst] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
						map.set(parseInt(src, 16), hexToStr(dst));
				for (const blk of cm.match(/beginbfrange([\s\S]*?)endbfrange/g) || [])
					for (const [, lo, hi, dst] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
						const a = parseInt(lo, 16), b = parseInt(hi, 16), d0 = parseInt(dst, 16);
						for (let i = 0; i <= b - a; i++) map.set(a + i, String.fromCharCode(d0 + i));
					}
				if (map.size) fontToMap.set(nameM[1], map);
			} catch {}
		}
	}
}
console.log('Fuentes con ToUnicode:', [...fontToMap.keys()].join(', '));

// --- Extrae el texto de los content streams ---
let full = '';
for (const s of streams) {
	const t = s.toString('latin1');
	if (!/\bTf\b/.test(t) || !/<[0-9A-Fa-f]{4,}>\s*Tj/.test(t)) continue;
	let cur = null;
	for (const tok of t.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^()\\])*)\)\s*Tj|\bTd\b|\bTD\b|\bT\*\b/g)) {
		if (tok[1]) cur = fontToMap.get(tok[1]);
		else if (tok[2] && cur) {
			for (let i = 0; i + 4 <= tok[2].length; i += 4)
				full += cur.get(parseInt(tok[2].slice(i, i + 4), 16)) ?? '¿';
		} else if (tok[3]) full += tok[3].replace(/\\(.)/g, '$1');
		else full += '\n';
	}
}

console.log('\n===== TEXTO EXTRAIDO DEL PDF =====\n');
console.log(full.replace(/\n{3,}/g, '\n\n'));
console.log('\n===== DIAGNOSTICO =====');
for (const probe of ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'Ñ', '«', '»', 'ó', 'É', 'ó']) {
	console.log(`  ${probe} (U+${probe.codePointAt(0).toString(16).toUpperCase()}): ${full.includes(probe) ? 'OK' : 'FALTA'}`);
}
const moji = full.match(/Ã.|Â.|â€./g);
console.log('  Mojibake detectado:', moji ? JSON.stringify([...new Set(moji)]) : 'ninguno');