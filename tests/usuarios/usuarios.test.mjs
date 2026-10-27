// Pruebas de la función «admin-usuarios» v2 (Fase 5 · Parte 9): lógica de nucleo.ts con dobles de Supabase.
// Ejecutar:  node --experimental-strip-types usuarios.test.mjs
import { procesar, validarClave, validarRoles, VERSION } from '../../supabase/functions/admin-usuarios/nucleo.ts';

let ok = 0, mal = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('  ✔', n); } else { mal++; console.log('  ✘', n, x); } };
const ADMIN = '11111111-1111-1111-1111-111111111111';
const NUEVO = '22222222-2222-2222-2222-222222222222';
const OBJ = '33333333-3333-3333-3333-333333333333';
const CLAVE = 'Zk7mQ2vR9xLp';

function doble(o = {}) {
  const llamadas = []; const logs = [];
  const d = {
    llamadas, logs,
    async sesion(tk) { llamadas.push(['sesion']); return o.sesion === null ? null : (o.sesion ?? { id: ADMIN }); },
    async perfil() { llamadas.push(['perfil']); return o.perfil === undefined ? { es_admin_general: true, activo: true } : o.perfil; },
    async crearCuenta(c, k) { llamadas.push(['crearCuenta', c, k]); return o.crear ?? { id: NUEVO }; },
    async borrarCuenta(id) { llamadas.push(['borrarCuenta', id]); if (o.borrarFalla) throw new Error('x'); },
    async cambiarClave(id, k) { llamadas.push(['cambiarClave', id, k]); return o.cambiar ?? true; },
    async existePerfil(id) { llamadas.push(['existePerfil', id]); return o.existe ?? true; },
    async rpc(n, a) { llamadas.push(['rpc', n, a]); return (o.rpc && o.rpc[n]) ?? {}; },
    log(l) { logs.push(l); },
  };
  return d;
}
const llamo = (d, nombre) => d.llamadas.filter((l) => l[0] === nombre);
const base = { accion: 'crear', correo: 'Ana@Prodmazul.com ', nombre: '  Ana   Pérez ', clave: CLAVE, roles: [{ modulo_id: 'M01', rol_id: 'operativo' }] };

console.log('\nQuién puede usarla');
let d = doble(); let r = await procesar('', base, d);
t('sin sesión: rechazada y sin tocar nada', r.ok === false && /Sesión no válida/.test(r.error) && d.llamadas.length === 0);
d = doble({ sesion: null }); r = await procesar('Bearer x', base, d);
t('sesión inválida: rechazada', r.ok === false && /Sesión no válida/.test(r.error) && llamo(d, 'crearCuenta').length === 0);
d = doble({ perfil: { es_admin_general: false, activo: true } });
for (const accion of ['crear', 'clave', 'version']) {
  r = await procesar('Bearer x', { ...base, accion, user_id: OBJ }, d);
  t(`usuario de módulo no puede «${accion}»`, r.ok === false && /Solo el administrador general/.test(r.error));
}
t('y no se creó ni cambió nada', llamo(d, 'crearCuenta').length === 0 && llamo(d, 'cambiarClave').length === 0 && llamo(d, 'rpc').length === 0);
d = doble({ perfil: { es_admin_general: true, activo: false } }); r = await procesar('Bearer x', base, d);
t('administrador desactivado: rechazado', r.ok === false && llamo(d, 'crearCuenta').length === 0);
d = doble({ perfil: null }); r = await procesar('Bearer x', base, d);
t('sin perfil: rechazado', r.ok === false);
d = doble(); r = await procesar('Bearer x', null, d);
t('cuerpo vacío: solicitud no válida', r.ok === false && /no válida/.test(r.error));
r = await procesar('Bearer x', [1], doble());
t('cuerpo que no es objeto: solicitud no válida', r.ok === false);
r = await procesar('Bearer x', { accion: 'borrar_todo' }, doble());
t('acción desconocida', r.ok === false && /no reconocida/.test(r.error));

console.log('\nVersión');
r = await procesar('Bearer x', { accion: 'version' }, doble());
t('responde la versión y las acciones', r.ok === true && r.version === VERSION && r.acciones.includes('crear') && r.acciones.includes('clave'));

console.log('\nCrear usuario');
d = doble(); r = await procesar('Bearer x', base, d);
t('alta correcta', r.ok === true && r.user_id === NUEVO);
const [, correoUsado, claveUsada] = llamo(d, 'crearCuenta')[0] ?? [];
t('el correo se guarda en minúsculas y sin espacios', correoUsado === 'ana@prodmazul.com');
t('la contraseña va solo a Supabase Auth', claveUsada === CLAVE);
const reg = llamo(d, 'rpc').find((l) => l[1] === 'adm_registrar_usuario');
t('registra con nombre limpio, roles y quién lo hizo', reg && reg[2].p_nombre === 'Ana Pérez' && reg[2].p_user === NUEVO && reg[2].p_admin === ADMIN && reg[2].p_roles.length === 1);
t('la contraseña NO viaja a la base de datos de la aplicación', !JSON.stringify(llamo(d, 'rpc')).includes(CLAVE));
t('la respuesta NO contiene la contraseña', !JSON.stringify(r).includes(CLAVE));
t('el registro de la función NO contiene datos de la solicitud', d.logs.length > 0 && !d.logs.join('|').includes(CLAVE) && !d.logs.join('|').includes('ana@') && !d.logs.join('|').includes('Pérez'));

