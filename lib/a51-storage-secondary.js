/* AREA 51 - Fuente secundaria de almacenamiento (GOG). No escribe en Supabase. */
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
async function getJson(url){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),7500);
 try{const r=await fetch(url,{signal:controller.signal,headers:{'Accept':'application/json','User-Agent':'AREA51-Catalog-Quality/1.0'}});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}
}
function plain(s){return String(s||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
function sizeFromText(s){
 const t=plain(s);
 const patterns=[/(?:storage|hard drive|disk space|available space|almacenamiento|espacio disponible|disco duro|espacio en disco)\s*[:\-]?\s*(?:at least|minimum|mínimo|al menos)?\s*(\d+(?:[.,]\d+)?)\s*(GB|MB|TB)/i,/(\d+(?:[.,]\d+)?)\s*(GB|MB|TB)\s*(?:available space|of free space|de espacio disponible|de espacio libre)/i];
 for(const p of patterns){const m=t.match(p);if(m)return m[1].replace(',','.')+' '+m[2].toUpperCase();}
 return '';
}
function candidates(product){
 const req=product?.content?.system_requirements||product?.system_requirements||{};
 const parts=[];
 function collect(v,depth=0){if(depth>5||v==null)return;if(typeof v==='string')parts.push(v);else if(Array.isArray(v))v.forEach(x=>collect(x,depth+1));else if(typeof v==='object')for(const [k,x] of Object.entries(v)){if(/windows|pc|minimum|minimal|recommended|requirements|storage|disk|system/i.test(k)||depth>0)collect(x,depth+1);}}
 collect(req);return parts;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 const name=String(req.query?.q||'').trim();
 if(name.length<3||name.length>140)return res.status(400).json({error:'Nombre inválido'});
 try{
  const search=await getJson('https://embed.gog.com/games/ajax/filtered?mediaType=game&search='+encodeURIComponent(name)+'&limit=20');
  const games=Array.isArray(search?.products)?search.products:[];
  const exact=games.filter(x=>normalize(x.title)===normalize(name)&&/^\d+$/.test(String(x.id)));
  if(exact.length!==1)return res.status(200).json({verified:false,source:'GOG',reason:exact.length>1?'Varias coincidencias exactas':'Sin coincidencia exacta'});
  const match=exact[0];
  const product=await getJson('https://api.gog.com/products/'+encodeURIComponent(match.id)+'?expand=description');
  const title=product?.title||product?.name||match.title;
  if(normalize(title)!==normalize(name))return res.status(200).json({verified:false,source:'GOG',reason:'Nombre del producto no coincide'});
  const size=candidates(product).map(sizeFromText).find(Boolean)||'';
  if(!size)return res.status(200).json({verified:false,source:'GOG',reason:'GOG no publicó espacio verificable para este juego'});
  const url='https://www.gog.com'+(String(match.url||'').startsWith('/')?match.url:'/game/'+encodeURIComponent(product?.slug||''));
  return res.status(200).json({verified:true,source:'GOG',name:title,size,sourceUrl:url,kind:'Espacio requerido para instalación'});
 }catch(e){console.error('A51 GOG storage:',e.message);return res.status(200).json({verified:false,source:'GOG',reason:'La fuente secundaria no respondió. No se estimó ningún valor.'});}
};