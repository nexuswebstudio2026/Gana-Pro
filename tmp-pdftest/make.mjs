// Reproduce la pagina de invitacion tal cual la imprime el usuario y genera
// un PDF con Chrome headless, para inspeccionar como queda el texto.
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

const css = fs.readFileSync('public/invitacion.css', 'utf8').replace(
	/\/\*[^*]*\*\//g,
	''
);

const referralCode = 'JAC42';

const html = `<!doctype html>
<html lang="es">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Invitacion GANA PRO — ${referralCode}</title>
		<style>${css}</style>
	</head>
	<body>
		<div class="screen-actions no-print">
			<button type="button" class="btn-print">Descargar / Imprimir PDF</button>
			<p class="hint">
				En el diálogo elige <strong>«Guardar como PDF»</strong> como destino.
			</p>
		</div>

		<article class="sheet">
			<header class="head">
				<span class="brand font-cinzel">GANA <em>PRO</em></span>
				<h1>Te invito a GANA PRO</h1>
				<p class="lead">
					Gana $1.000 por cada persona que se registre con mi código, cuando su primera
					recarga sea aprobada.
				</p>
			</header>

			<section class="qr-block">
				<div class="qr-frame">
					<div style="width:300px;height:300px">${svg}</div>
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
				<p class="steps-lead">La app se instala desde el navegador. Añadir áéíóúñÑ ¿?</p>
				<h3>En Android (Chrome)</h3>
				<ol>
					<li>Abre <strong>gana-pro.vercel.app</strong> en Chrome.</li>
					<li>Pulsa los <strong>tres puntos</strong> de la esquina superior derecha.</li>
					<li>Elige <strong>«Instalar aplicación»</strong>.</li>
				</ol>
				<p class="steps-note">Si no aparece la opción, revisa que estés en el sitio principal.</p>
			</section>

			<footer class="foot">
				<span>GANA PRO — Plataforma de élite y alta rentabilidad</span>
				<span class="foot-code">Código: ${referralCode}</span>
			</footer>
		</article>
	</body>
</html>`;

fs.writeFileSync('tmp-pdftest/invitacion.html', html, 'utf8');
console.log('HTML escrito, bytes:', Buffer.byteLength(html, 'utf8'));
console.log('acentos presentes en el HTML:', /áéíóúñÁÉÍÓÚÑ«»/.test(html));