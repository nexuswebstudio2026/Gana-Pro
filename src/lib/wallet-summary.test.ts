import { describe, expect, it } from 'vitest';
import {
	MAX_WITHDRAWAL_AMOUNT,
	buildWalletSummary,
	sumApproved,
	sumPending,
	validateWithdrawal,
} from './wallet-summary';

describe('sumPending / sumApproved', () => {
	const rows = [
		{ amount: 10_000, status: 'Pendiente' },
		{ amount: 20_000, status: 'Aprobado' },
		{ amount: 5_000, status: 'Rechazado' },
		{ amount: 7_000, status: 'pendiente' },
	];

	it('solo suma lo pendiente, sin importar mayúsculas', () => {
		expect(sumPending(rows)).toBe(17_000);
	});

	it('solo suma lo aprobado', () => {
		expect(sumApproved(rows)).toBe(20_000);
	});

	it('ignora montos corruptos en vez de devolver NaN', () => {
		expect(sumPending([{ amount: Number.NaN, status: 'Pendiente' }])).toBe(0);
	});
});

describe('buildWalletSummary', () => {
	it('desglosa disponible, comprometido y total', () => {
		const summary = buildWalletSummary({
			balance: 100_000,
			pendingWithdrawals: 30_000,
			pendingPayments: 10_000,
			paidOut: 20_000,
		});
		expect(summary.totalEarned).toBe(100_000);
		expect(summary.committed).toBe(40_000);
		expect(summary.available).toBe(60_000);
		expect(summary.paidOut).toBe(20_000);
	});

	it('nunca muestra saldo disponible negativo', () => {
		// Más comprometido que saldo: se muestra 0, no un negativo que invite
		// a pensar que la plataforma debe dinero.
		const summary = buildWalletSummary({ balance: 10_000, pendingWithdrawals: 50_000 });
		expect(summary.available).toBe(0);
		expect(summary.committed).toBe(50_000);
	});

	it('un saldo corrupto no rompe el desglose', () => {
		const summary = buildWalletSummary({ balance: Number.NaN });
		expect(summary.totalEarned).toBe(0);
		expect(summary.available).toBe(0);
	});
});

describe('validateWithdrawal', () => {
	const summary = buildWalletSummary({
		balance: 100_000,
		pendingWithdrawals: 20_000,
	});
	const ok = { canWithdrawLevel: true, hasWallet: true };

	it('acepta un retiro dentro del disponible', () => {
		expect(validateWithdrawal(50_000, summary, ok)).toBeNull();
	});

	it('rechaza montos no positivos o absurdos', () => {
		expect(validateWithdrawal(0, summary, ok)).toMatch(/mayor que cero/);
		expect(validateWithdrawal(-5, summary, ok)).toMatch(/mayor que cero/);
		expect(validateWithdrawal(MAX_WITHDRAWAL_AMOUNT + 1, summary, ok)).toMatch(/máximo/);
	});

	it('rechaza por saldo insuficiente usando el disponible, no el total', () => {
		// El saldo bruto es 100.000, pero 20.000 ya están comprometidos.
		expect(validateWithdrawal(90_000, summary, ok)).toMatch(/insuficiente/);
	});

	it('rechaza si el nivel no habilita el retiro', () => {
		expect(
			validateWithdrawal(1_000, summary, { canWithdrawLevel: false, hasWallet: true })
		).toMatch(/nivel Oro/);
	});

	it('rechaza si no hay billetera registrada', () => {
		expect(
			validateWithdrawal(1_000, summary, { canWithdrawLevel: true, hasWallet: false })
		).toMatch(/billetera/);
	});
});
