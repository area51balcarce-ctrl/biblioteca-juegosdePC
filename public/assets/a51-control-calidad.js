/* AREA 51 — Control de calidad v1.0. Solo lectura. Sin cambios en store.js. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const clean=v=>String(v??'').trim();
const normalize=v=>clean(v).toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let entries=[];
function audit(products){
 const groups=new Map();
 for(const p of products){const k=normalize(p.name);if(k){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p.id);}}
 return products.map(p=>{
  const issues=[];
  if(!clean(p.name)||!clean(p.slug))issues.push({id:'identity',label:'Sin nombre o enlace',critical:true});
  if(!p.cover?.path)issues.push({id:'cover',label:'Sin portada',critical:true});
  if(!clean(p.description))issues.push({id:'description',label:'Sin descripción',critical:true});
  if(!clean(p.reqMin))issues.push({id:'requirements',label:'Sin requisitos mínimos',critical:false});
  if(!clean(p.reqRec))issues.push({id:'requirements',label:'Sin requisitos recomendados',critical:false});
  if(!clean(p.category))issues.push({id:'category',label:'Sin categoría',critical:false});
  const key=normalize(p.name);
  if(key&&(groups.get(key)||[]).length>1)issues.push({id:'duplicate',label:'Posible duplicado (nombre idéntico)',critical:false});
  return {p,issues};
 });
}
function render(){
 const q=normalize($('a51-qc-search').value),state=$('a51-qc-state').value,issue=$('a51-qc-issue').value;
 const filtered=entries.filter(({p,issues})=>(!q||normalize(p.name).includes(q)||normalize(p.slug).includes(q))&&(state==='all'||(state==='draft'?p.status!=='ok':p.status==='ok'))&&(issue==='all'||(issue==='issues'&&issues.length>0)||(issue==='clean'&&issues.length===0)||issues.some(i=>i.id===issue)));
 $('a51-qc-count').textContent=filtered.length+' de '+entries.length+' productos';
 $('a51-qc-rows').innerHTML=filtered.length?filtered.map(({p,issues})=>{
  const slug=clean(p.slug);
  const href='/admin/editor?slug='+encodeURIComponent(slug);
  return '<tr><td><strong>'+esc(p.name||'(sin nombre)')+'</strong><div class="muted">'+esc(slug||'Sin slug')+'</div></td><td>'+esc(p.status==='ok'?'Publicado':'Borrador')+'</td><td>'+(issues.length?'<div class="tags">'+issues.map(i=>'<span class="tag'+(i.critical?' critical':'')+'">'+esc(i.label)+'</span>').join('')+'</div>':'<span class="ok">✓ Sin observaciones</span>')+'</td><td>'+(slug?'<a class="action" href="'+esc(href)+'">✎ Corregir</a>':'<span class="muted">Sin enlace de edición</span>')+'</td></tr>';
 }).join(''):'<tr><td colspan="4" class="muted">No hay juegos para este filtro.</td></tr>';
}
function stats(){
 const count=id=>entries.filter(e=>e.issues.some(i=>i.id===id)).length;
 const metrics=[['Total',entries.length],['Con observaciones',entries.filter(e=>e.issues.length).length],['Sin portada',count('cover')],['Sin descripción',count('description')],['Sin requisitos',count('requirements')],['Posibles duplicados',count('duplicate')]];
 $('a51-qc-stats').innerHTML=metrics.map(([name,value])=>'<div class="stat"><strong>'+value+'</strong><span>'+esc(name)+'</span></div>').join('');
}
async function refresh(){
 $('a51-qc-status').textContent='Analizando fichas…';
 try{
  // Consulta directa con control explícito de errores: una falla no se interpreta como catálogo vacío.
  const {data,error}=await A51_CLIENT.from('products').select(A51_PRODUCT_SELECT).order('updated_at',{ascending:false});
  if(error)throw error;
  if(!Array.isArray(data))throw new Error('Respuesta de productos no válida');
  entries=audit(data.map(a51_mapProductRow));stats();render();
  $('a51-qc-status').textContent='✓ Diagnóstico finalizado. No se modificó ningún producto.';
 }catch(e){console.error('AREA 51 control calidad:',e);$('a51-qc-status').textContent='⚠ No se pudo completar la auditoría. Revisá la conexión y los permisos. No se alteró ningún dato.';}
}
async function init(){
 try{
  const session=await a51_requireSession();if(!session)return;
  const admin=await a51_getCurrentAdmin();
  if(!admin||admin.role!=='admin'){ $('a51-qc-status').textContent='Acceso exclusivo para administradores.';return;}
  $('a51-qc-app').classList.remove('hidden');
  for(const id of ['a51-qc-search','a51-qc-state','a51-qc-issue'])$(id).addEventListener(id==='a51-qc-search'?'input':'change',render);
  $('a51-qc-refresh').addEventListener('click',refresh);
  await refresh();
 }catch(e){console.error(e);$('a51-qc-status').textContent='No se pudo verificar la sesión.';}
}
init();
})();