/* AREA51 — campanita de notificaciones. Componente aislado. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const section=$('a51Notifications');
if(!section)return;
const status=$('a51NotificationStatus'),list=$('a51NotificationList'),count=$('a51NotificationCount');
async function request(options){
 const response=await fetch('/api/mis-compras?action=customer-notifications',{
  credentials:'same-origin',cache:'no-store',
  headers:{Accept:'application/json','Content-Type':'application/json'},...options
 });
 if(response.status===401){section.hidden=true;return null;}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'No se pudo consultar el servidor');
 return data;
}
function render(data){
 if(!data)return;
 section.hidden=false;
 count.textContent=data.unread?'('+data.unread+' sin leer)':'(al día)';
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
 try{const data=await request();render(data);}
 catch(e){status.textContent='No se pudieron cargar las notificaciones: '+e.message;}
}
$('a51NotificationRefresh').addEventListener('click',load);
load();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
