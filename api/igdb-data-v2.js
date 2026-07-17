const IGDB_BASE = 'https://api.igdb.com/v4';
let tokenCache = { token: '', expiresAt: 0 };

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

function escapeApicalypse(value=''){
  return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}

function coverUrl(imageId, size='cover_big'){
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : '';
}

function parseSteamAppId(url=''){
  const match = String(url).match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? match[1] : null;
}

function extractStorage(...texts){
  const joined = texts.filter(Boolean).join(' ');
  const patterns = [
    /(?:storage|almacenamiento|espacio disponible|hard drive|disco duro)[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)/i,
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
  const langs = [];
  if(/spanish|español|castellano/i.test(text)) langs.push('Español');
  if(/english|inglés/i.test(text)) langs.push('Inglés');
  return langs.length ? langs.join(', ') : 'Español, Inglés';
}

async function getAccessToken(clientId, clientSecret){
  if(tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');
  const response = await fetch(url, { method:'POST' });
  if(!response.ok) throw new Error(`Twitch OAuth respondió ${response.status}`);
  const json = await response.json();
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600) - 300) * 1000
  };
  return tokenCache.token;
}

async function igdb(endpoint, body, clientId, token){
  const response = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method:'POST',
    headers:{
      'Accept':'application/json',
      'Content-Type':'text/plain',
      'Client-ID':clientId,
      'Authorization':`Bearer ${token}`
    },
    body
  });
  if(!response.ok){
    const text = await response.text().catch(()=> '');
    throw new Error(`IGDB respondió ${response.status}${text ? `: ${text.slice(0,160)}` : ''}`);
  }
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


async function steamGridDbRequest(path, apiKey){
  if(!apiKey) return null;
  try{
    const response = await fetch(`https://www.steamgriddb.com/api/v2${path}`, {
      headers:{
        'Accept':'application/json',
        'Authorization':`Bearer ${apiKey}`
      }
    });
    if(!response.ok){
      console.warn(`SteamGridDB respondió ${response.status} en ${path}`);
      return null;
    }
    const json = await response.json();
    return json?.success ? json : null;
  }catch(error){
    console.warn('SteamGridDB no disponible.', error);
    return null;
  }
}

