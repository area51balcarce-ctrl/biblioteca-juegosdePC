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
async function lookupSteam(name){
 try{
  const search=await getJson('https://store.steampowered.com/api/storesearch/?term='+encodeURIComponent(name)+'&l=english&cc=us');
  const items=Array.isArray(search?.items)?search.items:[];
  const exact=items.filter(x=>normalize(x.name)===normalize(name)&&Number.isSafeInteger(Number(x.id)));
  if(exact.length!==1)return {verified:false,source:'Steam',reason:'Steam no devolvió una coincidencia única'};
  const id=Number(exact[0].id);
  const response=await getJson('https://store.steampowered.com/api/appdetails?appids='+id+'&l=english&cc=us&filters=basic,pc_requirements');
  const game=response?.[id]?.data;
  if(!response?.[id]?.success||normalize(game?.name)!==normalize(exact[0].name))return {verified:false,source:'Steam',reason:'Datos del juego no verificables'};
  const requirements=game.pc_requirements||{};
  const size=sizeFromText(requirements.minimum||'')||sizeFromText(requirements.recommended||'');
  return size?{verified:true,source:'Steam',name:game.name,size,sourceUrl:'https://store.steampowered.com/app/'+id+'/',kind:'Espacio requerido para instalación'}:{verified:false,source:'Steam',reason:'Steam no publica espacio requerido'};
 }catch(e){return {verified:false,source:'Steam',reason:'No se pudo consultar Steam'};}
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 const name=String(req.query?.q||'').trim();
 if(name.length<3||name.length>140)return res.status(400).json({error:'Nombre inválido'});
 try{
  const search=await getJson('https://embed.gog.com/games/ajax/filtered?mediaType=game&search='+encodeURIComponent(name)+'&limit=20');
  const games=Array.isArray(search?.products)?search.products:[];
  const simplified=x=>normalize(x).replace(/\\b(?:the|edition|standard|game|pc|windows)\\b/g,'').replace(/\\s+/g,' ').trim();
  const matches=games.filter(x=>/^\\d+$/.test(String(x.id))).map(x=>{
   const title=normalize(x.title),requested=normalize(name);
   const score=title===requested?100:simplified(title)===simplified(requested)?92:0;
   return {...x,score};
  }).filter(x=>x.score>=92).sort((a,b)=>b.score-a.score);
  if(matches.length!==1){
   const steam=await lookupSteam(name);
   if(steam.verified)return res.status(200).json(steam);
   return res.status(200).json({verified:false,source:'GOG + Steam',reason:matches.length>1?'Varias ediciones posibles; se requiere verificar el título':'No se encontró espacio de instalación verificable en GOG ni Steam',candidates:matches.slice(0,5).map(x=>({name:x.title,id:x.id}))});
  }
  const match=matches[0];
  const product=await getJson('https://api.gog.com/products/'+encodeURIComponent(match.id)+'?expand=description');
  const title=product?.title||product?.name||match.title;
  if(normalize(title)!==normalize(match.title))return res.status(200).json({verified:false,source:'GOG',reason:'El producto devuelto no coincide con la selección'});
  const size=candidates(product).map(sizeFromText).find(Boolean)||'';
  if(size){
   const url='https://www.gog.com'+(String(match.url||'').startsWith('/')?match.url:'/game/'+encodeURIComponent(product?.slug||''));
   return res.status(200).json({verified:true,source:'GOG',name:title,size,sourceUrl:url,kind:'Espacio requerido para instalación'});
  }
  const steam=await lookupSteam(name);
  return res.status(200).json(steam.verified?steam:{verified:false,source:'GOG + Steam',reason:'No se publicó un valor verificable de espacio requerido en las fuentes consultadas'});
 }catch(e){console.error('A51 GOG storage:',e.message);return res.status(200).json({verified:false,source:'GOG',reason:'La fuente secundaria no respondió. No se estimó ningún valor.'});}
};