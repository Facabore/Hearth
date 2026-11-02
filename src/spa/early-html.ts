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

/** Ruling P276: the area catalogs' built chunks, `files[area][language]`, and the screens' areas (`routeAreas`). */
export interface AreaPreload {
  readonly files: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly routes: readonly (readonly [string, readonly string[]])[];
}

/**
 * Preloads the catalog of the language the app will pick (`visitorLocale`: the visitor cookie, then the browser's
 * languages in order, then Spanish), so it downloads beside the app's script; `files` maps each language to its built
 * chunk. A signed-in person's stored language, known only from the profile, may still differ. In the same language it
 * preloads the area catalogs of the screen the address names (ruling P276), the first of `areas.routes` that matches,
 * so the screen's loader finds them in instead of asking for them once the app runs.
 */
export const catalogPreload = (
  files: Readonly<Record<string, string>>,
  areas: AreaPreload = { files: {}, routes: [] },
): string =>
  `(function(){try{var f=${JSON.stringify(files)};var a=${JSON.stringify(areas.files)};var r=${JSON.stringify(areas.routes)};var own=function(o,x){return Object.prototype.hasOwnProperty.call(o,x)};var c=(document.cookie.match(/(?:^|; )hearth\\.locale=([a-z]+)/)||[])[1];var l=own(f,c)?c:null;var n=navigator.languages||[];for(var i=0;!l&&i<n.length;i++){var p=String(n[i]).toLowerCase().split("-")[0];if(own(f,p))l=p}l=l||"es";var add=function(h){var k=document.createElement("link");k.rel="modulepreload";k.crossOrigin="";k.href=h;document.head.appendChild(k)};add(f[l]);var s=location.pathname;for(var j=0;j<r.length;j++){if(new RegExp(r[j][0]).test(s)){for(var m=0;m<r[j][1].length;m++){var x=own(a,r[j][1][m])?a[r[j][1][m]]:null;if(x&&own(x,l))add(x[l])}return}}}catch(e){}})();`;
