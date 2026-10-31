// AREA51 PC — Webhook de cobros reales. Deshabilitado por defecto.
// Verifica pago contra API Mercado Pago y acredita mediante RPC atomica existente.
import { validateProductionPayment } from './production-payment-validation.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT=/^[0-9]{1,24}$/;
const SITE='https://biblioteca-juegosde-pc.vercel.app';
async function getJson(url,headers) {
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('Remote HTTP '+r.status);
 return r.json();
}
async function db(base,key,table,params) {
 const u=new URL(base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
 const result=await getJson(u,{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'});
 if(!Array.isArray(result))throw new Error('Database response invalid');
 return result;
}
export default async function livePaymentWebhook(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Metodo no permitido'});
 if(process.env.AREA51_LIVE_CHECKOUT_ENABLED!=='true')
  return res.status(503).json({ok:false,error:'Pagos reales deshabilitados'});
 const kind=String(req.body?.type||req.body?.topic||req.query?.type||req.query?.topic||'');
 const id=String(req.body?.data?.id||req.query?.['data.id']||'');
 if(kind!=='payment'||!PAYMENT.test(id))return res.status(200).json({ok:true,ignored:true});
 const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const token=process.env.MERCADOPAGO_ACCESS_TOKEN_PROD?.trim();
 if(!base||!key||!token)return res.status(503).json({ok:false,error:'Configuracion incompleta'});
 try {
  const auth={Authorization:'Bearer '+token,Accept:'application/json'};
  const [payment,seller]=await Promise.all([
   getJson('https://api.mercadopago.com/v1/payments/'+id,auth),
   getJson('https://api.mercadopago.com/users/me',auth)
  ]);
  const orderId=String(payment?.external_reference||'');
  if(!UUID.test(orderId)||String(payment?.id??'')!==id)
   return res.status(200).json({ok:true,ignored:true});
  // Identidad del vendedor de produccion: ID configurado en Vercel, nunca TESTUSER.
  const sellerId=String(process.env.AREA51_MP_PROD_SELLER_ID||'');
  if(!/^\d+$/.test(sellerId)||sellerId==='3544226015'||
     String(seller?.id??'')!==sellerId)
   throw new Error('Vendedor de produccion no configurado o incorrecto');
  const [orders,items,used]=await Promise.all([
   db(base,key,'orders',{select:'id,customer_email,status,currency,total_ars,payment_provider,payment_reference',id:'eq.'+orderId,limit:'1'}),
   db(base,key,'order_items',{select:'order_id,product_id,unit_price_ars,quantity',order_id:'eq.'+orderId,limit:'101'}),
   db(base,key,'orders',{select:'id',payment_reference:'eq.'+id,id:'neq.'+orderId,limit:'1'})
  ]);
  const order=orders[0];
  // Idempotencia: la RPC devuelve already_paid cuando llega otra notificacion.
  if(order?.status==='paid'&&String(order.payment_reference)===id)
   return res.status(200).json({ok:true,already_paid:true});
  if(!validateProductionPayment({payment,seller,order,items,usedByOtherOrder:used.length>0}))
   return res.status(200).json({ok:true,ignored:true});
  const rpc=await fetch(base+'/rest/v1/rpc/a51_confirm_paid_order',{
   method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,
    'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({p_order_id:orderId,p_payment_reference:id}),
   signal:AbortSignal.timeout(12000)
  });
  if(!rpc.ok)throw new Error('Acreditacion atomica HTTP '+rpc.status);
  const result=await rpc.json();
  if(result?.ok!==true)throw new Error('Acreditacion no confirmada');
  return res.status(200).json({ok:true});
 }catch(error) {
  console.error('AREA51 live webhook:',error.message);
  return res.status(502).json({ok:false,error:'Notificacion pendiente de reintento'});
 }
}
