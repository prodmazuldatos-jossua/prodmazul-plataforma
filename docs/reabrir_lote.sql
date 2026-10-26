-- Prodmazul · Fase 4 · Parte 12 · Reabrir un lote cerrado (solo administrador)
-- Cuándo: un operador cerró el lote por error, o llegó otro camión con un lote ya cerrado.
-- Cómo usarlo: Supabase > SQL Editor > New query > reemplaza LOTE_A_REABRIR (por ejemplo 123-456-789) en las DOS líneas > Run (todo el bloque junto).
-- Resultado esperado: una fila con el lote y cerrado = false. Si no devuelve filas, el lote no existe o ya estaba abierto.
-- Queda registrado en la auditoría (acción reabrir_lote). En la Fase 5 habrá un botón en la aplicación para hacerlo.

begin;
update core.lotes
set cerrado = false, cerrado_en = null, cerrado_por = null
where lote_id = 'LOTE_A_REABRIR' and cerrado
returning lote_id, cerrado;
select core.auditar('M01', 'reabrir_lote', 'lote', 'LOTE_A_REABRIR', '{"desde":"SQL Editor"}'::jsonb);
commit;
