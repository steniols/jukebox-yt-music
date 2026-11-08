const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const PLAYLIST_ID_PATTERN = /^[\w-]{2,100}$/;
const WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const PATH_PREFIXES = ["/shorts/", "/embed/", "/live/"];

// Aceita apenas links do YouTube e do YouTube Music, ou o próprio identificador.
function parseVideoId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  let candidate = null;

  if (host === "youtu.be") {
    candidate = url.pathname.slice(1);
  } else if (WATCH_HOSTS.has(host)) {
    if (url.pathname === "/watch") {
      candidate = url.searchParams.get("v");
    } else {
      const prefix = PATH_PREFIXES.find((p) => url.pathname.startsWith(p));
      if (prefix) candidate = url.pathname.slice(prefix.length).split("/")[0];
    }
  }

  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

// Aceita links de playlist ou de uma música tocando dentro de uma playlist.
function parsePlaylistId(input) {
  if (typeof input !== "string") return null;

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!WATCH_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.pathname !== "/playlist" && url.pathname !== "/watch") return null;

  const id = url.searchParams.get("list");
  return id && PLAYLIST_ID_PATTERN.test(id) ? id : null;
}

module.exports = { parseVideoId, parsePlaylistId };
