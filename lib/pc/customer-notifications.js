// AREA51: centro de notificaciones aislado. No modifica compras ni autenticacion.
import { readCustomerSession } from './a51-customer-session-store.js';
import { sameOrigin } from '../../api/_lib/a51-session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {'Content-Type':'application/json'};
function config(){
 const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 return base && /^https:\/\//.test(base) && key ? {base,key} : null;
}
async function db(c,table,params,method='GET',body){
 const url=new URL(c.base+'/rest/v1/'+table);
 Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
 const response=await fetch(url,{
  method,headers:{apikey:c.key,Authorization:'Bearer '+c.key,...JSON_HEADERS,Prefer:'resolution=ignore-duplicates,return=representation'},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('Supabase '+table+' '+response.status);
 return response.status===204?[]:response.json();
}
export default async function customerNotifications(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'});
 if(req.method==='POST'&&!sameOrigin(req))return res.status(403).json({ok:false,error:'Origen no autorizado'});
 try{
  const session=await readCustomerSession(req);
  if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión.'});
  const c=config();
  if(!c)return res.status(503).json({ok:false,error:'Notificaciones no configuradas.'});
  const email=session.email.toLowerCase();
  if(req.method==='GET'){
   const items=await db(c,'pc_customer_notifications',{
    select:'id,kind,title,message,product_id,created_at',
    or:'(customer_email.eq.'+email+',customer_email.is.null)',
    order:'created_at.desc',limit:'60'
   });
   // Las novedades globales se marcan como leidas en tabla separada, sin mutar la notificacion.
   const reads=await db(c,'pc_customer_notification_reads',{
    select:'notification_id',customer_email:'eq.'+email,limit:'500'
   });
   const readIds=new Set(reads.map(row=>row.notification_id));
   const notifications=items.map(n=>({...n,read:readIds.has(n.id)}));
   return res.status(200).json({ok:true,notifications,unread:notifications.filter(n=>!n.read).length});
  }
  const id=String(req.body?.notification_id||'');
  if(!UUID.test(id))return res.status(400).json({ok:false,error:'Notificación inválida.'});
  const matching=await db(c,'pc_customer_notifications',{
   select:'id',id:'eq.'+id,
   or:'(customer_email.eq.'+email+',customer_email.is.null)',limit:'1'
  });
  if(!matching.length)return res.status(404).json({ok:false,error:'Notificación no encontrada.'});
  await db(c,'pc_customer_notification_reads',{on_conflict:'customer_email,notification_id'},'POST',{
   customer_email:email,notification_id:id
  });
  return res.status(200).json({ok:true});
 }catch(error){
  console.error('AREA51 notificaciones:',error.message);
  return res.status(502).json({ok:false,error:'No se pudieron consultar las notificaciones.'});
 }
}
