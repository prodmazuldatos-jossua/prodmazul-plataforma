import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import type { DatosExportacion } from './excel';

/** Pide todos los datos a la base, arma el Excel en este dispositivo y lo descarga. Devuelve el nombre y cuántas recepciones trae. */
export async function descargarExcelRecepciones(): Promise<{ nombre: string; recepciones: number }> {
  const { data, error } = await supabase.rpc('api_m01_exportar');
  if (error) throw aApiError(error);
  const d = data as DatosExportacion;
  const { construirExcel, nombreArchivoExcel } = await import('./excel');
  const bytes = construirExcel(d);
  const nombre = nombreArchivoExcel();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { nombre, recepciones: d.recepciones.length };
}
