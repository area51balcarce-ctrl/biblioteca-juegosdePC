// AREA 51 - customer authentication, separate from test endpoints.
// Explicitly disabled unless AREA51_CUSTOMER_AUTH_ENABLED=true.
// No production checkout is enabled here.
import { createHmac } from 'node:crypto';
import { sameOrigin } from './_lib/a51-session.js';
import { createToken, makeCookie, clearCookie } from '../lib/pc/a51-customer-session.js';
import { readCustomerSession, storeVerifiedCustomerSession, revokeCustomerSession } from '../lib/pc/a51-customer-session-store.js';
import { normalizeCustomerEmail, generateLoginCode, hashLoginCode, verifyLoginCodeHash, isLoginCodeUsable, OTP_TTL_MS } from '../lib/pc/a51-customer-otp.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const LIMIT_EMAIL_HOUR = 3, LIMIT_IP_HOUR = 10;
function settings() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.AREA51_EMAIL_CODE_SECRET;
  const brevo = process.env.BREVO_API_KEY;
  if (!url || !/^https:\/\//.test(url) || !key || !secret || secret.length < 32 || !brevo) return null;
  return { url, key, secret, brevo };
}
function headers(key, extra={}) {
  return { apikey:key, Authorization:'Bearer '+key, ...JSON_HEADERS, ...extra };
}
async function db(c, path, init={}) {
  const response = await fetch(c.url+'/rest/v1/'+path, {
    ...init, headers:headers(c.key, init.headers), signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Database HTTP '+response.status);
  if (response.status===204) return [];
  return response.json();
}
function urlFor(table, params={}) {
  const u=new URL(table,'https://example.invalid/');
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  return u.pathname.slice(1)+u.search;
}
function ipDigest(req,secret) {
  // Only trust Vercel-provided IP; do not parse spoofable X-Forwarded-For chains.
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || '').slice(0,128);
  if (!ip) return null; // fail closed for sending codes
  return createHmac('sha256',secret).update('area51:pc:otp-ip:v1:'+ip).digest('hex');
}
function error(res,status,message) { return res.status(status).json({ok:false,error:message}); }
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (process.env.AREA51_CUSTOMER_AUTH_ENABLED!=='true') return error(res,503,'Acceso de clientes en preparación.');
  const action=typeof req.query?.action==='string'?req.query.action:'';
  if (req.method==='GET' && action==='session') {
    try {
      const session=await readCustomerSession(req);
      if (!session) return error(res,401,'Sesión no iniciada.');
      return res.status(200).json({ok:true,email:session.email,expiresAt:session.expiresAt});
    } catch(e) { console.error('A51 session:',e.message);return error(res,502,'No se pudo consultar la sesión.'); }
  }
  if (req.method!=='POST') return error(res,405,'Método no permitido.');
  if (!sameOrigin(req)) return error(res,403,'Origen no autorizado.');
  if (action==='logout') {
    try { await revokeCustomerSession(req);res.setHeader('Set-Cookie',clearCookie());return res.status(200).json({ok:true}); }
    catch(e) { console.error('A51 logout:',e.message);return error(res,502,'No se pudo cerrar la sesión.'); }
  }
  if (action!=='request' && action!=='verify') return error(res,404,'Acción desconocida.');
  const c=settings();
  if (!c) return error(res,503,'Configuración incompleta.');
  const email=normalizeCustomerEmail(req.body?.email);
  if (!email) return error(res,400,'Correo electrónico inválido.');
  if (action==='request') {
    try {
      const existing=await readCustomerSession(req);
      if (existing?.email===email) return res.status(200).json({ok:true,alreadyAuthenticated:true});
      const ipHash=ipDigest(req,c.secret);
      if (!ipHash) return error(res,503,'No se pudo validar la solicitud.');
      const since=new Date(Date.now()-3600000).toISOString();
      const emailHistory=await db(c,urlFor('pc_customer_login_codes',{
        select:'id',email:'eq.'+email,created_at:'gte.'+since,limit:String(LIMIT_EMAIL_HOUR)
      }));
      const ipHistory=await db(c,urlFor('pc_customer_login_codes',{
        select:'id',requester_ip_hash:'eq.'+ipHash,created_at:'gte.'+since,limit:String(LIMIT_IP_HOUR)
      }));
      if (emailHistory.length>=LIMIT_EMAIL_HOUR || ipHistory.length>=LIMIT_IP_HOUR)
        return error(res,429,'Demasiados intentos. Esperá antes de solicitar otro código.');
      const code=generateLoginCode();
      const inserted=await db(c,'pc_customer_login_codes',{
        method:'POST',headers:{Prefer:'return=representation'},
        body:JSON.stringify({email,code_hash:hashLoginCode(email,code),
          requester_ip_hash:ipHash,expires_at:new Date(Date.now()+OTP_TTL_MS).toISOString()})
      });
      const id=inserted?.[0]?.id;
      if (!id) throw new Error('OTP insert not confirmed');
      // Sender is the configured AREA 51 address used in existing test delivery.
      const sent=await fetch('https://api.brevo.com/v3/smtp/email',{
        method:'POST',headers:{'api-key':c.brevo,...JSON_HEADERS,Accept:'application/json'},
        body:JSON.stringify({sender:{name:'AREA 51 - Biblioteca PC',email:'area51.balcarce@gmail.com'},
          to:[{email}],subject:'AREA 51 - Tu código de acceso',
          textContent:'Tu código de AREA 51 es: '+code+'\\n\\nVence en 10 minutos. Si no lo pediste, ignorá este mensaje.'}),
        signal:AbortSignal.timeout(12000)
      });
      if (!sent.ok) {
        await db(c,urlFor('pc_customer_login_codes',{id:'eq.'+id}),{
          method:'PATCH',body:JSON.stringify({consumed_at:new Date().toISOString()})
        }).catch(()=>{});
        throw new Error('Mail delivery HTTP '+sent.status);
      }
      return res.status(200).json({ok:true,message:'Si el correo puede recibir mensajes, llegará un código.'});
    } catch(e) {console.error('A51 request:',e.message);return error(res,502,'No se pudo procesar el envío.');}
  }
  const code=typeof req.body?.code==='string'?req.body.code.trim():'';
  if (!/^\d{6}$/.test(code)) return error(res,400,'Ingresá los seis dígitos.');
  try {
    const rows=await db(c,urlFor('pc_customer_login_codes',{
      select:'id,code_hash,attempts,expires_at,consumed_at',
      email:'eq.'+email,order:'created_at.desc',limit:'1'
    }));
    const row=rows?.[0];
    if (!isLoginCodeUsable(row)) return error(res,400,'Código inválido o vencido.');
    const match=verifyLoginCodeHash(email,code,row.code_hash);
    const patch=urlFor('pc_customer_login_codes',{
      id:'eq.'+row.id,attempts:'eq.'+row.attempts,consumed_at:'is.null',
      expires_at:'gt.'+new Date().toISOString()
    });
    const changed=await db(c,patch,{
      method:'PATCH',headers:{Prefer:'return=representation'},
      body:JSON.stringify(match?{consumed_at:new Date().toISOString()}:{attempts:row.attempts+1})
    });
    if (!Array.isArray(changed) || changed.length!==1)
      return error(res,409,'La verificación cambió. Reintentá.');
    if (!match) return error(res,400,'Código incorrecto.');
    const token=createToken();
    await storeVerifiedCustomerSession(email,token);
    res.setHeader('Set-Cookie',makeCookie(token));
    return res.status(200).json({ok:true,email});
  } catch(e) {console.error('A51 verify:',e.message);return error(res,502,'No se pudo verificar el código.');}
}
