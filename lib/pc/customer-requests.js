import { readCustomerSession } from './a51-customer-session-store.js';
import { sameOrigin } from '../../api/_lib/a51-session.js';
export default async function customerRequests(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});
 if(!sameOrigin(req))return res.status(403).json({ok:false,error:'Origen no autorizado.'});
 try{
  const session=await readCustomerSession(req);
  if(!session?.email)return res.status(401).json({ok:false,error:'Iniciá sesión para enviar un pedido.'});
  const kind=req.body?.kind,name=String(req.body?.name||'').trim().replace(/\s+/g,' ');
  if(!['juego','software'].includes(kind)||name.length<3||name.length>160||/[<>\x00-\x1f]/.test(name))
   return res.status(400).json({ok:false,error:'Seleccioná Juego o Software e ingresá el nombre completo (3 a 160 caracteres).'});
  const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw Error('Configuración incompleta');
  const response=await fetch(base+'/rest/v1/pc_customer_requests?on_conflict=customer_email,kind,normalized_name',{
   method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},
   body:JSON.stringify({customer_email:session.email,kind,requested_name:name}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('Solicitud HTTP '+response.status);
  const inserted=await response.json();
  let ownerEmailSent=false;
  if(inserted.length && process.env.BREVO_API_KEY){
   try{
    const mail=await fetch('https://api.brevo.com/v3/smtp/email',{
     method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
     body:JSON.stringify({
      sender:{name:'AREA 51 - Biblioteca PC',email:'area51.balcarce@gmail.com'},
      to:[{email:'area51.balcarce@gmail.com'}],
      subject:'📩 Nuevo pedido de '+(kind==='juego'?'juego':'software')+' - AREA 51',
      textContent:[
       'NUEVO PEDIDO - AREA 51 BIBLIOTECA PC',
       '',
       'Tipo: '+(kind==='juego'?'Juego':'Software'),
       '',
       'Nombre completo: '+name,
       '',
       'Correo del cliente: '+session.email,
       '',
       'Revisá el pedido y publicá el título cuando esté disponible.',
       '',
       'El cliente recibirá un aviso en su campanita cuando coincida el nombre publicado.'
      ].join('\\n')
     }),signal:AbortSignal.timeout(12000)
    });
    ownerEmailSent=mail.ok;
    if(!mail.ok)console.error('AREA51 aviso nuevo pedido: Brevo HTTP '+mail.status);
   }catch(mailError){console.error('AREA51 aviso nuevo pedido:',mailError.message);}
  }
  return res.status(200).json({ok:true,ownerEmailSent,message:inserted.length?'Pedido recibido. Te avisaremos en la campanita cuando publiquemos ese título.':'Este pedido ya estaba registrado. Te avisaremos cuando se publique.'});
 }catch(e){console.error('AREA51 pedidos:',e.message);return res.status(502).json({ok:false,error:'No se pudo registrar el pedido.'});}
}
