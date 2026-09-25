/** Shared user record stored in `data/users.json`. */
export interface User {
	username: string;
	email: string;
	password: string; // stored as "salt:hash"
}