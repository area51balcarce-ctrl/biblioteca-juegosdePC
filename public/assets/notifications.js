/* AREA 51 · Notificaciones no invasivas · v1
   No reemplaza confirm()/prompt() ni altera flujos de pagos o guardado.
   Nativas solo con permiso explícito y preferencia activada por el usuario. */
(()=>{'use strict';
if(window.A51Notify)return;
const KEY='a51_native_notifications_enabled_v1';
const css=document.createElement('style');
css.textContent=`
#a51-notify-stack{position:fixed;right:16px;bottom:80px;z-index:2147483000;display:grid;gap:10px;width:min(380px,calc(100vw - 32px));pointer-events:none}
.a51-notice{pointer-events:auto;display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:12px;border:1px solid #35654e;background:#102019;color:#f3fff8;box-shadow:0 12px 34px #0009;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;white-space:pre-line;overflow-wrap:anywhere}
.a51-notice[data-kind="error"]{border-color:#e27676}.a51-notice[data-kind="warning"]{border-color:#e5bd61}.a51-notice strong{display:block;margin-bottom:3px}.a51-notice p{margin:0;color:#d0ded6;max-height:150px;overflow:auto}.a51-notice button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:19px;cursor:pointer;padding:0 3px}
#a51-notify-toggle{position:fixed;right:16px;bottom:16px;z-index:2147482999;border:1px solid #4a7860;border-radius:24px;background:#102019;color:#d9ffeb;padding:9px 13px;font:12px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 5px 20px #0007}
#a51-notify-toggle:focus-visible{outline:2px solid #b0ff6e}
@media(max-width:520px){#a51-notify-stack{bottom:76px}#a51-notify-toggle{bottom:12px}}
`;
document.head.append(css);
const stack=document.createElement('div');stack.id='a51-notify-stack';stack.setAttribute('aria-live','polite');
const toggle=document.createElement('button');toggle.id='a51-notify-toggle';toggle.type='button';toggle.setAttribute('aria-label','Configurar notificaciones de Windows o Edge');
function supported(){return window.isSecureContext&&'Notification' in window}
function enabled(){try{return localStorage.getItem(KEY)==='1'}catch{return false}}
function setEnabled(v){try{localStorage.setItem(KEY,v?'1':'0')}catch{}}
function update(){toggle.textContent=!supported()?'🔔 Avisos en la app':Notification.permission==='denied'?'🔕 Windows bloqueado':enabled()&&Notification.permission==='granted'?'🔔 Windows: activadas':'🔔 Activar Windows'}
function show(text,kind='info',opts={}){
 const msg=String(text??'').trim();if(!msg)return;
 const k=['success','warning','error','info'].includes(kind)?kind:'info';
 const title=opts.title||({success:'Operación completada',warning:'Atención',error:'Se produjo un error',info:'AREA 51'}[k]);
 const item=document.createElement('div');item.className='a51-notice';item.dataset.kind=k;item.setAttribute('role',k==='error'?'alert':'status');
 const symbol=document.createElement('span');symbol.textContent=({success:'✅',warning:'⚠️',error:'❌',info:'🔔'}[k]);
 const content=document.createElement('div');content.style.flex='1';const heading=document.createElement('strong');heading.textContent=title;const body=document.createElement('p');body.textContent=msg;content.append(heading,body);
 const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar notificación');close.onclick=()=>item.remove();item.append(symbol,content,close);stack.prepend(item);
 while(stack.children.length>4)stack.lastElementChild.remove();
 const duration=Number.isFinite(opts.duration)?Math.max(1500,opts.duration):k==='error'?9000:6000;
 setTimeout(()=>item.remove(),duration);
 if(opts.native!==false&&supported()&&enabled()&&Notification.permission==='granted'&&document.visibilityState==='hidden'){
   try{new Notification('AREA 51 · '+title,{body:msg.slice(0,230),icon:'/assets/area51-app-icon.svg',tag:'a51-'+k})}catch(e){console.debug('Aviso nativo no disponible:',e)}
 }
}
toggle.addEventListener('click',async()=>{
 if(!supported()){show('Las notificaciones de Windows requieren un navegador compatible y HTTPS. Los avisos dentro de la aplicación siguen funcionando.','info');return}
 if(enabled()&&Notification.permission==='granted'){setEnabled(false);update();show('Avisos de Windows desactivados. Los avisos dentro de la aplicación siguen activos.','info',{native:false});return}
 if(Notification.permission==='denied'){show('Edge bloqueó los avisos. Para habilitarlos, cambiá el permiso de notificaciones de este sitio en la configuración del navegador.','warning',{native:false});return}
 try{const permission=await Notification.requestPermission();setEnabled(permission==='granted');update();show(permission==='granted'?'Notificaciones de Windows habilitadas. Cuando la pestaña esté en segundo plano recibirás los avisos compatibles.':'Los avisos de Windows no fueron habilitados; seguirás viendo avisos dentro de la aplicación.',permission==='granted'?'success':'warning',{native:false})}
 catch(e){show('No se pudo solicitar permiso: '+e.message,'error',{native:false})}
});
function mount(){if(!document.body)return;document.body.append(stack,toggle);update()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
window.A51Notify={show,success:(msg,opts)=>show(msg,'success',opts),error:(msg,opts)=>show(msg,'error',opts),warning:(msg,opts)=>show(msg,'warning',opts),info:(msg,opts)=>show(msg,'info',opts)};
})();