function normalizeTitle(value=''){
  return String(value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

function pickBestSteamGrid(grids=[]){
  const allowed = grids.filter(item => item?.url && !item.tags?.some(tag => ['nsfw','humor','epilepsy'].includes(String(tag).toLowerCase())));
  allowed.sort((a,b) => Number(b.score || 0) - Number(a.score || 0));
  return allowed[0]?.url || '';
}

async function getSteamGridDbCover({apiKey, steamId, gameName}){
  if(!apiKey) return '';

  // La coincidencia por AppID de Steam es la más precisa y evita portadas de juegos homónimos.
  if(steamId){
    const bySteam = await steamGridDbRequest(
      `/grids/steam/${encodeURIComponent(steamId)}?dimensions=600x900,660x930,342x482&types=static&nsfw=false&humor=false&epilepsy=false&limit=50`,
      apiKey
    );
    const exactCover = pickBestSteamGrid(bySteam?.data || []);
    if(exactCover) return exactCover;
  }

  // Respaldo: buscar por nombre y elegir la coincidencia textual más cercana.
  const search = await steamGridDbRequest(`/search/autocomplete/${encodeURIComponent(gameName)}`, apiKey);
  const games = Array.isArray(search?.data) ? search.data : [];
  if(!games.length) return '';

  const wanted = normalizeTitle(gameName);
  const exact = games.find(game => normalizeTitle(game?.name) === wanted);
  const selected = exact || games[0];
  if(!selected?.id) return '';

  const grids = await steamGridDbRequest(
    `/grids/game/${encodeURIComponent(selected.id)}?dimensions=600x900,660x930,342x482&types=static&nsfw=false&humor=false&epilepsy=false&limit=50`,
    apiKey
  );
  return pickBestSteamGrid(grids?.data || []);
}

async function translateToSpanish(texts, apiKey){
  const originals = texts.map(text => String(text || '').trim());
  const nonEmpty = originals.map((text, index) => ({text, index})).filter(item => item.text);
  if(!apiKey || !nonEmpty.length) return originals;

  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try{
    const body = new URLSearchParams();
    nonEmpty.forEach(item => body.append('text', item.text));
    body.set('target_lang', 'ES');
    body.set('preserve_formatting', '1');

    const response = await fetch(endpoint, {
      method:'POST',
      headers:{
        'Authorization':`DeepL-Auth-Key ${apiKey}`,
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body
    });

    if(!response.ok){
      const detail = await response.text().catch(()=> '');
      console.warn(`DeepL respondió ${response.status}: ${detail.slice(0,160)}`);
      return originals;
    }

    const json = await response.json();
    const output = [...originals];
    (json.translations || []).forEach((translation, i) => {
      const target = nonEmpty[i];
      if(target && translation?.text) output[target.index] = translation.text.trim();
    });
    return output;
  }catch(error){
    console.warn('DeepL no disponible; se conserva el texto original.', error);
    return originals;
  }
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET') return send(res,405,{error:'Método no permitido'});

  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  const deeplApiKey = process.env.DEEPL_API_KEY || '';
  const steamGridDbApiKey = process.env.STEAMGRIDDB_API_KEY || '';

  if(!clientId || !clientSecret){
    return send(res,500,{error:'Faltan IGDB_CLIENT_ID y/o IGDB_CLIENT_SECRET en Vercel.'});
  }

  try{
    const token = await getAccessToken(clientId, clientSecret);
    const query = String(req.query.q || '').trim();
    const id = Number(req.query.id || 0);

    if(query){
      const body = `search "${escapeApicalypse(query)}"; fields name,first_release_date,cover.image_id,genres.name,platforms.name; where platforms = (6); limit 8;`;
      const games = await igdb('games', body, clientId, token);
      const results = games.map(game => ({
        id: game.id,
        name: game.name,
        released: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear().toString() : '',
        coverUrl: coverUrl(game.cover?.image_id, 'cover_big'),
        genres: (game.genres || []).map(g => g.name),
        platforms: (game.platforms || []).map(p => p.name)
      }));
      return send(res,200,{results, provider:'IGDB-v2'});
    }

    if(id){
      const body = `fields name,summary,storyline,first_release_date,cover.image_id,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,websites.url; where id = ${id}; limit 1;`;
      const games = await igdb('games', body, clientId, token);
      const game = games[0];
      if(!game) return send(res,404,{error:'Juego no encontrado en IGDB.'});

      const steamId = (game.websites || []).map(w => parseSteamAppId(w.url)).find(Boolean) || null;
      const steam = await steamDetails(steamId);
      const steamGridDbCover = await getSteamGridDbCover({
        apiKey: steamGridDbApiKey,
        steamId,
        gameName: game.name
      });
      const steamMin = stripHtml(steam?.pc_requirements?.minimum || '');
      const steamRec = stripHtml(steam?.pc_requirements?.recommended || '');
      const originalDescription = stripHtml(steam?.short_description || game.summary || game.storyline || '');

      const [description, reqMin, reqRec] = await translateToSpanish(
        [originalDescription, steamMin, steamRec],
        deeplApiKey
      );

      const developers = (game.involved_companies || []).filter(x => x.developer).map(x => x.company?.name).filter(Boolean);
      const publishers = (game.involved_companies || []).filter(x => x.publisher).map(x => x.company?.name).filter(Boolean);
      const genres = (game.genres || []).map(g => g.name);

      return send(res,200,{
        product:{
          name: game.name,
          category: 'Juego de PC',
          status: 'ok',
          legalBasis: 'propio',
          description,
          reqMin,
          reqRec,
          size: extractStorage(steamMin, steamRec),
          version: '',
          languages: normalizeLanguages(steam?.supported_languages || ''),
          tags: [...genres, ...developers, ...publishers].filter(Boolean).slice(0,10).join(', '),
          coverUrl: steamGridDbCover || coverUrl(game.cover?.image_id, 'cover_big') || steam?.header_image || '',
          released: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0,10) : '',
          source: [
            'IGDB',
            steam ? 'Steam' : '',
            deeplApiKey ? 'DeepL' : '',
            steamGridDbCover ? 'SteamGridDB' : ''
          ].filter(Boolean).join(' + ')
        }
      });
    }

    return send(res,400,{error:'Indicá q o id.'});
  }catch(error){
    console.error(error);
    return send(res,500,{error:`No se pudo consultar IGDB: ${error.message}`});
  }
};
