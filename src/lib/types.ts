export interface Testimonial {
	id?: string;
	date: string;
	username: string;
	email?: string;
	level?: string;
	/** Valoración de 1 a 5 estrellas sobre la metodología. */
	rating: number;
	comment: string;
	/** Nombre del archivo de imagen almacenado en Google Drive. */
	imageName?: string;
	/** ID del archivo en Google Drive. */
	imageId?: string;
	/** Enlace público de visualization de la imagen. */
	imageUrl?: string;
	/** Carpeta de Drive donde se guardan las imágenes. */
	folderUrl?: string;
	/** 'visible' oculta el testimonio sin borrarlo. */
	status?: string;
}

export interface User {
	id?: string;
	username: string;
	email: string;
	password: string; // stored as "salt:hash" or plaintext fallback
	role?: string;
	documentType?: string;
	documentNumber?: string;
	paymentMethod?: string;
	walletNumber?: string;
	balance?: string;
	level?: string;
	/** Usuario elegido como líder directo de la matriz. */
	matrixParent?: string;
	referralCode?: string;
	ownCode?: string;
	documentStatus?: string;
	documentLink?: string;
	scannedDocument?: string;
	/** Número de Identificación Tributaria (DIAN). */
	nit?: string;
	/** Nombre del archivo del RUT emitido por la DIAN. */
	scannedRut?: string;
	/** Enlace al archivo del RUT. */
	rutLink?: string;
	registeredAt?: string;
	/** Dirección de residencia. */
	address?: string;
	/** Barrio de residencia. */
	neighborhood?: string;
	/** Ciudad de residencia. */
	city?: string;
	/** Teléfono de contacto. */
	phone?: string;
	/** Contacto de WhatsApp. */
	whatsapp?: string;
	/** Enlace de Google Maps con la última ubicación compartida. */
	locationUrl?: string;
}
