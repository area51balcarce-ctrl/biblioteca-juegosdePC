/**
 * AREA 51 - Importador universal de enlaces
 *
 * Uso:
 * POST /api/import-links
 * Content-Type: application/json
 *
 * Body:
 * {
 *   "url": "https://fuente-autorizada.com/pagina"
 * }
 *
 * Variable obligatoria en Vercel:
 * ALLOWED_IMPORT_HOSTS=fuente-autorizada.com,subdominio.fuente-autorizada.com
 *
 * Este endpoint solamente consulta dominios incluidos expresamente
 * en ALLOWED_IMPORT_HOSTS.
 */

const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function getAllowedHosts() {
  return String(process.env.ALLOWED_IMPORT_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function hostIsAllowed(hostname, allowedHosts) {
  const host = String(hostname || "").toLowerCase();

  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const base = allowed.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }

    return host === allowed;
  });
}

function isPrivateIp(address) {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;

    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

async function validatePublicHost(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });

  if (!records.length) {
    throw new Error("No se pudo resolver el dominio.");
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error("El dominio resuelve a una dirección privada o no permitida.");
    }
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCharCode(number) : _;
    });
}

function stripTags(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function providerFromUrl(urlValue) {
  try {
    const host = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");

    const knownProviders = [
      ["mega.nz", "Mega"],
      ["mediafire.com", "MediaFire"],
      ["terabox.com", "Terabox"],
      ["1024tera.com", "Terabox"],
      ["drive.google.com", "Google Drive"],
      ["docs.google.com", "Google Drive"],
      ["dropbox.com", "Dropbox"],
      ["onedrive.live.com", "OneDrive"],
      ["1fichier.com", "1Fichier"],
      ["pixeldrain.com", "Pixeldrain"],
      ["gofile.io", "GoFile"],
      ["rapidgator.net", "Rapidgator"],
      ["uploadgig.com", "UploadGig"],
      ["qiwi.gg", "Qiwi"],
      ["krakenfiles.com", "KrakenFiles"]
    ];

    const match = knownProviders.find(([domain]) => {
      return host === domain || host.endsWith(`.${domain}`);
    });

    if (match) {
      return match[1];
    }

    return host.split(".")[0]
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Enlace";
  } catch {
    return "Enlace";
  }
}

function normalizeCandidate(rawUrl, baseUrl) {
  try {
    const decoded = decodeHtmlEntities(rawUrl).trim();
    const parsed = new URL(decoded, baseUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractLinksFromHtml(html, sourceUrl) {
  const candidates = [];
  const anchorRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let anchorMatch;
  while ((anchorMatch = anchorRegex.exec(html)) !== null) {
    const href = anchorMatch[1] || anchorMatch[2] || anchorMatch[3] || "";
    const text = stripTags(anchorMatch[4] || "");

    candidates.push({
      url: href,
      label: text
    });
  }

  // También detecta URLs escritas directamente en el HTML o en JSON embebido.
  const rawUrlRegex = /https?:\/\/[^\s"'<>\\)]+/gi;
  const rawMatches = html.match(rawUrlRegex) || [];

  for (const rawUrl of rawMatches) {
    candidates.push({
      url: rawUrl,
      label: ""
    });
  }

  const source = new URL(sourceUrl);
  const seen = new Set();
  const links = [];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate.url, sourceUrl);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    const parsed = new URL(normalized);

    // Descarta enlaces de navegación vacíos y protocolos no válidos.
    if (
      normalized === source.toString() ||
      parsed.href.startsWith("javascript:") ||
      parsed.href.startsWith("mailto:") ||
      parsed.href.startsWith("tel:")
    ) {
      continue;
    }

    seen.add(normalized);

    links.push({
      url: normalized,
      label: candidate.label || ""
    });
  }

  return links;
}

function buildDownloads(links) {
  const providerCounters = new Map();

  return links.map((link, index) => {
    const provider = providerFromUrl(link.url);
    const currentCount = (providerCounters.get(provider) || 0) + 1;
    providerCounters.set(provider, currentCount);

    const cleanLabel = String(link.label || "").trim();
    const defaultLabel = `Parte ${currentCount}`;

    return {
      type: provider,
      group_name: provider,
      label: cleanLabel || defaultLabel,
      url: link.url,
      status: "active",
      position: index
    };
  });
}

async function readResponseTextLimited(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > MAX_HTML_BYTES) {
    throw new Error("La página supera el tamaño máximo permitido.");
  }

  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > MAX_HTML_BYTES) {
    throw new Error("La página supera el tamaño máximo permitido.");
  }

  return text;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      ok: false,
      error: "Método no permitido. Usá POST."
    });
    return;
  }

  const allowedHosts = getAllowedHosts();

  if (!allowedHosts.length) {
    sendJson(res, 500, {
      ok: false,
      error: "Falta configurar ALLOWED_IMPORT_HOSTS en Vercel."
    });
    return;
  }

  const body = typeof req.body === "string"
    ? (() => {
        try {
          return JSON.parse(req.body);
        } catch {
          return {};
        }
      })()
    : (req.body || {});

  const sourceUrl = String(body.url || body.sourceUrl || "").trim();

  if (!sourceUrl) {
    sendJson(res, 400, {
      ok: false,
      error: "Falta enviar la URL de origen."
    });
    return;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    sendJson(res, 400, {
      ok: false,
      error: "La URL enviada no es válida."
    });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    sendJson(res, 400, {
      ok: false,
      error: "Solo se permiten URLs HTTP o HTTPS."
    });
    return;
  }

  if (!hostIsAllowed(parsedUrl.hostname, allowedHosts)) {
    sendJson(res, 403, {
      ok: false,
      error: `El dominio ${parsedUrl.hostname} no está autorizado.`
    });
    return;
  }

  try {
    await validatePublicHost(parsedUrl.hostname);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;

    try {
      response = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "AREA51-LinkImporter/1.0",
          "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5"
        }
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      sendJson(res, 502, {
        ok: false,
        error: `La fuente respondió con estado ${response.status}.`
      });
      return;
    }

    const finalUrl = new URL(response.url);

    // Evita redirecciones hacia dominios que no estén autorizados.
    if (!hostIsAllowed(finalUrl.hostname, allowedHosts)) {
      sendJson(res, 403, {
        ok: false,
        error: `La fuente redirigió hacia un dominio no autorizado: ${finalUrl.hostname}.`
      });
      return;
    }

    await validatePublicHost(finalUrl.hostname);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const content = await readResponseTextLimited(response);

    let links = [];

    if (contentType.includes("application/json")) {
      try {
        const data = JSON.parse(content);
        const possibleDownloads = Array.isArray(data)
          ? data
          : Array.isArray(data.downloads)
            ? data.downloads
            : [];

        links = possibleDownloads
          .map((item) => {
            if (typeof item === "string") {
              return {
                url: normalizeCandidate(item, finalUrl.toString()),
                label: ""
              };
            }

            return {
              url: normalizeCandidate(item?.url || item?.href || "", finalUrl.toString()),
              label: String(item?.label || item?.name || item?.title || "")
            };
          })
          .filter((item) => item.url);
      } catch {
        links = extractLinksFromHtml(content, finalUrl.toString());
      }
    } else {
      links = extractLinksFromHtml(content, finalUrl.toString());
    }

    const downloads = buildDownloads(links);

    sendJson(res, 200, {
      ok: true,
      source_url: finalUrl.toString(),
      total: downloads.length,
      downloads
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";

    sendJson(res, isTimeout ? 504 : 500, {
      ok: false,
      error: isTimeout
        ? "La fuente tardó demasiado en responder."
        : (error?.message || "No se pudieron importar los enlaces.")
    });
  }
};
