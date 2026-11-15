import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { AnalyticsService } from './core/services/analytics.service';
import { GtmService } from './core/services/gtm.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideClientHydration(),
    // GTM Phase 1 (GTM_MIGRATION_ANALYSIS_2026-11-15.md §3): load the web
    // container once (browser only; EMPTY environment.gtmId = inert no-op)
    // and start SPA page_view tracking with URL dedupe. Runs on server
    // render too — both services guard on `typeof window`.
    provideAppInitializer(() => {
      inject(GtmService).init();
      inject(AnalyticsService).initRouterTracking();
    }),
  ],
};
