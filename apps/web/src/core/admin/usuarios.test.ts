import { describe, expect, it } from 'vitest';
import { errorClave, textoEvento, textoVersionFuncion } from './usuarios';

describe('contraseña', () => {
  it('mínimo, máximo y espacios', () => {
    expect(errorClave('corta')).toMatch(/al menos 10/);
    expect(errorClave('a'.repeat(73))).toMatch(/demasiado larga/);
    expect(errorClave('é'.repeat(37))).toMatch(/demasiado larga/);
    expect(errorClave(' Abcdefgh123')).toMatch(/espacios/);
    expect(errorClave('Zk7mQ2vR9xLp')).toBeNull();
  });
});

describe('historial', () => {
  const e = (accion: string, detalle: Record<string, unknown> = {}) => ({ accion, usuario: 'Ana', usuario_correo: 'ana@x.com', detalle });
  it('frases claras', () => {
    expect(textoEvento(e('crear_usuario'))).toBe('Creó a Ana.');
    expect(textoEvento(e('desactivar_usuario'))).toBe('Desactivó a Ana.');
    expect(textoEvento(e('reactivar_usuario'))).toBe('Reactivó a Ana.');
    expect(textoEvento(e('cambiar_clave_usuario'))).toBe('Cambió la contraseña de Ana.');
    expect(textoEvento(e('cambiar_nombre_usuario', { antes: 'A', despues: 'Ana' }))).toBe('Cambió el nombre de «A» a «Ana».');
    expect(textoEvento(e('cambiar_roles_usuario', { antes: { M01: 'operativo' }, despues: {} }))).toBe('Cambió el acceso de Ana: de Módulo 1: operativo a sin acceso.');
  });
  it('usa el correo si no hay nombre y no falla con datos raros', () => {
    expect(textoEvento({ accion: 'crear_usuario', usuario: null, usuario_correo: 'z@x.com', detalle: {} })).toBe('Creó a z@x.com.');
    expect(textoEvento({ accion: 'otra', usuario: null, usuario_correo: null, detalle: undefined as never })).toContain('otra');
  });
  it('nunca imprime una contraseña aunque llegara en el detalle', () => {
    expect(textoEvento(e('cambiar_clave_usuario', { clave: 'secreta123' }))).not.toContain('secreta123');
  });
});

describe('comprobar función', () => {
  it('versión nueva, vieja y error', () => {
    expect(textoVersionFuncion('2.0')).toMatchObject({ tipo: 'exito' });
    expect(textoVersionFuncion(null, 'Acción no reconocida.')).toMatchObject({ tipo: 'aviso' });
    expect(textoVersionFuncion(null, 'La función «admin-usuarios» todavía no está instalada en Supabase.')).toMatchObject({ tipo: 'error' });
    expect(textoVersionFuncion(null)).toMatchObject({ tipo: 'aviso' });
  });
});
