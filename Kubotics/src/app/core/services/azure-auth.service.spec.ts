import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AzureAuthService } from './azure-auth.service';

/**
 * Regression suite for Vincent's 2026-11-10 report: on his Android phone the
 * "Sign in with Microsoft 365" button opened ANOTHER TAB showing the same
 * button, and tapping there did nothing.
 *
 * Root cause: sign-in picked MSAL's popup flow whenever the user agent did not
 * match the mobile sniff, and Android/Chrome (and desktop-mode UAs) turn that
 * popup into a tab that never completes MSAL's opener correlation — the retry
 * then died silently on `interaction_in_progress`. The contract pinned here:
 * sign-in/sign-out NEVER open a window, and a failed attempt is never silent.
 */
function fakeMsal(overrides: Record<string, unknown> = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    loginPopup: vi.fn().mockResolvedValue({ account: null }),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
    logoutPopup: vi.fn().mockResolvedValue(undefined),
    acquireTokenSilent: vi.fn(),
    acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function ready(svc: AzureAuthService): Promise<void> {
  // login() refuses to run before MSAL finished booting (isLoading guard).
  for (let i = 0; i < 100 && svc.isLoading(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function attach(svc: AzureAuthService, fake: unknown): void {
  (svc as unknown as { msalInstance: unknown }).msalInstance = fake;
}

describe('AzureAuthService sign-in contract', () => {
  it('logs in with a full-page redirect and never opens a window', async () => {
    const svc = TestBed.inject(AzureAuthService);
    await ready(svc);
    const fake = fakeMsal();
    attach(svc, fake);

    await svc.login();

    expect(fake.loginRedirect).toHaveBeenCalledTimes(1);
    expect(fake.loginPopup).not.toHaveBeenCalled();
    const request = fake.loginRedirect.mock.calls[0][0] as { redirectUri: string };
    expect(request.redirectUri).toBe(window.location.origin + '/dashboard');
    expect(svc.loginError()).toBeNull();
  });

  it('surfaces a failed attempt instead of leaving a dead button', async () => {
    const svc = TestBed.inject(AzureAuthService);
    await ready(svc);
    const failure = Object.assign(new Error('navigation blocked'), {
      errorCode: 'interaction_in_progress',
    });
    const fake = fakeMsal({
      loginRedirect: vi.fn().mockRejectedValue(failure),
    });
    attach(svc, fake);

    await svc.login();

    expect(svc.loginError()).toContain('Sign-in could not start');
    expect(svc.loginError()).toContain('interaction_in_progress');
    expect(svc.isRedirecting()).toBe(false); // retry must be possible at once
    expect(fake.loginPopup).not.toHaveBeenCalled();
  });

  it('a second tap starts a fresh flow (stale interaction state is cleared)', async () => {
    const svc = TestBed.inject(AzureAuthService);
    await ready(svc);
    sessionStorage.setItem('msal.interaction.status', 'in_progress');
    const fake = fakeMsal();
    attach(svc, fake);

    await svc.login();

    expect(sessionStorage.getItem('msal.interaction.status')).toBeNull();
    expect(fake.loginRedirect).toHaveBeenCalledTimes(1);
  });

  it('signs out with a redirect too (logoutPopup is equally broken on Android)', async () => {
    const svc = TestBed.inject(AzureAuthService);
    await ready(svc);
    const fake = fakeMsal();
    attach(svc, fake);

    await svc.logout();

    expect(fake.logoutRedirect).toHaveBeenCalledTimes(1);
    expect(fake.logoutPopup).not.toHaveBeenCalled();
    expect(svc.isAuthenticated()).toBe(false);
  });
});
