const dns = require('dns').promises;
const net = require('net');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12000;

function isPrivateIp(ip){
  if(net.isIP(ip) === 4){
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }

  if(net.isIP(ip) === 6){
    const value = ip.toLowerCase();
    return value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe80:');
  }

  return true;
}

async function validatePublicHost(hostname){
  const records = await dns.lookup(hostname, { all:true });
  if(!records.length || records.some(record => isPrivateIp(record.address))){
    throw new Error('Host no permitido');
  }
}

function isAllowedHost(hostname){
  const allowed = [
    'images.igdb.com',
    'shared.fastly.steamstatic.com',
    'cdn.cloudflare.steamstatic.com',
    'steamcdn-a.akamaihd.net',
    'cdn.akamai.steamstatic.com',
    'cdn.steamgriddb.com',
    'cdn2.steamgriddb.com',
    'cdn3.steamgriddb.com',
    'steamgriddb.com'
  ];

  return allowed.some(host =>
    hostname === host || hostname.endsWith(`.${host}`)
  );
}

function upstreamHeaders(parsed){
  const headers = {
    'Accept':'image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8',
    'Accept-Language':'es-ES,es;q=0.9,en;q=0.8',
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
  };

  if(parsed.hostname.includes('steamgriddb.com')){
    headers.Referer = 'https://www.steamgriddb.com/';
    headers.Origin = 'https://www.steamgriddb.com';
  }else if(parsed.hostname.includes('steamstatic.com') || parsed.hostname.includes('akamaihd.net')){
    headers.Referer = 'https://store.steampowered.com/';
  }else if(parsed.hostname === 'images.igdb.com'){
    headers.Referer = 'https://www.igdb.com/';
  }

  return headers;
}

async function fetchWithTimeout(url, options={}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try{
    return await fetch(url, {
      ...options,
      redirect:'follow',
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET'){
    return res.status(405).send('Método no permitido');
  }

  const target = String(req.query.url || '').trim();
  let parsed;

  try{
    parsed = new URL(target);
  }catch{
    return res.status(400).send('URL inválida');
  }

  if(parsed.protocol !== 'https:'){
    return res.status(400).send('Solo HTTPS');
  }

  if(!isAllowedHost(parsed.hostname)){
    return res.status(403).send('Host no permitido');
  }

  try{
    await validatePublicHost(parsed.hostname);

    const upstream = await fetchWithTimeout(parsed.toString(), {
      headers:upstreamHeaders(parsed)
    });

    if(!upstream.ok){
      console.warn('Image proxy upstream error', {
        hostname:parsed.hostname,
        status:upstream.status
      });
      return res.status(502).send(`No se pudo descargar la imagen (${upstream.status})`);
    }

    const type = String(upstream.headers.get('content-type') || '').toLowerCase();
    if(!type.startsWith('image/')){
      return res.status(415).send('El recurso no es una imagen');
    }

    const declaredSize = Number(upstream.headers.get('content-length') || 0);
    if(declaredSize > MAX_IMAGE_BYTES){
      return res.status(413).send('Imagen demasiado grande');
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if(!buffer.length){
      return res.status(502).send('La imagen llegó vacía');
    }
    if(buffer.length > MAX_IMAGE_BYTES){
      return res.status(413).send('Imagen demasiado grande');
    }

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control','public, max-age=86400, s-maxage=86400');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).send(buffer);
  }catch(error){
    console.error('Image proxy error:', error);
    if(error?.name === 'AbortError'){
      return res.status(504).send('La descarga de la imagen agotó el tiempo');
    }
    return res.status(500).send('No se pudo procesar la imagen');
  }
};
