/* AREA 51 - Cola de navegacion, modulo independiente. No modifica el catalogo. */
(()=>{
'use strict';
const modal=document.getElementById('a51-pending-search-dialog');
if(!modal)return;
const tbody=document.getElementById('a51-pending-search-rows');
const summary=document.getElementById('a51-pending-search-summary');
const bar=document.createElement('div');
bar.id='a51-torrent-queue-controls';
bar.style.cssText='display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:12px 0';
bar.innerHTML='<label style="display:flex;gap:6px;align-items:center"><input id="a51-tq-all" type="checkbox"> Seleccionar todos</label><button type="button" class="btn" id="a51-tq-start">🚀 Iniciar cola</button><button type="button" class="btn" id="a51-tq-pause">⏸ Pausar</button><button type="button" class="btn" id="a51-tq-resume">▶ Continuar</button><button type="button" class="btn" id="a51-tq-stop">⏹ Detener</button><span id="a51-tq-status" aria-live="polite" style="font-size:12px">Esperando selección.</span>';
summary.insertAdjacentElement('afterend',bar);
const $=id=>document.getElementById(id);
const state=$('a51-tq-status');
let currentItems=[];
function updateRows(){
 const rows=[...tbody.querySelectorAll('tr')].filter(tr=>tr.cells.length===3);
 const header=tbody.closest('table')?.querySelector('thead tr');
 if(header&&!header.querySelector('[data-a51-tq-head]')){
  const th=document.createElement('th');th.dataset.a51TqHead='1';th.textContent='Seleccionar';header.insertBefore(th,header.firstChild);
 }
 currentItems=[];
 rows.forEach(tr=>{
  if(tr.querySelector('.a51-tq-check'))return;
  const name=tr.cells[0]?.textContent?.trim();
  if(!name||name==='No hay juegos pendientes con esta condición.')return;
  const td=document.createElement('td');
  const check=document.createElement('input');check.type='checkbox';check.className='a51-tq-check';check.setAttribute('aria-label','Seleccionar '+name);
  td.append(check);tr.insertBefore(td,tr.firstChild);
  currentItems.push(tr);
 });
 $('a51-tq-all').checked=false;
}
const observer=new MutationObserver(()=>{if(!modal.hidden)queueMicrotask(updateRows);});
observer.observe(tbody,{childList:true});
$('a51-tq-all').addEventListener('change',e=>{tbody.querySelectorAll('.a51-tq-check').forEach(c=>c.checked=e.target.checked)});
function send(type,payload={}){
 window.postMessage({source:'AREA51_TORRENT_QUEUE_PAGE',type,payload},location.origin);
}
$('a51-tq-start').addEventListener('click',()=>{
 const selected=[...tbody.querySelectorAll('tr')].filter(tr=>tr.querySelector('.a51-tq-check:checked')).map(tr=>{
  const name=tr.cells[1]?.textContent?.trim();
  const link=tr.querySelector('a[href]');
  return {name,url:link?.href||''};
 }).filter(x=>x.name);
 if(!selected.length){state.textContent='Seleccioná al menos un juego.';return;}
 if(!confirm('¿Iniciar recorrido secuencial de '+selected.length+' juego(s)? Solo archivos que tengas derecho a descargar.'))return;
 send('START',{items:selected});state.textContent='Enviando cola a la extensión Edge…';
});
$('a51-tq-pause').onclick=()=>send('PAUSE');
$('a51-tq-resume').onclick=()=>send('RESUME');
$('a51-tq-stop').onclick=()=>{if(confirm('¿Detener la cola?'))send('STOP')};
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.source!=='AREA51_TORRENT_QUEUE_EXTENSION')return;
 const d=event.data;
 if(d.error){state.textContent='⚠ '+d.error;return;}
 const q=d.state;
 if(!q)return;
 const done=(q.items||[]).filter(x=>x.status==='done').length;
 const failed=(q.items||[]).filter(x=>x.status==='failed').length;
 state.textContent=(q.running?(q.paused?'⏸ Pausada':'🔄 En curso'):'Lista / detenida')+' · '+done+' completados · '+failed+' errores · '+(q.items||[]).length+' totales'+(q.current>=0?' · Juego '+(q.current+1):'');
 for(const tr of tbody.querySelectorAll('tr')){
  if(!tr.querySelector('.a51-tq-check'))continue;
  const name=tr.cells[1]?.textContent?.trim();
  const item=(q.items||[]).find(x=>x.name===name);
  let tag=tr.querySelector('[data-a51-tq-progress]');
  if(!tag){tag=document.createElement('div');tag.dataset.a51TqProgress='1';tag.style.cssText='font-weight:bold;margin-top:5px;color:#aaff40';tr.cells[2].append(tag);}
  tag.textContent=item?({pending:'⏳ En espera',running:'🔄 Procesando',done:'✅ Descargado',failed:'⚠ Error: '+(item.reason||'revisar'),stopped:'⏹ Detenido'}[item.status]||''):' ';
 }
});
setInterval(()=>{if(!modal.hidden)send('STATUS')},2500);
})();
