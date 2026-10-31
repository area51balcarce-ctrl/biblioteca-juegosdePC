// AREA 51 - Historial privado. No modifica pagos ni entrega.
import {readCustomerSession} from './a51-customer-session-store.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function customerOrderHistory(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'});
 try{
  const session=await readCustomerSession(req);
  if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión'});
  const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw Error('Falta configuración');
  const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  const query=async(table,params)=>{
   const u=new URL(base+'/rest/v1/'+table);
   for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
   const r=await fetch(u,{headers,signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('Error de consulta '+table+' '+r.status);
   return r.json();
  };
  const orders=await query('orders',{select:'id,status,total_ars,currency,created_at,paid_at,payment_provider',customer_email:'eq.'+session.email,order:'created_at.desc',limit:'101'});
  if(orders.length>100)return res.status(409).json({ok:false,error:'Hay más de 100 pedidos. Contactá a soporte para el historial completo.'});
  const ids=orders.map(o=>o.id).filter(x=>UUID.test(x));
  const items=ids.length?await query('order_items',{select:'order_id,product_name,quantity,unit_price_ars',order_id:'in.('+ids.join(',')+')',limit:'1001'}):[];
  const byOrder=new Map();
  for(const i of items){if(!byOrder.has(i.order_id))byOrder.set(i.order_id,[]);byOrder.get(i.order_id).push({name:i.product_name,quantity:i.quantity,unit_price_ars:i.unit_price_ars});}
  return res.status(200).json({ok:true,orders:orders.map(o=>({...o,items:byOrder.get(o.id)||[]}))});
 }catch(error){console.error('AREA51 order history:',error.message);return res.status(502).json({ok:false,error:'No se pudo consultar el historial'});}
}
