/* AREA51 — campanita de notificaciones. Componente aislado. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const section=$('a51Notifications');
if(!section)return;
const header=document.querySelector('header');
const bell=document.createElement('a');bell.href='#a51Notifications';bell.hidden=true;
bell.setAttribute('aria-label','Abrir notificaciones de AREA 51');
bell.style.cssText='border:1px solid #655b98;border-radius:12px;padding:9px 12px;white-space:nowrap';
bell.textContent='🔔';if(header)header.append(bell);
const status=$('a51NotificationStatus'),list=$('a51NotificationList'),count=$('a51NotificationCount');
const heading=count?.closest('h2');
const markAll=document.createElement('button');
markAll.type='button';markAll.textContent='✅ Marcar todas como leídas';
markAll.hidden=true;
markAll.style.cssText='margin-left:12px;padding:8px 12px;border-radius:8px;cursor:pointer';
if(heading)heading.append(markAll);
markAll.addEventListener('click',async()=>{
 if(markAll.disabled)return;
 markAll.disabled=true;markAll.textContent='⏳ Marcando…';
 try{
  const result=await request({method:'POST',body:JSON.stringify({mark_all:true})});
  if(result)await load();
 }catch(e){status.textContent='No se pudieron marcar todas: '+e.message;}
 finally{markAll.disabled=false;markAll.textContent='✅ Marcar todas como leídas';}
});

async function request(options){
 const response=await fetch('/api/mis-compras?action=customer-notifications',{
  credentials:'same-origin',cache:'no-store',
  headers:{Accept:'application/json','Content-Type':'application/json'},...options
 });
 if(response.status===401){section.hidden=true;bell.hidden=true;return null;}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'No se pudo consultar el servidor');
 return data;
}
function render(data){
 if(!data)return;
 section.hidden=false;bell.hidden=false;
 bell.textContent=data.unread?'🔔 '+data.unread:'🔔';
 count.textContent=data.unread?'('+data.unread+' sin leer)':'(al día)';
 markAll.hidden=!(data.unread>0);
 list.replaceChildren();
 if(!data.notifications?.length){status.textContent='Todavía no tenés notificaciones.';return;}
 status.textContent='Tus últimas novedades:';
 for(const n of data.notifications){
  const card=document.createElement('div');
  card.style.cssText='border-top:1px solid #565080;padding:12px 0';
  const title=document.createElement('strong');title.textContent=(n.read?'✓ ':'● ')+n.title;
  const description=document.createElement('p');description.textContent=n.message;
  const date=document.createElement('small');date.textContent=new Date(n.created_at).toLocaleString('es-AR');
  card.append(title,description,date);
  if(!n.read){
   const mark=document.createElement('button');mark.type='button';mark.textContent='Marcar como leído';
   mark.style.marginLeft='12px';
   mark.addEventListener('click',async()=>{
    mark.disabled=true;
    try{await request({method:'POST',body:JSON.stringify({notification_id:n.id})});await load();}
    catch(e){status.textContent=e.message;mark.disabled=false;}
   });
   card.append(mark);
  }
  list.append(card);
 }
}
async function load(){
 if(!document.getElementById('account') || document.getElementById('account').hidden){section.hidden=true;bell.hidden=true;return;}
 try{const data=await request();render(data);}
 catch(e){status.textContent='No se pudieron cargar las notificaciones: '+e.message;}
}
$('a51NotificationRefresh').addEventListener('click',load);
load();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
window.addEventListener('a51-customer-session-changed',load);
setInterval(()=>{if(!document.hidden)load();},120000);
})();
