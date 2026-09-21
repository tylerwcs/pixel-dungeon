export function resolveStaticRoute(pathname, assets) {
  if (pathname === "/") return { pathname: "/index.html" };

  if (assets[pathname]) return { pathname };

  if (pathname.endsWith("/")) {
    const indexPath = `${pathname}index.html`;
    return assets[indexPath] ? { pathname: indexPath } : null;
  }

  const indexPath = `${pathname}/index.html`;
  return assets[indexPath] ? { redirect: `${pathname}/` } : null;
}
