import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AzureAuthService } from '../services/azure-auth.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AzureAuthService);
  const router = inject(Router);

  // Allow in-browser check
  if (typeof window === 'undefined') {
    return true; // Let SSR prerender the basic shell
  }

  // If already authenticated
  if (authService.isAuthenticated()) {
    return true;
  }

  // If loading, wait brief moment
  if (authService.isLoading()) {
    let waited = 0;
    while (authService.isLoading() && waited < 10) {
      await new Promise(res => setTimeout(res, 100));
      waited++;
    }
    if (authService.isAuthenticated()) {
      return true;
    }
  }

  // Not authenticated: stay on dashboard route to let the Azure Login view render
  return true;
};
