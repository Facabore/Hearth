/**
 * ADR 0004 (amended 2026-10-28): the scripts the HTML carries, first in its head (`vite.spa.config.ts`). They start
 * what every screen needs before it paints while the app's script downloads, instead of after it runs: on a slow
 * network each of these reads waited a round trip of its own behind the script. Plain strings, so the build can
 * import them; the app takes the reads over in `early.ts`.
 *
 * The profile is read at once; then the spaces when it says someone is signed in, or the sign-up mode the sign-in
 * screen shows when it says nobody is. A visitor's screen asks for nothing the API would refuse.
 */
export const EARLY_READS = `(function(){try{var o={credentials:"same-origin"};var me=fetch("/api/v1/me",o);var then=function(when,url){return me.then(function(r){return when(r)?fetch(url,o):null}).catch(function(){return null})};window.__hearthEarly={me:me,spaces:then(function(r){return r.ok},"/api/v1/spaces"),signUp:then(function(r){return r.status===401},"/api/v1/auth/sign-up")}}catch(e){}})();`;

/**
 * Preloads the catalog of the language the app will pick (`visitorLocale`: the visitor cookie, then the browser's
 * languages in order, then Spanish), so it downloads beside the app's script; `files` maps each language to its built
 * chunk. A signed-in person's stored language, known only from the profile, may still differ.
 */
export const catalogPreload = (files: Readonly<Record<string, string>>): string =>
  `(function(){try{var f=${JSON.stringify(files)};var has=function(x){return Object.prototype.hasOwnProperty.call(f,x)};var c=(document.cookie.match(/(?:^|; )hearth\\.locale=([a-z]+)/)||[])[1];var l=has(c)?c:null;var n=navigator.languages||[];for(var i=0;!l&&i<n.length;i++){var p=String(n[i]).toLowerCase().split("-")[0];if(has(p))l=p}var k=document.createElement("link");k.rel="modulepreload";k.crossOrigin="";k.href=f[l||"es"];document.head.appendChild(k)}catch(e){}})();`;
