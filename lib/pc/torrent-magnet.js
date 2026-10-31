// AREA 51 — Extrae el infohash SHA-1 de un archivo .torrent (bencode).
// No modifica el archivo ni inventa trackers. Limite defensivo: 4 MiB.
import { createHash } from 'node:crypto';

export function magnetFromTorrent(bytes, displayName = '') {
  const b = Buffer.from(bytes);
  if (!b.length || b.length > 4 * 1024 * 1024) throw new Error('Torrent fuera de limite');
  let at = 0, infoStart = -1, infoEnd = -1;
  function parse(depth = 0, root = false) {
    if (depth > 60 || at >= b.length) throw new Error('Bencode invalido');
    const marker = b[at];
    if (marker === 105) {
      at++;
      const end = b.indexOf(101, at);
      if (end < 0 || end - at > 30 || !/^-?(0|[1-9][0-9]*)$/.test(b.toString('ascii', at, end)))
        throw new Error('Entero invalido');
      at = end + 1; return;
    }
    if (marker === 108 || marker === 100) {
      const dict = marker === 100; at++;
      while (at < b.length && b[at] !== 101) {
        let key = null;
        if (dict) key = parseString();
        const start = at;
        parse(depth + 1);
        if (root && key === 'info') {
          if (infoStart >= 0) throw new Error('Info duplicado');
          infoStart = start; infoEnd = at;
        }
      }
      if (b[at++] !== 101) throw new Error('Coleccion invalida');
      return;
    }
    parseString();
  }
  function parseString() {
    const colon = b.indexOf(58, at);
    if (colon < 0 || colon - at > 12) throw new Error('Longitud invalida');
    const lenText = b.toString('ascii', at, colon);
    if (!/^(0|[1-9][0-9]*)$/.test(lenText)) throw new Error('Longitud invalida');
    const len = Number(lenText), start = colon + 1;
    if (!Number.isSafeInteger(len) || len > b.length - start) throw new Error('Cadena invalida');
    at = start + len;
    return len < 128 ? b.toString('utf8', start, at) : null;
  }
  if (b[0] !== 100) throw new Error('Torrent no es diccionario');
  parse(0, true);
  if (at !== b.length || infoStart < 0 || infoEnd <= infoStart) throw new Error('Infohash ausente');
  const hash = createHash('sha1').update(b.subarray(infoStart, infoEnd)).digest('hex');
  const name = String(displayName).replace(/\.torrent$/i, '').slice(0, 100);
  return 'magnet:?xt=urn:btih:' + hash + (name ? '&dn=' + encodeURIComponent(name) : '');
}
