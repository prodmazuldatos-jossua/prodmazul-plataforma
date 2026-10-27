// Doble mínimo de supabase-js para probar index.ts completo (cómo conecta las dependencias).
export const registro = globalThis.__registro ??= { creados: [], rpc: [], admin: [], escenario: {} };
export function createClient(url, clave, opciones) {
  const esServicio = clave === 'CLAVE_SERVICIO';
  const token = opciones?.global?.headers?.Authorization;
  registro.creados.push({ servicio: esServicio, token });
  const E = () => registro.escenario;
  return {
    auth: {
      async getUser() { return E().sesionValida === false || !token ? { data: { user: null }, error: { message: 'x' } } : { data: { user: { id: 'ADMIN-ID' } }, error: null }; },
      admin: {
        async createUser(a) { if (!esServicio) throw new Error('createUser sin clave de servicio'); registro.admin.push(['createUser', a.email, a.password]); return E().existe ? { data: null, error: { message: 'User already registered' } } : { data: { user: { id: 'NUEVO-ID' } }, error: null }; },
        async deleteUser(id) { if (!esServicio) throw new Error('x'); registro.admin.push(['deleteUser', id]); return {}; },
        async updateUserById(id, a) { if (!esServicio) throw new Error('x'); registro.admin.push(['updateUserById', id, a.password]); return { error: null }; },
        async getUserById(id) { return { data: { user: E().sinUsuario ? null : { id } } }; },
      },
    },
    async rpc(nombre, args) {
      if (nombre === 'api_mi_perfil') return { data: E().perfil ?? { es_admin_general: true, activo: true }, error: null };
      if (!esServicio) throw new Error('rpc ' + nombre + ' sin clave de servicio');
      registro.rpc.push([nombre, args]);
      return { error: E().errorRpc ? { message: E().errorRpc } : null };
    },
  };
}
