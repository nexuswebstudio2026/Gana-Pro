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
