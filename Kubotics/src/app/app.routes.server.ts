import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'automation/cnc-machine-tending',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'automation/invoice-processing',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'robotics/unitree-h2-test-day',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'automation/discovery',
    renderMode: RenderMode.Prerender,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
