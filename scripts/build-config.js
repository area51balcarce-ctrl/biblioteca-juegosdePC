// Genera public/assets/config.js a partir de variables de entorno, para
// que el sitio estático (sin build de por medio hasta ahora) pueda conocer
// la URL y la anon key de Supabase sin tenerlas escritas a mano en el repo.
// Se corre en cada deploy de Vercel (ver "buildCommand" en vercel.json) y,
// en desarrollo local, a mano con las variables ya exportadas en la shell.
const fs = require('fs');
const path = require('path');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_ANON_KEY.\n' +
    'Configuralas en Vercel (Project Settings -> Environment Variables) ' +
    'o exportalas en tu shell local antes de correr "npm run build".\n' +
    'Ver .env.example para los nombres exactos.'
  );
  process.exit(1);
}

const output = `// Generado automáticamente por scripts/build-config.js en cada build.
// No editar a mano: se regenera en cada deploy y no debe commitearse.
window.A51_SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
window.A51_SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
`;

const outPath = path.join(__dirname, '..', 'public', 'assets', 'config.js');
fs.writeFileSync(outPath, output);
console.log('config.js generado en', outPath);
