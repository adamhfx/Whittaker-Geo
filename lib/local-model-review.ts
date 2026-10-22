const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
}

export function isLoopbackEngineUrl(configured: string | undefined): boolean {
  if (!configured) return false;
  try {
    const url = new URL(configured);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

export function canUseLocalModelReview(options: {
  nodeEnv: string | undefined;
  enabled: string | undefined;
  requestUrl: string;
  host: string | null;
  origin: string | null;
}): boolean {
  if (
    options.nodeEnv !== "development" ||
    options.enabled !== "true" ||
    !options.host ||
    !options.origin
  ) {
    return false;
  }

  try {
    const requestUrl = new URL(options.requestUrl);
    const hostUrl = new URL(`${requestUrl.protocol}//${options.host}`);
    const origin = new URL(options.origin);
    if (
      !["http:", "https:"].includes(requestUrl.protocol) ||
      hostUrl.protocol !== requestUrl.protocol ||
      !["http:", "https:"].includes(origin.protocol) ||
      hostUrl.username ||
      hostUrl.password ||
      hostUrl.pathname !== "/" ||
      hostUrl.search ||
      hostUrl.hash
    ) {
      return false;
    }
    return (
      !requestUrl.username &&
      !requestUrl.password &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      origin.origin === options.origin &&
      isLoopbackHostname(requestUrl.hostname) &&
      isLoopbackHostname(hostUrl.hostname) &&
      hostUrl.port === requestUrl.port &&
      isLoopbackHostname(origin.hostname) &&
      origin.origin === hostUrl.origin
    );
  } catch {
    return false;
  }
}
