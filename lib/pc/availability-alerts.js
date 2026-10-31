// AREA51: suscripción voluntaria a avisos de disponibilidad, aislada de pagos.
import {readCustomerSession} from './a51-customer-session-store.js';
import {sameOrigin} from '../../api/_lib/a51-session.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function availabilityAlerts(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'});
 if(req.method!=='GET'&&!sameOrigin(req))return res.status(403).json({ok:false,error:'Origen no autorizado'});
 try{
  const session=await readCustomerSession(req);
  if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión con tu correo'});
  const id=String(req.method==='GET'?req.query?.product_id:req.body?.product_id||'');
  if(!UUID.test(id))return res.status(400).json({ok:false,error:'Juego inválido'});
  const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw Error('Configuración no disponible');
  const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json'};
  const u=new URL(base+'/rest/v1/pc_availability_alerts');
  if(req.method==='GET'||req.method==='DELETE'){u.searchParams.set('customer_email','eq.'+session.email);u.searchParams.set('product_id','eq.'+id);}
  if(req.method==='GET'){u.searchParams.set('select','product_id');const r=await fetch(u,{headers,signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error('GET '+r.status);return res.status(200).json({ok:true,subscribed:(await r.json()).length>0,deliveryEnabled:false});}
  if(req.method==='POST'){
   const p=new URL(base+'/rest/v1/products');p.searchParams.set('id','eq.'+id);p.searchParams.set('select','id,status');const check=await fetch(p,{headers,signal:AbortSignal.timeout(9000)});if(!check.ok)throw Error('Producto '+check.status);const rows=await check.json();if(!rows.length)return res.status(404).json({ok:false,error:'Juego no encontrado'});
   u.searchParams.set('on_conflict','customer_email,product_id');
   const r=await fetch(u,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({customer_email:session.email,product_id:id}),signal:AbortSignal.timeout(9000)});
   if(!r.ok)throw Error('POST '+r.status);
  }else{const r=await fetch(u,{method:'DELETE',headers,signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error('DELETE '+r.status);}
  return res.status(200).json({ok:true,subscribed:req.method==='POST',deliveryEnabled:false});
 }catch(e){console.error('AREA51 alertas:',e.message);return res.status(502).json({ok:false,error:'No se pudo actualizar la solicitud'});}
}
