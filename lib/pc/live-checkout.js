// AREA51 PC: Checkout Pro real, cerrado por defecto.
// No acredita pagos ni concede accesos. Solo invocar tras sesion OTP validada.
import { randomUUID } from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN='https://biblioteca-juegosde-pc.vercel.app';
async function db(base,key,table,params={},body) {
 const url=new URL(base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{
  apikey:key,Authorization:'Bearer '+key,Accept:'application/json',
  'Content-Type':'application/json',...(body===undefined?{}:{Prefer:'return=representation'})
 },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('Database '+table+' '+response.status);
 return response.json();
}
export default async function liveCheckout(req,res,email) {
 res.setHeader('Cache-Control','no-store');
 if(process.env.AREA51_LIVE_CHECKOUT_ENABLED!=='true')return res.status(503).json({ok:false,error:'Pagos reales todavía no habilitados.'});
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});
 // Compatibilidad con compras individuales anteriores y carrito múltiple.
 const incoming=Array.isArray(req.body?.product_ids)?req.body.product_ids:
  (typeof req.body?.product_id==='string'?[req.body.product_id]:[]);
 if(!incoming.length||incoming.length>100||incoming.some(id=>typeof id!=='string'||!UUID.test(id))||
    new Set(incoming).size!==incoming.length||
    typeof email!=='string'||email!==email.trim().toLowerCase()||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  return res.status(400).json({ok:false,error:'Carrito inválido. Máximo 100 juegos distintos por pago.'});
 const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const token=process.env.MERCADOPAGO_ACCESS_TOKEN_PROD?.trim();
 if(!base||!key||!token)return res.status(503).json({ok:false,error:'Configuración de cobros incompleta.'});
 let orderId=null;
 try{
  const products=await db(base,key,'products',{
   select:'id,name,status,categories(price_ars)',
   id:'in.('+incoming.join(',')+')',status:'eq.ok',limit:'100'
  });
  const byId=new Map(products.map(p=>[p.id,p]));
  if(byId.size!==incoming.length)
   return res.status(409).json({ok:false,error:'Uno o más juegos ya no están disponibles.'});
  const items=[];let total=0;
  for(const id of incoming){
   const p=byId.get(id),price=p?.categories?.price_ars;
   if(!Number.isSafeInteger(price)||price<=0)
    return res.status(409).json({ok:false,error:'Uno o más precios no están disponibles.'});
   total+=price;
   if(!Number.isSafeInteger(total)||total<=0)
    return res.status(409).json({ok:false,error:'Importe del carrito inválido.'});
   items.push({id:p.id,name:p.name,price});
  }
  orderId=randomUUID();
  await db(base,key,'orders',{}, {id:orderId,customer_email:email,status:'pending',currency:'ARS',
   total_ars:total,payment_provider:'mercadopago'});
  await db(base,key,'order_items',{},items.map(p=>({order_id:orderId,product_id:p.id,
   product_name:p.name,unit_price_ars:p.price,quantity:1})));
  const response=await fetch('https://api.mercadopago.com/checkout/preferences',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Idempotency-Key':orderId},
   body:JSON.stringify({items:items.map(p=>({id:p.id,title:p.name,quantity:1,currency_id:'ARS',unit_price:p.price})),
    payer:{email},external_reference:orderId,metadata:{area51_live:true,order_id:orderId},
    back_urls:{success:ORIGIN+'/mi-biblioteca/',failure:ORIGIN,pending:ORIGIN},
    notification_url:ORIGIN+'/api/mis-compras?action=mp-live-webhook'}),
   signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error('Mercado Pago preference '+response.status);
  const preference=await response.json();
  if(typeof preference.init_point!=='string'||!preference.init_point.startsWith('https://'))
   throw new Error('URL de pago inválida');
  return res.status(200).json({ok:true,order_id:orderId,payment_url:preference.init_point,amount_ars:total,items_count:items.length});
 }catch(error){
  console.error('AREA51 live checkout:',error.message);
  if(orderId){
   try{
    const url=new URL(base+'/rest/v1/orders');url.searchParams.set('id','eq.'+orderId);url.searchParams.set('status','eq.pending');
    await fetch(url,{method:'PATCH',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
     body:JSON.stringify({status:'cancelled',updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(8000)});
   }catch(e){console.error('AREA51 cancel pending:',e.message);}
  }
  return res.status(502).json({ok:false,error:'No se pudo preparar el pago.'});
 }
}
