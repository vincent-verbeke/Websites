import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomePageComponent)
  },
  {
    path: 'automation/cnc-machine-tending',
    loadComponent: () => import('./pages/cnc-machine-tending/cnc-machine-tending').then(m => m.CncMachineTendingPageComponent)
  },
  {
    path: 'automation/invoice-processing',
    loadComponent: () => import('./pages/invoice-processing/invoice-processing').then(m => m.InvoiceProcessingPageComponent)
  },
  {
    path: 'robotics/unitree-h2-test-day',
    loadComponent: () => import('./pages/unitree-h2-test-day/unitree-h2-test-day').then(m => m.UnitreeH2LandingPageComponent)
  },
  {
    path: 'automation/discovery',
    loadComponent: () => import('./pages/automation-discovery/automation-discovery').then(m => m.AutomationDiscoveryPageComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
