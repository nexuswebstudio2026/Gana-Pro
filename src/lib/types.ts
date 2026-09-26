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
	referralCode?: string;
	ownCode?: string;
	documentStatus?: string;
	documentLink?: string;
	scannedDocument?: string;
	registeredAt?: string;
}
