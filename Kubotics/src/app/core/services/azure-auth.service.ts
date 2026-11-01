import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PublicClientApplication, AccountInfo, InteractionRequiredAuthError } from '@azure/msal-browser';

// Microsoft Entra ID (Azure AD) Client Config for Kubotics Platform
export const MSAL_CONFIG = {
  auth: {
    clientId: '7246abc4-b1d9-47d7-b8be-2e791de2f407', // Kubotics App Registration
    authority: 'https://login.microsoftonline.com/aef12348-a49b-42b9-93e5-b8d23baaa54c', // Kuroliv tenant
    redirectUri: typeof window !== 'undefined' ? window.location.origin + '/dashboard' : 'https://kubotics.ch/dashboard',
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: true,
  }
};

@Injectable({
  providedIn: 'root'
})
export class AzureAuthService {
  private platformId = inject(PLATFORM_ID);
  private msalInstance: PublicClientApplication | null = null;
  
  isAuthenticated = signal<boolean>(false);
  currentAccount = signal<AccountInfo | null>(null);
  isLoading = signal<boolean>(true);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initMsal();
    } else {
      this.isLoading.set(false);
    }
  }

  private clearStaleInteractionState(): void {
    if (typeof window === 'undefined') return;
    try {
      // Clear any stuck MSAL interaction flags left over from previous attempts
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && (key.includes('interaction.status') || key.includes('msal.interaction'))) {
            storage.removeItem(key);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  private async initMsal(): Promise<void> {
    try {
      this.clearStaleInteractionState();
      this.msalInstance = new PublicClientApplication(MSAL_CONFIG);
      await this.msalInstance.initialize();

      const currentUrl = window.location.href;
      const isRedirectResponse = (currentUrl.includes('code=') || currentUrl.includes('error=')) && currentUrl.includes('state=');
      
      if (isRedirectResponse) {
        try {
          const response = await this.msalInstance.handleRedirectPromise();
          if (response && response.account) {
            this.msalInstance.setActiveAccount(response.account);
            this.currentAccount.set(response.account);
            this.isAuthenticated.set(true);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (redirectErr) {
          console.warn('[AzureAuth] Redirect promise handled with warning:', redirectErr);
        }
      } else {
        // Safe check for promise to ensure internal queue clears
        try {
          await this.msalInstance.handleRedirectPromise();
        } catch {
          // ignore when no redirect was pending
        }
      }

      // Check existing accounts in cache
      const accounts = this.msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        this.msalInstance.setActiveAccount(accounts[0]);
        this.currentAccount.set(accounts[0]);
        this.isAuthenticated.set(true);
      }
    } catch (err) {
      console.error('[AzureAuth] Initialization failed:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Android/iOS browsers turn popup windows into TABS, which breaks MSAL's
   * popup completion (opener/tab correlation): the user lands back on
   * /dashboard in a NEW tab that never receives the account — exactly the
   * "new tab, same content, not logged in" symptom Vincent saw on his
   * Android Chrome tablet (2026-11-01). Mobile browsers therefore use the
   * full-page redirect flow (single document — the proven
   * handleRedirectPromise path in initMsal picks the account up from
   * localStorage on return). Desktop keeps loginPopup unchanged.
   */
  private static isMobileBrowser(): boolean {
    return typeof navigator !== 'undefined'
      && /android|ipad|iphone|ipod|mobile/i.test(navigator.userAgent || '');
  }

  async login(): Promise<void> {
    if (!this.msalInstance) return;
    this.isLoading.set(true);
    this.clearStaleInteractionState();
    if (AzureAuthService.isMobileBrowser()) {
      // navigates away — initMsal() handles the redirect return
      await this.msalInstance.loginRedirect({
        scopes: ['User.Read', 'openid', 'profile', 'email'],
        redirectUri: window.location.origin + '/dashboard'
      });
      return;
    }
    try {
      const response = await this.msalInstance.loginPopup({
        scopes: ['User.Read', 'openid', 'profile', 'email'],
        redirectUri: window.location.origin + '/dashboard'
      });
      if (response && response.account) {
        this.msalInstance.setActiveAccount(response.account);
        this.currentAccount.set(response.account);
        this.isAuthenticated.set(true);
      }
    } catch (err: any) {
      console.warn('[AzureAuth] Popup login error:', err);
      if (err.errorCode === 'interaction_in_progress') {
        this.clearStaleInteractionState();
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  async logout(): Promise<void> {
    if (!this.msalInstance) return;
    const account = this.currentAccount();
    this.isAuthenticated.set(false);
    this.currentAccount.set(null);
    if (AzureAuthService.isMobileBrowser()) {
      await this.msalInstance.logoutRedirect({ account: account || undefined });
      return;
    }
    await this.msalInstance.logoutPopup({ account: account || undefined });
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.msalInstance) return null;
    const account = this.currentAccount();
    if (!account) return null;

    try {
      const tokenResponse = await this.msalInstance.acquireTokenSilent({
        scopes: ['User.Read'],
        account
      });
      return tokenResponse.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        const tokenResponse = await this.msalInstance.acquireTokenPopup({
          scopes: ['User.Read']
        });
        return tokenResponse.accessToken;
      }
      return null;
    }
  }
}
