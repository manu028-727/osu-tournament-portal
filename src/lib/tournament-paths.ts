const slug = '([a-z0-9]+(?:-[a-z0-9]+)*)';
const publicPath = new RegExp(`^/t/${slug}(/.*)?$`);
const legacyAdminPath = new RegExp(`^/admin/t/${slug}(/.*)?$`);

export const tournamentAdminBase = (value: string) => `/t/${value}/admin`;

export function scopedHref(
  href: string,
  scope: { slug: string; publicBase: string; adminBase: string },
) {
  if (
    !scope.slug ||
    !href.startsWith('/') ||
    href.startsWith('//') ||
    /^\/(?:api|t|tournaments|admin\/t|admin\/tournaments)(?:\/|$)/.test(href)
  )
    return href;
  if (/^\/admin(?:\/|$)/.test(href)) return href.replace(/^\/admin/, scope.adminBase);
  if (
    /^\/(?:mappools|teams|staff|rules|matches|schedule|brackets|register)(?:\/|\?|$)/.test(href) ||
    href === '/' ||
    href.startsWith('/?')
  )
    return scope.publicBase + (href === '/' ? '' : href);
  return href;
}

export function tournamentPath(pathname: string) {
  const legacy = legacyAdminPath.exec(pathname);
  const match = legacy || publicPath.exec(pathname);
  if (!match) return null;
  const path = legacy ? `/admin${match[2] || ''}` : match[2] || '/';
  return {
    slug: match[1],
    path,
    admin: path === '/admin' || path.startsWith('/admin/'),
    legacy: !!legacy,
  };
}
