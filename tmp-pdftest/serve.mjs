// Sirve una replica de /dashboard/invitacion con el CSS real servido por HTTP
// (no inline), tal como lo ve el navegador, y genera el PDF con Chrome headless.
import http from 'node:http';
import fs from 'node:fs';
import QRCode from 'qrcode';

const shareUrl = 'https://gana-pro.vercel.app/register?ref=JAC42';
const svg = QRCode.toString(shareUrl, {
	type: 'svg',
	errorCorrectionLevel: 'L',
	margin: 1,
	width: 240,
	color: { dark: '#0b1220', light: '#ffffff' },
});

const referralCode = 'JAC42';

// HTML copia del literal de src/pages/dashboard/invitacion.astro
const html = `<!doctype html>
<html lang="es">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="robots" content="noindex" />
		<title>Invitación GANA PRO — ${referralCode}</title>
		<link rel="stylesheet" href="/invitacion.css" />
	</head>
	<body>
		<div class="screen-actions no-print">
			<button type="button" onclick="window.print()" class="btn-print">Descargar / Imprimir PDF</button>
			<a href="/dashboard/informacion-cuenta" class="btn-back">Volver a Mi Cuenta</a>
			<p class="hint">
				En el diálogo eliges <strong>«Guardar como PDF»</strong> como destino. El QR queda
				vectorial, así que se escanea nítido a cualquier tamaño.
			</p>
		</div>

		<article class="sheet">
			<header class="head">
				<span class="brand font-cinzel">GANA <em>PRO</em></span>
				<h1>Te invito a GANA PRO</h1>
				<p class="lead">
					Gana $1.000 por cada persona que se registre con mi
					código, cuando su primera recarga sea aprobada.
				</p>
			</header>

			<section class="qr-block">
				<div class="qr-frame">
					<img src="/qr.svg" alt="Código QR" width="300" height="300" />
				</div>
				<p class="qr-caption">Escanea con la cámara del teléfono</p>
			</section>

			<section class="code-block">
				<span class="label">Mi código</span>
				<code class="code">${referralCode}</code>
				<span class="label">O entra directo en</span>
				<code class="link">${shareUrl}</code>
			</section>

			<section class="steps">
				<h2 class="font-cinzel">Instala la app en tu teléfono</h2>
				<p class="steps-lead">
					La app se instala desde el navegador, sin buscar nada en una tienda. Tarda unos
					segundos y luego se abre como una aplicación normal.
				</p>

				<h3>En Android (Chrome)</h3>
				<ol>
					<li>Abre <strong>gana-pro.vercel.app</strong> en Chrome.</li>
					<li>Pulsa los <strong>tres puntos</strong> de la esquina superior derecha.</li>
					<li>Elige <strong>«Instalar aplicación»</strong> o <strong>«Añadir a la pantalla de inicio»</strong>.</li>
					<li>Confirma con <strong>«Instalar»</strong>. Aparecerá un ícono con el escudo de GANA PRO.</li>
				</ol>

				<h3>En iPhone (Safari)</h3>
				<ol>
					<li>Abre la página en <strong>Safari</strong> (no funciona en Chrome).</li>
					<li>Pulsa el botón <strong>Compartir</strong> (el cuadro con la flecha hacia arriba).</li>
					<li>Elige <strong>«Añadir a pantalla de inicio»</strong>.</li>
					<li>Pulsa <strong>«Añadir»</strong> arriba a la derecha.</li>
				</ol>

				<p class="steps-note">
					Si no aparece la opción de instalar, revisa que estés en el sitio principal (no en
					una vista previa) y actualiza la página.
				</p>
			</section>

			<footer class="foot">
				<span>GANA PRO — Plataforma de élite y alta rentabilidad</span>
				<span class="foot-code">Código: ${referralCode}</span>
			</footer>
		</article>
	</body>
</html>`;

const css = fs.readFileSync('public/invitacion.css');

const server = http.createServer((req, res) => {
	if (req.url.startsWith('/invitacion.css')) {
		res.writeHead(200, { 'Content-Type': 'text/css' });
		res.end(css);
	} else if (req.url.startsWith('/qr.svg')) {
		res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
		res.end(svg);
	} else {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(html, 'utf8');
	}
});

server.listen(4321, async () => {
	console.log('listo en http://localhost:4321');
	const { execFileSync } = await import('node:child_process');
	execFileSync(
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		[
			'--headless',
			'--disable-gpu',
			'--no-sandbox',
			'--print-to-pdf=C:\\temp\\pdftest\\out2.pdf',
			'--no-pdf-header-footer',
			'http://localhost:4321/',
		],
		{ stdio: 'ignore' }
	);
	console.log('PDF generado');
	server.close();
	process.exit(0);
});