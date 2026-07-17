const dns = require('dns').promises;
const net = require('net');

function json(res,status,body){
  res.status(status)
    .setHeader('Content-Type','application/json; charset=utf-8')
    .setHeader('Cache-Control','no-store')
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
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:');
  }
  return true;
}

async function validatePublicHost(hostname){
  const records = await dns.lookup(hostname,{all:true});
  if(!records.length || records.some(record => isPrivateIp(record.address))){
    throw new Error('Host no permitido');
  }
}

async function timedFetch(url, options={}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try{
    return await fetch(url,{
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

module.exports = async function handler(req,res){
  if(req.method !== 'GET') return json(res,405,{error:'Método no permitido'});
  const raw = String(req.query.url || '').trim();

  if(raw.startsWith('magnet:?')){
    return json(res,200,{healthStatus:'active',reason:'magnet'});
  }

  let url;
  try{
    url = new URL(raw);
    if(!['http:','https:'].includes(url.protocol)) throw new Error();
    await validatePublicHost(url.hostname);
  }catch{
    return json(res,400,{healthStatus:'review',error:'URL inválida o no permitida'});
  }

  try{
    let response = await timedFetch(url.toString(),{method:'HEAD'});
    if([405,501].includes(response.status)){
      response = await timedFetch(url.toString(),{
        method:'GET',
        headers:{Range:'bytes=0-0'}
      });
    }

    if(response.status >= 200 && response.status < 400){
      return json(res,200,{healthStatus:'active',httpStatus:response.status});
    }
    if([404,410].includes(response.status)){
      return json(res,200,{healthStatus:'down',httpStatus:response.status});
    }
    return json(res,200,{healthStatus:'review',httpStatus:response.status});
  }catch(error){
    return json(res,200,{healthStatus:'review',reason:error.name === 'AbortError' ? 'timeout' : 'network'});
  }
};
