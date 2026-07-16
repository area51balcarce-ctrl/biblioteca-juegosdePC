const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('\nERROR DE CONFIGURACION: faltan SUPABASE_URL y/o SUPABASE_ANON_KEY.');
  console.error('Cargalas en Vercel > Project > Settings > Environment Variables y volve a desplegar.\n');
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(publicDir, distDir, { recursive: true });
const config = `// Generado automaticamente durante el deploy.\nwindow.A51_SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};\nwindow.A51_SUPABASE_ANON_KEY=${JSON.stringify(SUPABASE_ANON_KEY)};\n`;
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(distDir, 'assets', 'config.js'), config);
console.log('Build completo: carpeta dist creada correctamente.');
