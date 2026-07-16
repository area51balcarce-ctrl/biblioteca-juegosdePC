module.exports = async function handler(req, res){
  if(req.method !== 'GET') return res.status(405).send('Método no permitido');
  const target = String(req.query.url || '');
  let parsed;
  try{ parsed = new URL(target); }catch{ return res.status(400).send('URL inválida'); }
  if(parsed.protocol !== 'https:') return res.status(400).send('Solo HTTPS');
  const allowed = ['media.rawg.io','shared.fastly.steamstatic.com','cdn.cloudflare.steamstatic.com','steamcdn-a.akamaihd.net','cdn.akamai.steamstatic.com'];
  if(!allowed.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) return res.status(403).send('Host no permitido');
  try{
    const upstream = await fetch(parsed.toString());
    if(!upstream.ok) return res.status(502).send('No se pudo descargar la imagen');
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    if(!type.startsWith('image/')) return res.status(415).send('El recurso no es una imagen');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if(buffer.length > 5 * 1024 * 1024) return res.status(413).send('Imagen demasiado grande');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control','public, max-age=86400');
    return res.status(200).send(buffer);
  }catch(error){
    console.error(error);
    return res.status(500).send('No se pudo procesar la imagen');
  }
};
