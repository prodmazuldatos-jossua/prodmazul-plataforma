import type { ReactNode, SVGProps } from 'react';

/** Iconos de línea (24×24). Decorativos: no tienen texto propio, el texto del botón o del título los describe. */
const TRAZOS: Record<string, ReactNode> = {
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  cerrar: <><path d="M6 6l12 12M18 6L6 18" /></>,
  inicio: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10.5V19h12v-8.5" /><path d="M10 19v-5h4v5" /></>,
  recepcion: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>,
  camion: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></>,
  candado: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2" /></>,
  salir: <><path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10M14 8l4 4-4 4M18 12H9" /></>,
  usuario: <><circle cx="12" cy="8.5" r="3.7" /><path d="M4.5 20c.6-3.7 3.7-5.8 7.5-5.8s6.9 2.1 7.5 5.8" /></>,
  correo: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4.5 7.5 7.5 6 7.5-6" /></>,
  ojo: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  ojoNo: <><path d="M3 3l18 18M10.4 5.7c.5-.1 1.1-.2 1.6-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.3M6.6 7.2A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9M9.9 9.9a3.8 3.8 0 0 0 4.2 4.2" /></>,
  senal: <><path d="M5 19v-3M10 19v-6M15 19V9M20 19V5" /></>,
  sinSenal: <><path d="M5 19v-3M10 19v-6M15 19v-3" /><path d="m17.5 7.5 4 4m0-4-4 4" /></>,
  mas: <><path d="M12 5v14M5 12h14" /></>,
  buscar: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  pdf: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" /></>,
  foto: <><rect x="3" y="6" width="18" height="14" rx="2.5" /><circle cx="12" cy="13" r="3.5" /><path d="M8.5 6 10 3.8h4L15.5 6" /></>,
  editar: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  papelera: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" /></>,
  anular: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  reactivar: <><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" /></>,
  alerta: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  error: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 15.8v.1" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></>,
  ok: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12.3 2.8 2.8L16.2 9.5" /></>,
  reloj: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  filtro: <><path d="M4 5.5h16l-6 7.5v5.5l-4-2V13z" /></>,
  atras: <><path d="m14 6-6 6 6 6M8.5 12H20" /></>,
  izquierda: <><path d="m14.5 6-6 6 6 6" /></>,
  derecha: <><path d="m9.5 6 6 6-6 6" /></>,
  guardar: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  enviar: <><path d="m21 4-9.5 16-2.5-6.5L2.5 11z" /><path d="m21 4-12 9.5" /></>,
  nube: <><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.9A6 6 0 0 1 18 9.8a4.4 4.4 0 0 1-.5 8.7z" /><path d="M12 11v6m-2.5-2.5L12 17l2.5-2.5" /></>,
  balanza: <><path d="M12 4v16M6 20h12M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z" /></>,
  termometro: <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 9v7" /></>,
  caja: <><path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4z" /><path d="M7.8 6 16 10v4M3.5 8 12 12l8.5-4M12 12v8" /></>,
  nota: <><path d="M6 3.5h9l4 4v13H6z" /><path d="M9 11h7M9 14.5h7M9 18h4" /></>,
  lista: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r=".8" /><circle cx="4.8" cy="12" r=".8" /><circle cx="4.8" cy="17.5" r=".8" /></>,
};

export type NombreIcono = keyof typeof TRAZOS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> { nombre: NombreIcono; tamano?: number }

export function Icono({ nombre, tamano = 20, className, ...resto }: Props) {
  return (
    <svg className={`icono${className ? ` ${className}` : ''}`} width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...resto}>
      {TRAZOS[nombre]}
    </svg>
  );
}

/** Icono que corresponde a cada módulo de la plataforma. */
export function iconoDeModulo(id: string): NombreIcono {
  return id === 'M01' ? 'recepcion' : 'caja';
}
