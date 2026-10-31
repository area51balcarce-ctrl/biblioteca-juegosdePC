// AREA 51 — Magnet desde torrent bencode, con trackers originales.
// Archivo privado: no cambia el almacenamiento ni las entregas existentes.
import { createHash } from 'node:crypto';

export function magnetFromTorrent(bytes, displayName = '') {
  const b = Buffer.from(bytes);
  if (!b.length || b.length > 4 * 1024 * 1024) throw new Error('Torrent fuera de limite');
  let at = 0, infoStart = -1, infoEnd = -1;
  const trackers = [];
  const addTracker = value => {
    if (typeof value !== 'string' || value.length > 2048 || trackers.length >= 30) return;
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:', 'udp:'].includes(url.protocol)) return;
      if (!url.hostname || url.username || url.password) return;
      if (!trackers.includes(value.trim())) trackers.push(value.trim());
    } catch (_) { /* Tracker invalido: ignorar */ }
  };
  function parseString() {
    const colon = b.indexOf(58, at);
    if (colon < 0 || colon - at > 12) throw new Error('Longitud invalida');
    const text = b.toString('ascii', at, colon);
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('Longitud invalida');
    const length = Number(text), start = colon + 1;
    if (!Number.isSafeInteger(length) || length > b.length - start) throw new Error('Cadena invalida');
    at = start + length;
    return length <= 2048 ? b.toString('utf8', start, at) : null;
  }
  function parse(depth = 0, root = false, collect = false) {
    if (depth > 60 || at >= b.length) throw new Error('Bencode invalido');
    const marker = b[at];
    if (marker === 105) {
      at++;
      const end = b.indexOf(101, at);
      if (end < 0 || end - at > 30 || !/^-?(0|[1-9][0-9]*)$/.test(b.toString('ascii', at, end)))
        throw new Error('Entero invalido');
      at = end + 1; return null;
    }
    if (marker === 108) {
      at++;
      const result = [];
      while (at < b.length && b[at] !== 101) {
        const value = parse(depth + 1, false, collect);
        if (collect && result.length < 60) result.push(value);
      }
      if (b[at++] !== 101) throw new Error('Lista invalida');
      return collect ? result : null;
    }
    if (marker === 100) {
      at++;
      while (at < b.length && b[at] !== 101) {
        const key = parseString(), start = at;
        const wantsTrackers = root && (key === 'announce' || key === 'announce-list');
        const value = parse(depth + 1, false, wantsTrackers);
        if (root && key === 'info') {
          if (infoStart >= 0) throw new Error('Info duplicado');
          infoStart = start; infoEnd = at;
        }
        if (wantsTrackers) {
          const walk = (v, depth = 0) => {
            if (depth > 4 || trackers.length >= 30) return;
            if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
            else addTracker(v);
          };
          walk(value);
        }
      }
      if (b[at++] !== 101) throw new Error('Diccionario invalido');
      return null;
    }
    return parseString();
  }
  if (b[0] !== 100) throw new Error('Torrent no es diccionario');
  parse(0, true);
  if (at !== b.length || infoStart < 0 || infoEnd <= infoStart) throw new Error('Infohash ausente');
  const hash = createHash('sha1').update(b.subarray(infoStart, infoEnd)).digest('hex');
  const name = String(displayName).replace(/\.torrent$/i, '').slice(0, 100);
  return 'magnet:?xt=urn:btih:' + hash +
    (name ? '&dn=' + encodeURIComponent(name) : '') +
    trackers.map(url => '&tr=' + encodeURIComponent(url)).join('');
}
