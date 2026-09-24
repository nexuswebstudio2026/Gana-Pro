import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Path to the data directory at the project root. */
const DATA_DIR = join(process.cwd(), 'data');

/**
 * Read a JSON file from the data directory.
 * Returns the parsed content, or `fallback` if the file doesn't exist or is invalid.
 */
export function readJSON<T>(filename: string, fallback: T): T {
	try {
		const path = join(DATA_DIR, filename);
		const raw = readFileSync(path, 'utf-8');
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/**
 * Write a value as JSON to the data directory.
 */
export function writeJSON(filename: string, data: unknown): void {
	const path = join(DATA_DIR, filename);
	writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}