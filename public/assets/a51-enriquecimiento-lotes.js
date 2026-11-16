/* AREA 51 — Enriquecimiento por lotes v1.0. Guardado selectivo con control de concurrencia. */
(()=>{'use strict';
const $=id=>document.getElementById(id),clean=x=>String(x??'').trim(),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>clean(x).toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const fields=[['description','Descripción','description'],['req_min','Requisitos mínimos','reqMin'],['req_rec','Requisitos recomendados','reqRec'],['size','Espacio requerido','size'],['languages','Idiomas','languages']];
let rows=[],running=false;
const status=t=>$('a51-enrich-status').textContent=t;
function incomplete(r){return fields.some(([col])=>!clean(r[col]));}
function candidate(r){return {raw:r,match:null,proposed:null,manual:{},secondary:null,selected:new Set(),error:'',searchResults:[],busy:false,enabled:true};}
function proposedValue(r,col,key){return clean(r.manual[col])||clean(r.proposed?.[key]);}
function selectAvailable(r){for(const [col,,key] of fields){if(!clean(r.raw[col])&&proposedValue(r,col,key))r.selected.add(col);}}
function hasApproved(r){return [...r.selected].some(col=>{const f=fields.find(x=>x[0]===col);return f&&!clean(r.raw[col])&&proposedValue(r,col,f[2]);});}
function render(){
 $('a51-enrich-count').textContent=rows.length+' fichas cargadas · '+rows.filter(r=>r.proposed).length+' con vista previa';
 $('a51-enrich-list').innerHTML=rows.map((r,i)=>{
  const p=r.raw;
  const fieldsHtml=fields.filter(([col])=>!clean(p[col])).map(([col,label,key])=>{
   const automatic=clean(r.proposed?.[key]),manual=clean(r.manual[col]),value=manual||automatic;
   return '<div class="field"><label><input type="checkbox" data-i="'+i+'" data-col="'+esc(col)+'" '+(r.selected.has(col)?'checked':'')+' '+(!value?'disabled':'')+'> <b>'+esc(label)+'</b></label>'+
   (automatic?'<div class="new">🤖 '+esc(col==='size'&&r.secondary?.verified?(r.secondary.source||'Fuente secundaria'):'IGDB/Steam')+': '+esc(automatic)+'</div>':'<div class="muted">Sin dato automático disponible.</div>')+
   '<label style="display:block;margin-top:8px">✍️ Carga manual (opcional)<textarea data-manual="'+i+'" data-field="'+esc(col)+'" rows="3" style="display:block;width:100%;margin-top:5px;resize:vertical" placeholder="Escribí el dato para esta ficha…">'+esc(r.manual[col]||'')+'</textarea></label>'+
   (manual?'<small>Se usará tu texto manual en lugar del automático.</small>':'')+'</div>';
  }).join('');
  const missing=fields.filter(([col])=>!clean(p[col]));
  const automaticAvailable=missing.filter(([col,,key])=>clean(r.proposed?.[key]));
  const manualAvailable=missing.filter(([col])=>clean(r.manual[col]));
  const feedback=r.proposed?'<div class="field" style="border-color:#6cbf85;background:#173022"><strong>🤖 Resultado de la consulta</strong><p class="good">🟢 '+automaticAvailable.length+' campos encontrados automáticamente: '+esc(automaticAvailable.map(x=>x[1]).join(', ')||'ninguno')+'</p><p class="muted">🟡 '+(missing.length-automaticAvailable.length)+' campos sin datos automáticos: '+esc(missing.filter(([col,,key])=>!clean(r.proposed?.[key])).map(x=>x[1]).join(', ')||'ninguno')+'</p><p>💾 '+r.selected.size+' campos marcados para guardar · ✍️ '+manualAvailable.length+' con texto manual</p></div>':r.searchResults.length?'<p class="muted">🔎 Resultados encontrados. Elegí una coincidencia y consultá sus detalles para ver los campos.</p>':'<p class="muted">⏳ Todavía no hay datos automáticos consultados para este juego.</p>';
  const storageLookup=!clean(p.size)?'<div class="bar" style="margin:9px 0"><button type="button" data-storage="'+i+'" '+(running?'disabled':'')+'>🔎 Buscar espacio en GOG + Steam</button>'+(r.secondary?'<span class="'+(r.secondary.verified?'good':'muted')+'">'+esc(r.secondary.verified?'Encontrado: '+r.secondary.size+' · '+(r.secondary.source||'Fuente verificada'):r.secondary.reason||'Sin datos verificables')+'</span>':'')+(r.secondary?.verified&&r.secondary.sourceUrl?'<a href="'+esc(r.secondary.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Ver fuente</a>':'')+'</div>':'';
  const options=r.searchResults.length?'<label>Coincidencia IGDB <select data-match="'+i+'"><option value="">Elegí un resultado para consultar sus datos</option>'+r.searchResults.map(x=>'<option value="'+esc(x.id)+'" '+(r.match===String(x.id)?'selected':'')+'>'+esc(x.name)+' ('+esc(x.released||'sin fecha')+')</option>').join('')+'</select></label><button data-detail="'+i+'">Consultar coincidencia elegida</button>':'';
  return '<div class="entry"><div class="bar"><label class="name"><input type="checkbox" data-row="'+i+'" '+(r.enabled?'checked':'')+'>'+esc(p.name)+'</label><small>'+esc(p.status==='ok'?'Publicado':'Borrador')+'</small><a href="/admin/editor?slug='+encodeURIComponent(p.slug||'')+'" target="_blank" rel="noopener">Abrir editor</a><button type="button" data-auto="'+i+'" '+(running?'disabled':'')+'>🤖 Autocompletar este juego</button></div>'+(r.error?'<p class="danger">'+esc(r.error)+'</p>':'')+(r.proposed?'<p class="good">✓ Datos encontrados. Revisá y marcá los campos que quieras guardar.</p>':'')+feedback+storageLookup+options+(fieldsHtml?'<details open><summary>📝 Campos faltantes · automáticos o manuales ('+r.selected.size+' seleccionados)</summary><div>'+fieldsHtml+'</div></details>':'<p class="good">No hay campos pendientes en esta ficha.</p>')+'</div>';
 }).join('');
 $('a51-enrich-search').disabled=running||!rows.length;
 $('a51-enrich-save').disabled=running||!rows.some(r=>hasApproved(r));
}
async function load(){
 if(running)return;running=true;rows=[];render();status('Cargando fichas incompletas…');
 try{
  const limit=Number($('a51-enrich-limit').value),pageSize=500;let offset=0,found=[];
  while(found.length<limit){
   const {data,error}=await A51_CLIENT.from('products').select('id,slug,name,status,description,req_min,req_rec,size,languages,updated_at').order('name').range(offset,offset+pageSize-1);
   if(error)throw error;
   found.push(...(data||[]).filter(r=>clean(r.name)&&clean(r.slug)&&incomplete(r)));
   if(!data||data.length<pageSize)break;
   offset+=pageSize;
  }
  rows=found.slice(0,limit).map(candidate);
  status(rows.length?'✓ Fichas cargadas. Seleccioná los juegos que querés consultar.':'No se encontraron fichas incompletas.');
 }catch(e){console.error(e);status('⚠ Error consultando productos. No se modificó ningún dato.');}
 finally{running=false;render();}
}
async function search(){
 if(running)return;running=true;render();
 for(let i=0;i<rows.length;i++){
  const r=rows[i];if(!r.enabled)continue;
  status('Consultando IGDB '+(i+1)+'/'+rows.length+': '+r.raw.name);
  try{
   const response=await fetch('/api/igdb-data-v2?q='+encodeURIComponent(r.raw.name));
   const data=await response.json();if(!response.ok)throw Error(data.error||'Error de búsqueda');
   r.searchResults=(data.results||[]).filter(x=>x.id&&x.name).slice(0,10);
   r.match=null;r.proposed=null;r.selected.clear();
   if(!r.searchResults.length)r.error='Sin coincidencias. Conservamos la ficha sin cambios.';
   else{
    const exact=r.searchResults.filter(x=>norm(x.name)===norm(r.raw.name));
    if(exact.length===1){r.match=String(exact[0].id);r.error='Coincidencia exacta sugerida. Confirmá el juego antes de consultar detalles.';}
    else r.error='Revisá las coincidencias: no se eligió ninguna automáticamente.';
   }
  }catch(e){r.error='Error de búsqueda: '+e.message;r.searchResults=[];}
  render();
 }
 running=false;status('✓ Búsqueda terminada. Confirmá cada coincidencia y consultá los detalles.');render();
}
async function autoOne(i){
 const r=rows[i];if(!r||running)return;
 running=true;render();status('🤖 Buscando datos para '+r.raw.name+'…');
 try{
  const response=await fetch('/api/igdb-data-v2?q='+encodeURIComponent(r.raw.name));
  const data=await response.json();if(!response.ok)throw Error(data.error||'Error de búsqueda');
  r.searchResults=(data.results||[]).filter(x=>x.id&&x.name).slice(0,10);
  const exact=r.searchResults.filter(x=>norm(x.name)===norm(r.raw.name));
  r.match=null;r.proposed=null;r.selected.clear();
  if(exact.length!==1){
   r.error=exact.length>1?'Hay varias coincidencias exactas. Elegí una manualmente.':r.searchResults.length?'No hay coincidencia exacta. Elegí el juego correcto en la lista.':'No se encontraron resultados. Podés usar la carga manual.';
   status('Búsqueda finalizada. '+r.error);return;
  }
  r.match=String(exact[0].id);
  status('🤖 Consultando requisitos y descripción de '+r.raw.name+'…');
  const detailResponse=await fetch('/api/igdb-data-v2?id='+encodeURIComponent(r.match));
  const detailData=await detailResponse.json();if(!detailResponse.ok)throw Error(detailData.error||'Error de detalles');
  if(!detailData.product?.name||norm(detailData.product.name)!==norm(exact[0].name))throw Error('La respuesta no coincide con el juego elegido');
  r.proposed=detailData.product;
  selectAvailable(r);
  r.error=detailData.product.updateMeta?.hasSteamData?'':'IGDB encontró el juego, pero Steam no aportó datos adicionales.';
  status('✓ Vista previa automática lista para '+r.raw.name+'. Los campos encontrados quedaron preseleccionados; revisalos antes de guardar.');
 }catch(e){r.error='No se pudo autocompletar: '+e.message;status('⚠ '+r.error);}
 finally{running=false;render();}
}
async function detail(i){
 const r=rows[i];if(!r||!r.match||running)return;running=true;render();status('Consultando IGDB + Steam: '+r.raw.name);
 try{
  const response=await fetch('/api/igdb-data-v2?id='+encodeURIComponent(r.match));
  const data=await response.json();if(!response.ok)throw Error(data.error||'Error de detalles');
  if(!data.product?.name)throw Error('Respuesta sin nombre');
  const selected=r.searchResults.find(x=>String(x.id)===r.match);
  if(!selected||norm(data.product.name)!==norm(selected.name))throw Error('El resultado no coincide con la selección');
  r.proposed=data.product;r.selected.clear();selectAvailable(r);r.error='';
  if(!data.product.updateMeta?.hasSteamData)r.error='IGDB respondió, pero Steam no aportó datos. Revisá la información disponible.';
 }catch(e){r.proposed=null;r.error='No se pudo obtener la ficha: '+e.message;}
 finally{running=false;status('Revisión lista. Los campos disponibles quedaron preseleccionados; podés desmarcar cualquiera antes de guardar.');render();}
}
async function lookupStorage(i){
 const r=rows[i];if(!r||running||clean(r.raw.size))return;
 running=true;render();status('🔎 Consultando GOG + Steam para '+r.raw.name+'…');
 try{
  const response=await fetch('/api/igdb-data-v2?mode=storage-secondary&q='+encodeURIComponent(r.raw.name));
  const result=await response.json();if(!response.ok)throw Error(result.error||'Error de consulta');
  r.secondary=result;
  if(result.verified&&/^\d+(?:\.\d+)? (?:GB|MB|TB)$/.test(result.size)){
   r.proposed=r.proposed||{};
   if(!clean(r.proposed.size))r.proposed.size=result.size;
   r.selected.add('size');
   status('✓ '+(result.source||'Fuente secundaria')+' encontró espacio requerido: '+result.size+'. Campo preseleccionado; revisalo antes de guardar.');
  }else status('🟡 No se encontró un valor verificable: '+(result.reason||'sin datos')+'. No se inventó ningún tamaño.');
 }catch(e){r.secondary={verified:false,reason:'Error consultando GOG'};status('⚠ No se pudo consultar la fuente secundaria. No se modificó ningún dato.');console.error(e);}
 finally{running=false;render();}
}
async function save(){
 if(running)return;
 const selected=rows.filter(r=>hasApproved(r));if(!selected.length)return;
 const count=selected.reduce((n,r)=>n+fields.filter(([col,,key])=>r.selected.has(col)&&!clean(r.raw[col])&&proposedValue(r,col,key)).length,0);
 if(!confirm('¿Guardar '+count+' campos aprobados en '+selected.length+' juegos? Se verificarán nuevamente los valores antes de cada escritura.'))return;
 running=true;render();let ok=0,skipped=0,errors=0;
 for(const r of selected){
  status('Guardando '+r.raw.name+'…');
  try{
   const {data:latest,error:readError}=await A51_CLIENT.from('products').select('id,updated_at,description,req_min,req_rec,size,languages').eq('id',r.raw.id).single();
   if(readError)throw readError;
   // Nunca pisar información existente o una ficha modificada desde la vista previa.
   if(latest.updated_at!==r.raw.updated_at){skipped++;r.error='Ficha modificada desde la carga. Actualizá el lote.';continue;}
   const payload={};const guards=[];
   for(const [col,,key] of fields){
    if(!r.selected.has(col))continue;
    const proposed=proposedValue(r,col,key);
    if(!proposed||clean(latest[col])||clean(r.raw[col]))continue;
    payload[col]=proposed;guards.push([col,latest[col]]);
   }
   if(!Object.keys(payload).length){skipped++;r.error='Los campos seleccionados ya no están vacíos.';continue;}
   let query=A51_CLIENT.from('products').update(payload).eq('id',r.raw.id).eq('updated_at',r.raw.updated_at);
   for(const [col,value] of guards)query=value===null?query.is(col,null):query.eq(col,value);
   const {data:updated,error}=await query.select('id,updated_at').maybeSingle();
   if(error)throw error;
   if(!updated){skipped++;r.error='Conflicto de datos: no se guardó. Recargá la ficha.';continue;}
   Object.assign(r.raw,payload);r.raw.updated_at=updated.updated_at;r.selected.clear();ok++;r.error='';
  }catch(e){errors++;r.error='No se pudo guardar: '+e.message;console.error('Enriquecimiento',e);}
  render();
 }
 running=false;status('Finalizado: '+ok+' juegos actualizados · '+skipped+' omitidos por seguridad · '+errors+' errores. No se sobrescribieron campos completos.');render();
}
async function init(){
 try{
  const session=await a51_requireSession();if(!session)return;
  const admin=await a51_getCurrentAdmin();if(!admin||admin.role!=='admin'){status('Acceso exclusivo para administradores.');return;}
  $('a51-enrich-app').classList.remove('hidden');
  $('a51-enrich-load').addEventListener('click',load);
  $('a51-enrich-search').addEventListener('click',search);
  $('a51-enrich-save').addEventListener('click',save);
  $('a51-enrich-list').addEventListener('change',e=>{
   const t=e.target,i=Number(t.dataset.i??t.dataset.row??t.dataset.match);
   if(!Number.isInteger(i)||!rows[i])return;
   if(t.hasAttribute('data-row'))rows[i].enabled=t.checked;
   else if(t.hasAttribute('data-i')){if(t.checked)rows[i].selected.add(t.dataset.col);else rows[i].selected.delete(t.dataset.col);}
   else if(t.hasAttribute('data-match')){rows[i].match=t.value;rows[i].proposed=null;rows[i].selected.clear();}
   render();
  });
  $('a51-enrich-list').addEventListener('input',e=>{
   const t=e.target;if(!t.hasAttribute('data-manual'))return;
   const i=Number(t.dataset.manual),col=t.dataset.field,r=rows[i];
   if(!r||!fields.some(f=>f[0]===col)||clean(r.raw[col]))return;
   r.manual[col]=t.value;
   if(clean(t.value))r.selected.add(col);else if(!clean(r.proposed?.[fields.find(f=>f[0]===col)[2]]))r.selected.delete(col);
   // No redibujar mientras escribe: conservar foco, cursor y texto.
   const checkbox=$('a51-enrich-list').querySelector('input[data-i="'+i+'"][data-col="'+col+'"]');
   if(checkbox){checkbox.disabled=!proposedValue(r,col,fields.find(f=>f[0]===col)[2]);checkbox.checked=r.selected.has(col);if(checkbox.disabled){checkbox.checked=false;r.selected.delete(col);}}
   $('a51-enrich-save').disabled=running||!rows.some(x=>hasApproved(x));
  });
  $('a51-enrich-list').addEventListener('click',e=>{const storage=e.target.closest('[data-storage]');if(storage){lookupStorage(Number(storage.dataset.storage));return;}const auto=e.target.closest('[data-auto]');if(auto){autoOne(Number(auto.dataset.auto));return;}const b=e.target.closest('[data-detail]');if(b)detail(Number(b.dataset.detail));});
  status('Listo. Cargá un lote de fichas incompletas.');
 }catch(e){console.error(e);status('No se pudo iniciar el módulo.');}
}
init();
})();