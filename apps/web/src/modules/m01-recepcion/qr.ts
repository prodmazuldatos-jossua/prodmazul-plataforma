import qrcode from 'qrcode-generator';

/** Matriz del código QR (true = módulo oscuro). Nivel de corrección «M»; el tamaño se elige solo según el texto. */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

export function matrizQr(texto: string): boolean[][] {
  const q = qrcode(0, 'M');
  // Se codifica en UTF-8 para que tildes y ñ se lean bien en cualquier lector.
  q.addData(texto, 'Byte');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, f) => Array.from({ length: n }, (_, c) => q.isDark(f, c)));
}

/** Texto del QR de la firma del PDF: lote y nombre de quien realizó la recepción. */
export function textoQrFirma(lote: string, usuario: string): string {
  return `Lote: ${lote}\nRealizado por: ${usuario}`.trim();
}
