/* AREA 51: limpieza optativa de un torrent manual. Nunca borra sin permiso de carpeta. */
(()=>{
'use strict';
const host=document.getElementById('a51-manual-torrent-cleanup');
if(!host)return;
let directory=null;
const btn=document.createElement('button');
btn.type='button';btn.textContent='📂 Autorizar carpeta para borrar el .torrent tras guardar';
btn.style.cssText='padding:8px 12px;margin:4px 0;background:#20351d;color:#baff75;border:1px solid #638d45;border-radius:6px;cursor:pointer';
const hint=document.createElement('p');
hint.style.cssText='font-size:12px;color:#bdcdb8;margin:5px 0 12px';
hint.textContent='Opcional: elegí la carpeta donde está el archivo (por ejemplo D:\\torrent). Solo se elimina el .torrent que subiste y únicamente después de guardarlo correctamente.';
host.append(btn,hint);
btn.addEventListener('click',async()=>{
 if(typeof window.showDirectoryPicker!=='function'){
  hint.textContent='Este navegador no permite autorizar carpetas. La carga manual seguirá funcionando, sin borrado automático.';return;
 }
 try{
  const chosen=await window.showDirectoryPicker({id:'a51-manual-torrent-cleanup',mode:'readwrite'});
  if(await chosen.queryPermission({mode:'readwrite'})!=='granted'){
   const granted=await chosen.requestPermission({mode:'readwrite'});
   if(granted!=='granted'){hint.textContent='No se autorizó la eliminación. No se borrará ningún archivo.';return;}
  }
  directory=chosen;
  hint.textContent='✓ Carpeta autorizada: '+chosen.name+'. Al guardar correctamente, se eliminará únicamente el archivo seleccionado si coincide exactamente.';
 }catch(e){
  if(e?.name!=='AbortError')hint.textContent='No se pudo autorizar la carpeta: '+(e?.message||e);
 }
});
window.A51ManualTorrentCleanup={
 onOpen(){hint.textContent=directory?'✓ Carpeta autorizada: '+directory.name+'. Elegí el archivo .torrent y guardalo.':'Opcional: autorizá la carpeta donde está el archivo (por ejemplo D:\\torrent) para eliminarlo después de una carga confirmada.';},
 async afterUpload(uploadedFile){
  if(!directory)return 'El archivo local se conservó (no se autorizó carpeta).';
  if(!uploadedFile||!uploadedFile.name.toLowerCase().endsWith('.torrent'))return 'Archivo local conservado: tipo no válido.';
  try{
   if(await directory.queryPermission({mode:'readwrite'})!=='granted')return 'Archivo local conservado: falta permiso de eliminación.';
   const handle=await directory.getFileHandle(uploadedFile.name,{create:false});
   const current=await handle.getFile();
   // No eliminar un archivo que haya cambiado o que no sea el seleccionado.
   if(current.name!==uploadedFile.name||current.size!==uploadedFile.size||current.lastModified!==uploadedFile.lastModified){
    return 'Archivo local conservado: el archivo de la carpeta no coincide con el subido.';
   }
   await directory.removeEntry(uploadedFile.name);
   return '✓ Archivo .torrent eliminado de la carpeta autorizada.';
  }catch(e){
   return 'Archivo guardado, pero no se pudo eliminar el archivo local: '+(e?.message||String(e));
  }
 }
};
})();