import type { ComponentType } from 'react';
import { manifestM01 } from './modules/m01-recepcion/manifest';

/** Contrato que cumple cada módulo para registrarse en la plataforma. */
export interface ManifestModulo {
  id: string;          // 'M01'
  nombre: string;
  ruta: string;        // '/m01'
  componente: ComponentType;
}

/** Para agregar un módulo: crear su carpeta, su manifest y agregarlo a esta lista. */
export const MODULOS: ManifestModulo[] = [manifestM01];
