/* AREA 51 - Asociador masivo de archivos .torrent. Módulo aislado.
   No modifica la ficha, ni los enlaces existentes, ni reemplaza archivos. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const releaseWords=/\b(?:fitgirl|repack|dodi|elamigos|gog|codex|skidrow|plaza|tenoke|rune|portable|multi\d*|eng|english|spanish|espanol|edition|complete|deluxe|ultimate|setup|v\d+(?:\.\d+)*|build\s*\d+|x64|x86)\b/gi;
const cleanFile=name=>{
 let base=String(name||'').replace(/\.torrent$/i,'');
 base=base.replace(/\[[^\]]*\]|\([^)]*\)/g,' ');
 base=base.replace(releaseWords,' ');
 return normalize(base);
};
let candidates=[],busy=false;
let authorizedDirectory=null,authorizedFiles=new Map(),cleanupCount=0,cleanupErrors=0;
async function chooseAuthorizedFolder(){
 if(busy)return;
 if(typeof window.showDirectoryPicker!=='function'){
  status('Edge no permite autorizar la carpeta. Actualizá el navegador.');return;
 }
 let directory;
 try{directory=await window.showDirectoryPicker({id:'a51-torrent-cleanup',mode:'readwrite'});}
 catch(error){if(error?.name!=='AbortError')status('Carpeta no autorizada: '+(error?.message||String(error)));return;}
 const selected=[],handles=new Map();
 try{
  for await(const [name,handle] of directory.entries()){
   if(handle.kind!=='file'||!name.toLowerCase().endsWith('.torrent'))continue;
   const file=await handle.getFile();
   selected.push(file);
   handles.set(name,{handle,size:file.size,lastModified:file.lastModified});
  }
 }catch(error){status('Error leyendo carpeta: '+(error?.message||String(error)));return;}
 authorizedDirectory=directory;authorizedFiles=handles;
 $('a51-bulk-files').value='';
 scan(selected);
 status('Carpeta autorizada: '+directory.name+'. Solo se borrarán definitivamente los archivos que se suban correctamente.');
}
async function cleanupUploaded(item){
 if(!authorizedDirectory)return '✓ Subido; sin borrado (selector tradicional)';
 const snapshot=authorizedFiles.get(item.file.name);
 if(!snapshot)return '✓ Subido; sin borrado (archivo no autorizado)';
 try{
  if((await authorizedDirectory.queryPermission({mode:'readwrite'}))!=='granted')
   return '✓ Subido; sin borrado (falta permiso)';
  const currentHandle=await authorizedDirectory.getFileHandle(item.file.name);
  if(!(await currentHandle.isSameEntry(snapshot.handle)))return '✓ Subido; sin borrado (archivo diferente)';
  const current=await currentHandle.getFile();
  if(current.size!==snapshot.size||current.lastModified!==snapshot.lastModified)
   return '✓ Subido; sin borrado (archivo modificado)';
  await authorizedDirectory.removeEntry(item.file.name);
  authorizedFiles.delete(item.file.name);
  cleanupCount++;
  return '✓ Subido y eliminado de la PC';
 }catch(error){
  cleanupErrors++;
  return '✓ Subido; NO eliminado: '+(error?.message||String(error));
 }
}
function status(message){$('a51-bulk-status').textContent=message;}
function hide(){if(busy)return;$('a51-bulk-dialog').hidden=true;}
function render(){
 const body=$('a51-bulk-results');body.replaceChildren();
 const good=candidates.filter(x=>x.state==='ready');
 $('a51-bulk-summary').textContent=`${candidates.length} archivos · ${good.length} coincidencias seguras · ${candidates.length-good.length} pendientes/omitidos`;
 for(const item of candidates){
  const row=document.createElement('tr');
  const cells=[item.file.name,item.product?.name||'—',item.state==='ready'?'✓ Listo':item.reason];
  for(const value of cells){const td=document.createElement('td');td.textContent=value;td.style.cssText='padding:8px;border-bottom:1px solid #34503b;vertical-align:top;overflow-wrap:anywhere';row.append(td);}
  body.append(row);
 }
 $('a51-bulk-upload').disabled=!good.length;
}
function scan(files){
 if(busy)return;
 candidates=[];
 const products=(typeof ALL_PRODUCTS!=='undefined'?ALL_PRODUCTS:[]).filter(p=>p.status==='ok');
 const index=new Map();
 for(const product of products){
  const key=normalize(product.name);
  if(!key)continue;
  if(!index.has(key))index.set(key,[]);
  index.get(key).push(product);
 }
 const seen=new Set();
 for(const file of Array.from(files||[]).filter(f=>f.name.toLowerCase().endsWith('.torrent'))){
  const key=cleanFile(file.name),matches=index.get(key)||[];
  const item={file,product:null,state:'skip',reason:''};
  if(!key) item.reason='Nombre no identificable';
  else if(matches.length===0)item.reason='Sin coincidencia exacta';
  else if(matches.length!==1)item.reason='Nombre ambiguo: varios juegos';
  else if(seen.has(matches[0].id))item.reason='Más de un Torrent para el mismo juego';
  else if(typeof hasTorrent==='function'&&hasTorrent(matches[0]))item.reason='Ya tiene respaldo Torrent';
  else if(matches[0].files?.main?.path)item.reason='Ya tiene archivo principal: revisar manualmente';
  else if(file.size>250*1024*1024)item.reason='Archivo demasiado grande';
  else{item.product=matches[0];item.state='ready';item.reason='Listo';seen.add(matches[0].id);}
  candidates.push(item);
 }
 render();
 status(candidates.length?'Revisá las coincidencias antes de subir. No se reemplazará ningún archivo existente.':'No se encontraron archivos .torrent en la selección.');
}
async function upload(){
 if(busy)return;
 const ready=candidates.filter(x=>x.state==='ready');
 if(!ready.length)return;
 if(!confirm(`¿Subir ${ready.length} Torrents a sus juegos correspondientes? Solo se cargarán coincidencias exactas y sin archivo previo.`))return;
 busy=true;$('a51-bulk-upload').disabled=true;$('a51-bulk-cancel').disabled=true;
 let ok=0,errors=0;
 cleanupCount=0;cleanupErrors=0;
 try{
  for(let i=0;i<ready.length;i++){
   const item=ready[i];
   status(`Subiendo ${i+1}/${ready.length}: ${item.product.name}`);
   try{
    const result=await a51_syncProductFiles(item.product.id,{mainFile:item.file,prevMain:null});
    if(!result.ok)throw result.error||Error('Error al guardar');
    item.state='done';item.reason='✓ Subido';ok++;
    item.reason=await cleanupUploaded(item);
   }catch(e){item.state='error';item.reason='Error: '+(e?.message||String(e));errors++;}
   render();
  }
  await loadProducts();
  status(`Finalizado: ${ok} subidos; ${cleanupCount} eliminados de la PC; ${errors} errores de subida; ${cleanupErrors} errores de limpieza. Los pendientes se conservan.`);
 }finally{busy=false;$('a51-bulk-cancel').disabled=false;$('a51-bulk-upload').disabled=true;}
}
function init(){
 const open=$('a51-bulk-open');if(!open)return;
 open.addEventListener('click',()=>{$('a51-bulk-dialog').hidden=false;});
 $('a51-bulk-cancel').addEventListener('click',hide);
 const picker=document.createElement('button');
 picker.type='button';picker.className='btn';
 picker.textContent='📂 Autorizar carpeta y escanear (limpieza automática)';
 picker.style.cssText='display:block;margin:10px 0;border-color:#aaff40;color:#aaff40';
 $('a51-bulk-files').insertAdjacentElement('beforebegin',picker);
 const note=document.createElement('p');
 note.textContent='Usá el botón de autorización para borrar definitivamente los .torrent subidos. El selector tradicional sigue disponible, pero no permite borrarlos.';
 note.style.cssText='font-size:12px;color:#d7e7d9;margin:8px 0';
 picker.insertAdjacentElement('afterend',note);
 picker.addEventListener('click',chooseAuthorizedFolder);
 $('a51-bulk-files').addEventListener('change',e=>{
  authorizedDirectory=null;authorizedFiles=new Map();scan(e.target.files);
  status('Selector tradicional: se subirán los archivos, pero NO se borrarán. Para limpieza automática usá Autorizar carpeta y escanear.');
 });
 $('a51-bulk-upload').addEventListener('click',upload);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
