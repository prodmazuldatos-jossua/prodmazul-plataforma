import type { ManifestModulo } from '../../modules';
import { lazy } from 'react';

// El módulo se descarga solo cuando se entra a él: la pantalla de acceso y el inicio cargan más rápido.
const PaginaM01 = lazy(() => import('./PaginaM01'));

export const manifestM01: ManifestModulo = { id: 'M01', nombre: 'Recepción', ruta: '/m01', componente: PaginaM01 };
