import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';
import { createAdminExpense, listAdminExpenses, recordAdminAudit } from '../../../lib/admin-records';
export const prerender = false;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const GET: APIRoute = async ({ locals }) => {
 if (!locals.user) return json({ ok:false, message:'Sesión no válida.' },401);
 if (!isAdminRole(locals.user.role)) return json({ ok:false, message:'Sin permisos.' },403);
 try { return json({ ok:true, expenses:await listAdminExpenses() }); } catch { return json({ ok:false, message:'No se pudieron consultar los gastos.' },500); }
};
export const POST: APIRoute = async ({ locals, request }) => {
 if (!locals.user) return json({ ok:false, message:'Sesión no válida.' },401);
 if (!isAdminRole(locals.user.role)) return json({ ok:false, message:'Sin permisos.' },403);
 try {
  const body = await request.json();
  const category = String(body.category || '').trim().slice(0,60);
  const description = String(body.description || '').trim().slice(0,240);
  const amount = Number(body.amount);
  if (!category || !description || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return json({ ok:false, message:'Completa categoría, descripción y un monto válido.' },400);
  const expense = await createAdminExpense({ category, description, amount:Math.round(amount), admin:locals.user.username });
  await recordAdminAudit({ admin:locals.user.username, action:'Registro de gasto', entity:'Contabilidad', reference:expense.id, detail:`${expense.category}: ${expense.description} · $${expense.amount}` });
  return json({ ok:true, expense });
 } catch { return json({ ok:false, message:'No se pudo guardar el gasto.' },500); }
};
