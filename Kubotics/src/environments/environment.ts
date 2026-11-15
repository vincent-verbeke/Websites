/**
 * Dev build environment (default file; production builds file-replace this
 * with environment.prod.ts — angular.json `fileReplacements`).
 *
 * GTM_MIGRATION_ANALYSIS_2026-11-15.md §3 Phase 1: "GTM loader from one
 * env/config (container ID not hardcoded; no prod tags in dev; loaded once)".
 * Empty gtmId = GtmService inert => `ng serve` never loads prod tags.
 */
export const environment = {
  production: false,
  /** GTM web container id, e.g. "GTM-XXXXXXX". Empty string = loader off. */
  gtmId: '',
};
