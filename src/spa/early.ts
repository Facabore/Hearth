/**
 * ADR 0004 (amended 2026-10-28): the profile and the spaces are read by a few lines the HTML carries, while the app's
 * script downloads, instead of after it runs. Every screen needs both before it paints, and on a slow network each
 * read waited a round trip of its own behind the script. The spaces are read only once the profile says someone is
 * signed in, so a visitor's screen asks for nothing the API would refuse.
 */
export const EARLY_READS = `(function(){try{var me=fetch("/api/v1/me",{credentials:"same-origin"});window.__hearthEarly={me:me,spaces:me.then(function(r){return r.ok?fetch("/api/v1/spaces",{credentials:"same-origin"}):null}).catch(function(){return null})}}catch(e){}})();`;

/**
 * The inline script that preloads the catalog of the language the app will pick (`visitorLocale`: the visitor cookie,
 * then the browser's languages in order, then Spanish), so it downloads beside the app's script; `files` maps each
 * language to its built chunk. A signed-in person's stored language, known only from the profile, may still differ.
 */
export const catalogPreload = (files: Readonly<Record<string, string>>): string =>
  `(function(){try{var f=${JSON.stringify(files)};var c=(document.cookie.match(/(?:^|; )hearth\\.locale=([a-z]+)/)||[])[1];var l=f[c]?c:null;var n=navigator.languages||[];for(var i=0;!l&&i<n.length;i++){var p=String(n[i]).toLowerCase().split("-")[0];if(f[p])l=p}var k=document.createElement("link");k.rel="modulepreload";k.crossOrigin="";k.href=f[l||"es"];document.head.appendChild(k)}catch(e){}})();`;

interface EarlyReads {
  readonly me: Promise<Response>;
  readonly spaces: Promise<Response | null>;
}

/** The reads the HTML started, handed over once: the first screen joins them, any later one reads the API itself. */
export const takeEarlyReads = (): EarlyReads | null => {
  const holder = globalThis as { __hearthEarly?: EarlyReads };
  const reads = holder.__hearthEarly ?? null;
  delete holder.__hearthEarly;
  return reads;
};

/** An early read as the generated client answers one: the body as `data`, or as `error` when the API refused. */
export const earlyResult = async <T>(
  pending: Promise<Response>,
): Promise<{ data?: T; error?: unknown; response: Response }> => {
  const response = await pending;
  const body: unknown = await response.json().catch(() => undefined);
  return response.ok ? { data: body as T, response } : { error: body, response };
};