const invalidos = [
  ['correo sin @', { correo: 'ana.prodmazul.com' }, /correo/],
  ['correo vacío', { correo: '' }, /correo/],
  ['nombre vacío', { nombre: '   ' }, /nombre/],
  ['nombre de 61 caracteres', { nombre: 'x'.repeat(61) }, /nombre/],
  ['contraseña de 9 caracteres', { clave: 'Abcdef123' }, /al menos 10/],
  ['contraseña de 73 caracteres', { clave: 'a'.repeat(73) }, /demasiado larga/],
  ['contraseña con espacio al final', { clave: 'Abcdefgh123 ' }, /espacios/],
  ['contraseña igual al correo', { correo: 'abcdefghij@x.com', clave: 'abcdefghij@x.com' }, /igual al correo/],
  ['roles que no son lista', { roles: {} }, /roles/],
  ['rol sin módulo', { roles: [{ rol_id: 'operativo' }] }, /roles/],
  ['rol vacío', { roles: [{ modulo_id: 'M01', rol_id: null }] }, /roles/],
  ['dos roles para el mismo módulo', { roles: [{ modulo_id: 'M01', rol_id: 'operativo' }, { modulo_id: 'M01', rol_id: 'consulta' }] }, /dos roles/],
];
for (const [nombre, cambio, re] of invalidos) {
  d = doble(); r = await procesar('Bearer x', { ...base, ...cambio }, d);
  t(`rechaza: ${nombre} (sin crear la cuenta)`, r.ok === false && re.test(r.error) && llamo(d, 'crearCuenta').length === 0, JSON.stringify(r));
}
d = doble(); r = await procesar('Bearer x', { ...base, clave: 'é'.repeat(37) }, d);
t('la longitud máxima cuenta bytes (37 «é» = 74 bytes)', r.ok === false && /demasiado larga/.test(r.error));
d = doble(); r = await procesar('Bearer x', { ...base, roles: undefined }, d);
t('sin roles: se crea el usuario sin acceso a módulos', r.ok === true && llamo(d, 'rpc')[0][2].p_roles.length === 0);

d = doble({ crear: { error: 'existe' } }); r = await procesar('Bearer x', base, d);
t('correo repetido: mensaje claro y no se registra nada', r.ok === false && /Ya existe/.test(r.error) && llamo(d, 'rpc').length === 0);
d = doble({ crear: { error: 'otro' } }); r = await procesar('Bearer x', base, d);
t('fallo de Auth: mensaje genérico', r.ok === false && /No se pudo crear/.test(r.error));
d = doble({ rpc: { adm_registrar_usuario: { error: 'E_VALIDACION|El módulo o el rol no existen.' } } }); r = await procesar('Bearer x', base, d);
t('si el registro falla, se BORRA la cuenta creada', r.ok === false && /rol no existen|módulo o el rol/.test(r.error) && llamo(d, 'borrarCuenta')[0]?.[1] === NUEVO);
d = doble({ rpc: { adm_registrar_usuario: { error: 'boom' } }, borrarFalla: true }); r = await procesar('Bearer x', base, d);
t('si además falla el borrado, igual responde error controlado', r.ok === false && /No se pudo registrar/.test(r.error));

console.log('\nCambiar contraseña');
d = doble(); r = await procesar('Bearer x', { accion: 'clave', user_id: OBJ, clave: CLAVE }, d);
t('cambio correcto', r.ok === true && !r.aviso);
t('la clave va solo a Auth', llamo(d, 'cambiarClave')[0][2] === CLAVE && llamo(d, 'cambiarClave')[0][1] === OBJ);
const aud = llamo(d, 'rpc').find((l) => l[1] === 'adm_auditar_clave');
t('deja constancia: quién y a quién (sin clave)', aud && aud[2].p_user === OBJ && aud[2].p_admin === ADMIN && !JSON.stringify(aud).includes(CLAVE));
t('la respuesta y el registro NO contienen la clave', !JSON.stringify(r).includes(CLAVE) && !d.logs.join('|').includes(CLAVE));
for (const [n, body, re] of [
  ['identificador inválido', { user_id: 'abc', clave: CLAVE }, /Usuario no válido/],
  ['identificador con inyección', { user_id: OBJ + "'; drop table x;--", clave: CLAVE }, /Usuario no válido/],
  ['clave corta', { user_id: OBJ, clave: 'corta' }, /al menos 10/],
  ['clave larga', { user_id: OBJ, clave: 'a'.repeat(80) }, /demasiado larga/],
]) {
  d = doble(); r = await procesar('Bearer x', { accion: 'clave', ...body }, d);
  t(`rechaza: ${n}`, r.ok === false && re.test(r.error) && llamo(d, 'cambiarClave').length === 0, JSON.stringify(r));
}
d = doble({ existe: false }); r = await procesar('Bearer x', { accion: 'clave', user_id: OBJ, clave: CLAVE }, d);
t('usuario inexistente: rechazado', r.ok === false && /no existe/.test(r.error) && llamo(d, 'cambiarClave').length === 0);
d = doble({ cambiar: false }); r = await procesar('Bearer x', { accion: 'clave', user_id: OBJ, clave: CLAVE }, d);
t('si Auth falla: error y SIN constancia falsa', r.ok === false && llamo(d, 'rpc').length === 0);
d = doble({ rpc: { adm_auditar_clave: { error: 'x' } } }); r = await procesar('Bearer x', { accion: 'clave', user_id: OBJ, clave: CLAVE }, d);
t('si falla la auditoría: se avisa (no se calla)', r.ok === true && /auditoría/.test(r.aviso));

console.log('\nValidadores');
t('validarClave acepta una clave normal', validarClave(CLAVE) === null);
t('validarRoles acepta lista vacía y nula', validarRoles([]).roles.length === 0 && validarRoles(null).roles.length === 0);

console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
