/**
 * Production build environment (swapped in via angular.json fileReplacements
 * for `ng build` / the deploy-frontend pipeline).
 *
 * ONE place for the GTM container id (readiness doc §3 row 3: "frontend build
 * config (one env, not hardcoded)"). Vincent creates the GTM container(s) ->
 * paste the id here -> GtmService loads gtm.js once in the browser. Empty
 * string keeps the loader inert, which is also the documented rollback lever
 * (analysis §5 deliverable 9: "container ID off => service inert").
 */
export const environment = {
  production: true,
  /** GTM web container id, e.g. "GTM-XXXXXXX". Empty string = loader off. */
  gtmId: '',
};
