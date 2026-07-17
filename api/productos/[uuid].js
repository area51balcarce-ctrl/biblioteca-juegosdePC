function json(res, status, body){
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .send(JSON.stringify(body));
}

function encodeStoragePath(path=''){
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function isUuid(value=''){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

module.exports = async function handler(req, res){
  if(req.method === 'OPTIONS') return json(res, 204, {});
  if(req.method !== 'GET') return json(res, 405, { error:'Método no permitido' });

  const uuid = String(req.query.uuid || '').trim();
  if(!isUuid(uuid)) return json(res, 400, { error:'UUID inválido' });

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if(!supabaseUrl || !anonKey){
    return json(res, 500, { error:'Configuración de Supabase incompleta' });
  }

  const select = [
    'id','slug','name','description','req_min','req_rec','size','version','languages','trailer_url',
    'install','notes','changelog','dlc','legal_basis','status','cover_path','updated_at',
    'categories(name)','product_tags(tags(name))','product_downloads(type,url,status,position)'
  ].join(',');

  const endpoint = new URL(`${supabaseUrl}/rest/v1/products`);
  endpoint.searchParams.set('id', `eq.${uuid}`);
  endpoint.searchParams.set('status', 'eq.ok');
  endpoint.searchParams.set('select', select);
  endpoint.searchParams.set('limit', '1');

  try{
    const response = await fetch(endpoint, {
      headers:{
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json'
      }
    });

    if(!response.ok){
      const detail = await response.text().catch(()=> '');
      console.error('Supabase REST', response.status, detail);
      return json(res, 502, { error:'No se pudo consultar el catálogo' });
    }

    const rows = await response.json();
    const row = rows[0];
    if(!row) return json(res, 404, { error:'Producto no encontrado o no publicado' });

    const coverUrl = row.cover_path
      ? `${supabaseUrl}/storage/v1/object/public/covers/${encodeStoragePath(row.cover_path)}`
      : null;

    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const productUrl = `${origin}/producto?slug=${encodeURIComponent(row.slug)}`;
    const tags = (row.product_tags || []).map(item => item?.tags?.name).filter(Boolean);
    const downloads = (row.product_downloads || [])
      .filter(item => item?.url && item.status !== 'disabled')
      .map(item => ({
        tipo: item.type || 'Otro',
        url: item.url,
        estado: item.status || 'active',
        posicion: Number(item.position || 0)
      }))
      .sort((a,b) => a.posicion - b.posicion);

    return json(res, 200, {
      producto:{
        id: row.id,
        slug: row.slug,
        nombre: row.name,
        descripcion: row.description || '',
        requisitos_minimos: row.req_min || '',
        requisitos_recomendados: row.req_rec || '',
        tamano: row.size || '',
        version: row.version || '',
        idiomas: row.languages || '',
        trailer_url: row.trailer_url || '',
        descargas: downloads,
        instrucciones: row.install || '',
        notas: row.notes || '',
        changelog: row.changelog || '',
        contenido_adicional: row.dlc || '',
        categoria: row.categories?.name || '',
        etiquetas: tags,
        portada: coverUrl,
        url_producto: productUrl,
        actualizado: row.updated_at || null
      }
    });
  }catch(error){
    console.error(error);
    return json(res, 500, { error:'Error interno al consultar el producto' });
  }
};
