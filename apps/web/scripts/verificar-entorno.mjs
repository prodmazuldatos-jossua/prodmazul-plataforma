// Prodmazul · verificación del entorno de desarrollo.
// Se ejecuta sola antes de `npm run dev`, `npm run build` y `npm run test`.
// Si todo está bien, no imprime nada. Si algo falta, explica la causa probable y cómo arreglarlo.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [mayor, menor] = process.versions.node.split('.').map(Number);
const nodeOk = (mayor === 20 && menor >= 19) || (mayor === 22 && menor >= 12) || mayor >= 23;
const plataforma = `${process.platform} ${process.arch}`;

async function cargaCorrecta() {
  try { await import('rolldown'); return null; } catch (e) { return e; }
}

function npmConfig(clave) {
  try { return execSync(`npm config get ${clave}`, { stdio: ['ignore', 'pipe', 'ignore'], shell: true }).toString().trim(); }
  catch { return '?'; }
}

const fallo = await cargaCorrecta();
if (nodeOk && !fallo) process.exit(0);

const L = [];
L.push('');
L.push('============================================================');
L.push(' PRODMAZUL: la herramienta de compilación no puede iniciar');
L.push('============================================================');
L.push(` Node.js:       v${process.versions.node}   ${nodeOk ? '(versión correcta)' : '(MUY ANTIGUA: se necesita v20.19 o superior, o v22.12 o superior)'}`);
L.push(` Equipo:        ${plataforma}   ${process.arch === 'x64' || process.arch === 'arm64' ? '' : '(Node de 32 bits: reinstala la versión de 64 bits)'}`);

// ¿Qué componente nativo existe en node_modules?
const carpetaRolldown = path.resolve('node_modules', '@rolldown');
let presentes = [];
try { presentes = readdirSync(carpetaRolldown).filter((d) => d.startsWith('binding-')); } catch { /* no existe */ }
L.push(` Componentes:   ${presentes.length ? presentes.join(', ') : '(ninguno instalado)'}`);
for (const d of presentes) {
  try {
    const archivos = readdirSync(path.join(carpetaRolldown, d));
    if (!archivos.some((f) => f.endsWith('.node'))) L.push(`                 ⚠ a ${d} le falta el archivo .node (probablemente lo eliminó el antivirus)`);
  } catch { /* ignorar */ }
}
const omit = npmConfig('omit');
if (omit.includes('optional')) L.push(` npm omit:      "${omit}"  ⚠ npm está configurado para NO instalar componentes opcionales`);
L.push('');
L.push(' CAUSA MÁS PROBABLE Y SOLUCIÓN');
if (!nodeOk) {
  L.push('  1. Tu Node.js es antiguo. Actualízalo:  winget upgrade OpenJS.NodeJS.LTS');
  L.push('     Cierra y abre PowerShell, comprueba con  node --version  y vuelve al paso 2.');
}
if (process.arch !== 'x64' && process.arch !== 'arm64') {
  L.push('  1. Estás usando Node de 32 bits. Desinstálalo e instala el de 64 bits:  winget install OpenJS.NodeJS.LTS');
}
if (omit.includes('optional')) {
  L.push('  1. Quita la opción que omite componentes opcionales:  npm config delete omit');
  L.push('     (y si existe la variable de entorno NPM_CONFIG_OMIT, bórrala).');
}
L.push(`  ${nodeOk ? '1' : '2'}. Instalación incompleta o dañada. Borra e instala de nuevo SIN tocar package-lock.json:`);
L.push('       Remove-Item -Recurse -Force node_modules');
L.push('       npm ci');
L.push(`  ${nodeOk ? '2' : '3'}. Si después de eso aparece la carpeta del componente pero el error sigue, el antivirus bloqueó el archivo .node:`);
L.push('       abre «Seguridad de Windows» > «Protección contra virus y amenazas» > «Historial de protección»,');
L.push('       restaura el archivo y agrega la carpeta C:\\Proyectos a las exclusiones. Luego repite el paso anterior.');
L.push('');
if (fallo) L.push(` Detalle técnico: ${String(fallo.cause?.message ?? fallo.message).split('\n')[0]}`);
L.push('============================================================');
console.error(L.join('\n'));
process.exit(1);
