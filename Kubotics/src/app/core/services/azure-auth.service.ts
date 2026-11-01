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

  private async initMsal(): Promise<void> {
    try {
      this.msalInstance = new PublicClientApplication(MSAL_CONFIG);
      await this.msalInstance.initialize();

      // Only attempt to process redirect promise if the URL hash/query contains MSAL response parameters (code, error, state)
      // and NOT an internal popup response
      const currentUrl = window.location.href;
      const isRedirectResponse = (currentUrl.includes('code=') || currentUrl.includes('error=')) && currentUrl.includes('state=');
      
      if (isRedirectResponse) {
        try {
          const response = await this.msalInstance.handleRedirectPromise();
          if (response && response.account) {
            this.msalInstance.setActiveAccount(response.account);
            this.currentAccount.set(response.account);
            this.isAuthenticated.set(true);
            // Clean up hash/query parameters from URL bar
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (redirectErr) {
          console.warn('[AzureAuth] Redirect promise handled with warning:', redirectErr);
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

  async login(): Promise<void> {
    if (!this.msalInstance) return;
    this.isLoading.set(true);
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
      // Only fallback to redirect if popup was explicitly blocked by browser
      if (err.errorCode === 'popup_window_error' || err.message?.includes('popup')) {
        await this.msalInstance.loginRedirect({
          scopes: ['User.Read', 'openid', 'profile', 'email'],
          redirectUri: window.location.origin + '/dashboard'
        });
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
