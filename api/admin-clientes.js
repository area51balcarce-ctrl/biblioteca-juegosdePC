// AREA 51 — consulta privada de clientes para administradores.
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'});
 const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const token=String(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];
 if(!base||!key||!token)return res.status(401).json({ok:false,error:'Acceso no autorizado'});
 const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
 async function read(path,params={}){
  const u=new URL(base+'/rest/v1/'+path);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error(path+': '+r.status);
  return r.json();
 }
 try{
  const identity=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  if(!identity.ok)return res.status(401).json({ok:false,error:'Sesión vencida'});
  const user=await identity.json();
  if(!/^[0-9a-f-]{36}$/i.test(user.id||''))return res.status(403).json({ok:false,error:'Acceso denegado'});
  const admins=await read('admin_users',{select:'id,role',id:'eq.'+user.id,limit:1});
  if(!admins.length||admins[0].role==='operator')return res.status(403).json({ok:false,error:'Solo administradores'});
  const [sessions,orders,items]=await Promise.all([
   read('pc_customer_sessions',{select:'customer_email,created_at,last_seen_at',order:'created_at.desc',limit:5000}),
   read('orders',{select:'id,customer_email,status,total_ars,created_at,paid_at,payment_provider',order:'created_at.desc',limit:5000}),
   read('order_items',{select:'order_id,product_name,quantity,unit_price_ars',limit:10000})
  ]);
  const clients=new Map(),ensure=email=>{
   if(typeof email!=='string'||!email.includes('@'))return null;
   const e=email.trim().toLowerCase();
   if(!clients.has(e))clients.set(e,{email:e,registered_at:null,last_access:null,orders:[],paid_count:0,paid_total_ars:0});
   return clients.get(e);
  };
  for(const s of sessions){
   const c=ensure(s.customer_email);if(!c)continue;
   if(!c.registered_at||s.created_at<c.registered_at)c.registered_at=s.created_at;
   if(!c.last_access||s.last_seen_at>c.last_access)c.last_access=s.last_seen_at;
  }
  const byOrder=new Map();
  for(const i of items){if(!byOrder.has(i.order_id))byOrder.set(i.order_id,[]);byOrder.get(i.order_id).push({name:i.product_name,quantity:i.quantity,price_ars:i.unit_price_ars});}
  for(const o of orders){
   const c=ensure(o.customer_email);if(!c)continue;
   c.orders.push({id:o.id,status:o.status,total_ars:o.total_ars,created_at:o.created_at,paid_at:o.paid_at,items:byOrder.get(o.id)||[]});
   if(o.status==='paid'){c.paid_count++;c.paid_total_ars+=Number(o.total_ars)||0;}
  }
  return res.status(200).json({ok:true,clients:[...clients.values()].sort((a,b)=>(b.last_access||b.registered_at||'').localeCompare(a.last_access||a.registered_at||''))});
 }catch(e){console.error('AREA51 admin clients:',e.message);return res.status(502).json({ok:false,error:'No se pudo cargar el listado de clientes'});}
}