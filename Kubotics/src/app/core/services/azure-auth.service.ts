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
  /** True while the browser is being handed over to Microsoft (full-page
   * login/logout redirect) — drives the button's "Opening Microsoft…" state. */
  isRedirecting = signal<boolean>(false);
  /** Set only when a sign-in attempt did NOT leave the page (or the redirect
   * return failed). Rendered next to the sign-in button — a dead click must
   * never be silent again (Vincent 2026-11-10: "clicking does not do anything"). */
  loginError = signal<string | null>(null);

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
      // NOTE: interaction state is deliberately NOT cleared here. On the RETURN
      // leg from Microsoft the URL carries `#code=…&state=…`, and
      // `msal.interaction.status` (written by loginRedirect into this tab's
      // sessionStorage) is exactly what handleRedirectPromise() checks first.
      // Clearing it before handling made MSAL treat the callback as stale: it
      // wiped the fragment itself (→ clean address bar) and returned null (→
      // the code was never exchanged, the account never cached) — Vincent's
      // phone kept landing on "Access Restricted" with no error, over and over
      // (regression pin in azure-auth.service.spec.ts, 2026-11-11). The safe
      // place to clear is login(), before STARTING a new flow.
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
          } else if (this.msalInstance.getAllAccounts().length === 0) {
            // The callback was consumed (MSAL clears the fragment itself) but
            // no session was established — e.g. the tab's sessionStorage did
            // not survive the hop to Microsoft. A dead "Access Restricted"
            // screen with no reason is exactly what Vincent kept hitting, so
            // surface it and offer the retry.
            this.loginError.set(
              'Microsoft sign-in did not complete'
              + ' — tap "Sign in with Microsoft 365" to try again.');
          }
        } catch (redirectErr: any) {
          console.warn('[AzureAuth] Redirect promise handled with warning:', redirectErr);
          // The return leg failed (stale/pending state, blocked exchange, …).
          // Clear the stuck flags so the NEXT tap starts a clean flow, and tell
          // the user why — previously this was a console-only warning, which
          // left a working-looking "Sign in" button that did nothing on retry.
          this.clearStaleInteractionState();
          this.loginError.set(
            'Microsoft sign-in did not complete'
            + (redirectErr?.errorCode ? ` (${redirectErr.errorCode})` : '')
            + '. Tap "Sign in" to try again.');
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
      // A broken init must not leave a dead Sign-in button (work order 91a5a14:
      // "loginError is only rendered in the hero — init-path failures swallow
      // to console"). login() no-ops when MSAL failed to boot, so say it here.
      this.loginError.set('Sign-in is unavailable — reload the page and try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Sign-in is ALWAYS a full-page redirect — no popup, on any device
   * (2026-11-10, regression of the 2026-11-01 Android fix).
   *
   * Why the platform sniff is gone: `loginPopup` on Android/Chrome (and on any
   * browser whose user agent does not match, e.g. Chrome's "Desktop site" mode
   * on his tablet) turns the popup into a TAB, so MSAL's opener/tab correlation
   * never completes: the user lands on /dashboard in a NEW tab that still shows
   * the sign-in button, and every further tap either opened yet another tab or
   * died on `interaction_in_progress` in the console only. A redirect cannot
   * open a window, so it behaves identically on desktop, Android, in-app
   * browsers and installed shortcuts — and it does not depend on UA sniffing.
   * initMsal()'s handleRedirectPromise picks the account up on return.
   */
  async login(): Promise<void> {
    if (!this.msalInstance || this.isRedirecting() || this.isLoading()) return;
    this.loginError.set(null);
    this.isRedirecting.set(true);
    this.clearStaleInteractionState();
    try {
      await this.msalInstance.loginRedirect({
        scopes: ['User.Read', 'openid', 'profile', 'email'],
        redirectUri: window.location.origin + '/dashboard'
      });
      // loginRedirect() resolves once navigation is *requested*. If the browser
      // never leaves the page (blocked navigation, in-app browser quirks), give
      // the button back with a reason instead of freezing it as a dead control.
      window.setTimeout(() => {
        // The sign-in response arrives in the #fragment (MSAL's default
        // response_mode is fragment), never in location.search — check href.
        if (!this.isAuthenticated() && !window.location.href.includes('code=')) {
          this.isRedirecting.set(false);
          this.loginError.set('Sign-in did not start — tap "Sign in with Microsoft 365" to retry.');
        }
      }, 4000);
    } catch (err: any) {
      console.warn('[AzureAuth] Redirect login error:', err);
      this.isRedirecting.set(false);
      this.loginError.set(
        'Sign-in could not start'
        + (err?.errorCode ? ` (${err.errorCode})` : '')
        + ' — tap "Sign in with Microsoft 365" to retry.');
    }
  }

  /** Sign-out is also a full-page redirect: same no-window rule as login()
   * (logoutPopup has the identical Android-tab problem). MSAL defaults
   * post_logout_redirect_uri to the current page (/dashboard), exactly as the
   * old mobile branch did. */
  async logout(): Promise<void> {
    if (!this.msalInstance) return;
    const account = this.currentAccount();
    this.isAuthenticated.set(false);
    this.currentAccount.set(null);
    this.isRedirecting.set(true);
    try {
      await this.msalInstance.logoutRedirect({ account: account || undefined });
    } catch (err) {
      console.warn('[AzureAuth] Redirect logout error:', err);
      this.isRedirecting.set(false);
      // Local state is already cleared above — the device is signed out either way.
    }
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
        // Redirect, never popup: the popup path is broken on Android (see login()).
        // acquireTokenRedirect() returns void — the browser is on its way to
        // Microsoft; the result is persisted into the MSAL cache on the redirect
        // return, so the NEXT silent call succeeds. This attempt returns null.
        await this.msalInstance.acquireTokenRedirect({
          scopes: ['User.Read']
        });
        return null;
      }
      return null;
    }
  }
}
