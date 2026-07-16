const RAWG_BASE = 'https://api.rawg.io/api';

function send(res, status, body){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8').send(JSON.stringify(body));
}

function stripHtml(value=''){
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseSteamAppId(url=''){
  const match = String(url).match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? match[1] : null;
}

function extractStorage(...texts){
  const joined = texts.filter(Boolean).join(' ');
  const patterns = [
    /(?:storage|almacenamiento|espacio disponible|hard drive|disco duro)[^\d]{0,25}(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)/i,
    /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\s*(?:available space|de espacio disponible|de almacenamiento)/i
  ];
  for(const pattern of patterns){
    const match = joined.match(pattern);
    if(match) return `${match[1].replace(',','.')} ${match[2].toUpperCase()}`;
  }
  return '';
}

function normalizeLanguages(html=''){
  const text = stripHtml(html);
  if(!text) return 'Español, Inglés';
  const hasSpanish = /spanish|español|castellano/i.test(text);
  const hasEnglish = /english|inglés/i.test(text);
  const langs = [];
  if(hasSpanish) langs.push('Español');
  if(hasEnglish) langs.push('Inglés');
  return langs.length ? langs.join(', ') : 'Español, Inglés';
}

async function rawg(path, key){
  const sep = path.includes('?') ? '&' : '?';
  const response = await fetch(`${RAWG_BASE}${path}${sep}key=${encodeURIComponent(key)}`);
  if(!response.ok) throw new Error(`RAWG respondió ${response.status}`);
  return response.json();
}

async function steamDetails(appId){
  if(!appId) return null;
  try{
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=spanish&cc=ar`);
    if(!response.ok) return null;
    const json = await response.json();
    return json?.[appId]?.success ? json[appId].data : null;
  }catch{
    return null;
  }
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET') return send(res,405,{error:'Método no permitido'});
  const key = process.env.RAWG_API_KEY;
  if(!key) return send(res,500,{error:'Falta RAWG_API_KEY en Vercel.'});

  try{
    const query = String(req.query.q || '').trim();
    const id = String(req.query.id || '').trim();

    if(query){
      const data = await rawg(`/games?search=${encodeURIComponent(query)}&page_size=6&search_precise=true`, key);
      const results = (data.results || []).map(game => ({
        id: game.id,
        name: game.name,
        released: game.released || '',
        coverUrl: game.background_image || '',
        genres: (game.genres || []).map(g => g.name),
        platforms: (game.platforms || []).map(p => p.platform?.name).filter(Boolean)
      }));
      return send(res,200,{results});
    }

    if(id){
      const [game, stores] = await Promise.all([
        rawg(`/games/${encodeURIComponent(id)}`, key),
        rawg(`/games/${encodeURIComponent(id)}/stores`, key).catch(() => ({results:[]}))
      ]);

      const steamStore = (stores.results || []).find(s => parseSteamAppId(s.url));
      const steamId = steamStore ? parseSteamAppId(steamStore.url) : null;
      const steam = await steamDetails(steamId);

      const pcPlatform = (game.platforms || []).find(p => /pc/i.test(p.platform?.name || ''));
      const rawgMin = pcPlatform?.requirements?.minimum || '';
      const rawgRec = pcPlatform?.requirements?.recommended || '';
      const steamMin = steam?.pc_requirements?.minimum || '';
      const steamRec = steam?.pc_requirements?.recommended || '';

      const reqMin = stripHtml(steamMin || rawgMin);
      const reqRec = stripHtml(steamRec || rawgRec);
      const description = stripHtml(steam?.short_description || game.description_raw || game.description || '');
      const coverUrl = steam?.header_image || game.background_image || game.background_image_additional || '';
      const size = extractStorage(steamMin, steamRec, rawgMin, rawgRec);
      const languages = normalizeLanguages(steam?.supported_languages || '');
      const genres = (game.genres || []).map(g => g.name);
      const developers = steam?.developers || game.developers?.map(d => d.name) || [];
      const publishers = steam?.publishers || game.publishers?.map(p => p.name) || [];

      return send(res,200,{
        product:{
          name: game.name,
          category: 'Juego de PC',
          status: 'ok',
          legalBasis: 'propio',
          description,
          reqMin,
          reqRec,
          size,
          version: '',
          languages,
          tags: [...genres, ...developers, ...publishers].filter(Boolean).slice(0,10).join(', '),
          coverUrl,
          released: game.released || steam?.release_date?.date || '',
          source: steam ? 'RAWG + Steam' : 'RAWG'
        }
      });
    }

    return send(res,400,{error:'Indicá q o id.'});
  }catch(error){
    console.error(error);
    return send(res,500,{error:'No se pudo consultar la información del producto.'});
  }
};
