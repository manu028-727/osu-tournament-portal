const slug = '([a-z0-9]+(?:-[a-z0-9]+)*)';
const publicPath = new RegExp(`^/t/${slug}(/.*)?$`);
const legacyAdminPath = new RegExp(`^/admin/t/${slug}(/.*)?$`);

export const tournamentAdminBase = (value: string) => `/t/${value}/admin`;

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
