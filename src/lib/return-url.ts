export function safeReturnTo(value: string | null | undefined) {
  if (!value || value.length > 2048 || !value.startsWith('/') || /[\\\x00-\x20]/.test(value))
    return '/';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (
      url.origin !== 'https://return.invalid' ||
      !/^(?:\/t\/[a-z0-9-]+)?\/(?:mappools(?:\/[a-z0-9-]+)?|teams(?:\/[a-z0-9-]+)?|matches(?:\/[a-zA-Z0-9-]+)?|staff|rules|tournaments)?$|^\/t\/[a-z0-9-]+(?:\/admin(?:\/[a-zA-Z0-9-]+)*)?$|^\/admin\/tournaments$/.test(
        url.pathname,
      )
    )
      return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
