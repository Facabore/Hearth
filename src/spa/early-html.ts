/**
 * ADR 0004 (amended 2026-10-28): the scripts the HTML carries, first in its head (`vite.spa.config.ts`). They start
 * what every screen needs before it paints while the app's script downloads, instead of after it runs: on a slow
 * network each of these reads waited a round trip of its own behind the script. Plain strings, so the build can
 * import them; the app takes the reads over in `early.ts`.
 *
 * The profile is read at once and the spaces once it says someone is signed in, so a visitor's screen asks for
 * nothing the API would refuse.
 */
export const EARLY_READS = `(function(){try{var me=fetch("/api/v1/me",{credentials:"same-origin"});window.__hearthEarly={me:me,spaces:me.then(function(r){return r.ok?fetch("/api/v1/spaces",{credentials:"same-origin"}):null}).catch(function(){return null})}}catch(e){}})();`;

/**
 * Preloads the catalog of the language the app will pick (`visitorLocale`: the visitor cookie, then the browser's
 * languages in order, then Spanish), so it downloads beside the app's script; `files` maps each language to its built
 * chunk. A signed-in person's stored language, known only from the profile, may still differ.
 */
export const catalogPreload = (files: Readonly<Record<string, string>>): string =>
  `(function(){try{var f=${JSON.stringify(files)};var has=function(x){return Object.prototype.hasOwnProperty.call(f,x)};var c=(document.cookie.match(/(?:^|; )hearth\\.locale=([a-z]+)/)||[])[1];var l=has(c)?c:null;var n=navigator.languages||[];for(var i=0;!l&&i<n.length;i++){var p=String(n[i]).toLowerCase().split("-")[0];if(has(p))l=p}var k=document.createElement("link");k.rel="modulepreload";k.crossOrigin="";k.href=f[l||"es"];document.head.appendChild(k)}catch(e){}})();`;
