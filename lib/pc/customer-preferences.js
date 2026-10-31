// AREA51: preferencias privadas sincronizadas por correo verificado. Sin pagos ni enlaces.
import {readCustomerSession} from './a51-customer-session-store.js';
import {sameOrigin} from '../../api/_lib/a51-session.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=arr=>Array.isArray(arr)&&arr.length<=1000&&arr.every(x=>typeof x==='string'&&UUID.test(x))&&new Set(arr).size===arr.length;
export default async function preferences(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'});
 if(req.method==='POST'&&!sameOrigin(req))return res.status(403).json({ok:false,error:'Origen no autorizado'});
 try{
  const session=await readCustomerSession(req);
  if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión para sincronizar'});
  const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)return res.status(503).json({ok:false,error:'Servicio no disponible'});
  const url=new URL(base+'/rest/v1/pc_customer_preferences');
  const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json'};
  if(req.method==='GET'){
   url.searchParams.set('select','cart_ids,favorite_ids,updated_at');
   url.searchParams.set('customer_email','eq.'+session.email);
   const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Lectura de preferencias: '+response.status);
   const data=await response.json();
   return res.status(200).json({ok:true,exists:data.length>0,cart_ids:data[0]?.cart_ids||[],favorite_ids:data[0]?.favorite_ids||[]});
  }
  const cart=req.body?.cart_ids,favs=req.body?.favorite_ids;
  if(!clean(cart)||!clean(favs))return res.status(400).json({ok:false,error:'Preferencias inválidas'});
  url.searchParams.set('on_conflict','customer_email');
  const response=await fetch(url,{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_email:session.email,cart_ids:cart,favorite_ids:favs,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Guardado de preferencias: '+response.status);
  return res.status(200).json({ok:true});
 }catch(error){console.error('AREA51 preferences:',error.message);return res.status(502).json({ok:false,error:'No se pudieron sincronizar las preferencias'});}
}
