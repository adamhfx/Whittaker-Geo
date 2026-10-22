/** Keep production sign-in and its cookies on the configured application origin. */
export function canonicalPageUrl(
  path: string,
  requestHost: string | null,
  appUrl: string | undefined,
  production: boolean,
): string | null {
  if (!production || !appUrl || !requestHost) return null;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) return null;
  let target: URL;
  try { target = new URL(appUrl); } catch { return null; }
  if (target.protocol !== "https:" || target.username || target.password) return null;
  if (requestHost.toLowerCase() === target.host.toLowerCase()) return null;
  const destination = new URL(path, target.origin);
  return destination.origin === target.origin ? destination.toString() : null;
}
