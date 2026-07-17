const dns = require('dns').promises;
const net = require('net');

const BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.LINK_CHECK_BATCH_SIZE || 25)));
const CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.LINK_CHECK_CONCURRENCY || 3)));
const TIMEOUT_MS = Math.max(3000, Math.min(15000, Number(process.env.LINK_CHECK_TIMEOUT_MS || 9000)));

function sendJson(res, status, body){
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store')
    .send(JSON.stringify(body));
}

function isPrivateIp(ip){
  if(net.isIP(ip) === 4){
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168);
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

async function timedFetch(url, options={}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try{
    return await fetch(url, {
      ...options,
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 AREA51-Link-Checker/1.0',
        ...options.headers
      }
    });
  }finally{
    clearTimeout(timer);
  }
}

async function inspectLink(raw){
  const value = String(raw || '').trim();

  if(value.startsWith('magnet:?')){
    return { healthStatus:'active', httpStatus:null, reason:'magnet' };
  }

  let url;
  try{
    url = new URL(value);
    if(!['http:', 'https:'].includes(url.protocol)) throw new Error();
    await validatePublicHost(url.hostname);
  }catch{
    return { healthStatus:'review', httpStatus:null, reason:'invalid-url' };
  }

  try{
    let response = await timedFetch(url.toString(), { method:'HEAD' });

    if([405, 501].includes(response.status)){
      response = await timedFetch(url.toString(), {
        method:'GET',
        headers:{ Range:'bytes=0-0' }
      });
    }

    if(response.status >= 200 && response.status < 400){
      return { healthStatus:'active', httpStatus:response.status, reason:null };
    }

    if([404, 410].includes(response.status)){
      return { healthStatus:'down', httpStatus:response.status, reason:null };
    }

    return {
      healthStatus:'review',
      httpStatus:response.status,
      reason:`http-${response.status}`
    };
  }catch(error){
    return {
      healthStatus:'review',
      httpStatus:null,
      reason:error.name === 'AbortError' ? 'timeout' : 'network'
    };
  }
}

function supabaseHeaders(){
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey:key,
    Authorization:`Bearer ${key}`,
    'Content-Type':'application/json'
  };
}

async function getBatch(){
  const baseUrl = process.env.SUPABASE_URL;
  const query = new URL(`${baseUrl}/rest/v1/product_downloads`);

  query.searchParams.set('select', 'id,product_id,url,status,health_status,checked_at');
  query.searchParams.set('status', 'neq.disabled');
  query.searchParams.set('url', 'not.is.null');
  query.searchParams.set('order', 'checked_at.asc.nullsfirst,id.asc');
  query.searchParams.set('limit', String(BATCH_SIZE));

  const response = await fetch(query, {
    headers:supabaseHeaders()
  });

  if(!response.ok){
    throw new Error(`Supabase lectura: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function saveResult(downloadId, result, checkedAt){
  const baseUrl = process.env.SUPABASE_URL;
  const query = new URL(`${baseUrl}/rest/v1/product_downloads`);
  query.searchParams.set('id', `eq.${downloadId}`);

  const response = await fetch(query, {
    method:'PATCH',
    headers:{
      ...supabaseHeaders(),
      Prefer:'return=minimal'
    },
    body:JSON.stringify({
      health_status:result.healthStatus,
      checked_at:checkedAt
    })
  });

  if(!response.ok){
    throw new Error(`Supabase guardado: ${response.status} ${await response.text()}`);
  }
}

async function processBatch(items){
  const totals = { active:0, review:0, down:0, errors:0 };
  const details = [];
  let cursor = 0;

  async function worker(){
    while(true){
      const index = cursor++;
      if(index >= items.length) return;

      const item = items[index];
      const checkedAt = new Date().toISOString();

      try{
        const result = await inspectLink(item.url);
        await saveResult(item.id, result, checkedAt);

        totals[result.healthStatus] = (totals[result.healthStatus] || 0) + 1;
        details.push({
          id:item.id,
          productId:item.product_id,
          status:result.healthStatus,
          httpStatus:result.httpStatus,
          reason:result.reason
        });
      }catch(error){
        totals.errors++;
        details.push({
          id:item.id,
          productId:item.product_id,
          status:'error',
          error:error.message
        });
      }
    }
  }

  const workers = Math.min(CONCURRENCY, items.length || 1);
  await Promise.all(Array.from({ length:workers }, () => worker()));

  return { totals, details };
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET'){
    return sendJson(res, 405, { ok:false, error:'Método no permitido' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || '';

  if(!cronSecret || authorization !== `Bearer ${cronSecret}`){
    return sendJson(res, 401, { ok:false, error:'No autorizado' });
  }

  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    return sendJson(res, 500, {
      ok:false,
      error:'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  const startedAt = new Date().toISOString();

  try{
    const batch = await getBatch();

    if(!batch.length){
      return sendJson(res, 200, {
        ok:true,
        startedAt,
        finishedAt:new Date().toISOString(),
        batchSize:0,
        message:'No hay enlaces habilitados para revisar.'
      });
    }

    const result = await processBatch(batch);

    console.log('[AREA51 cron enlaces]', {
      startedAt,
      processed:batch.length,
      ...result.totals
    });

    return sendJson(res, 200, {
      ok:true,
      startedAt,
      finishedAt:new Date().toISOString(),
      configuredBatchSize:BATCH_SIZE,
      concurrency:CONCURRENCY,
      processed:batch.length,
      totals:result.totals,
      details:result.details
    });
  }catch(error){
    console.error('[AREA51 cron enlaces] Error:', error);
    return sendJson(res, 500, {
      ok:false,
      startedAt,
      finishedAt:new Date().toISOString(),
      error:error.message
    });
  }
};
