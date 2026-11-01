/** Extract a readable message from an HttpClient error (Phase 1 tabs).
 * HttpErrorResponse is NOT an Error instance — `String(e)` renders
 * "[object Object]" (caught by CDP 2026-10-13). Its `.message` already
 * carries the status line ("Http failure response for …"). */
export function httpErrorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
    const err = (e as { error?: unknown }).error;
    if (typeof err === 'string' && err) return err;
  }
  return String(e);
}
