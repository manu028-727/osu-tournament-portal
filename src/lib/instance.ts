export function assertInstanceDatabase(value: string | undefined) {
  if (!value) throw new Error('Configure DATABASE_URL for this installation.');
  const database = decodeURIComponent(new URL(value).pathname.slice(1));
  const configured = process.env.APP_DATABASE_NAME || 'tournament_platform';
  if (!database || ![configured, 'tournament_platform_test'].includes(database))
    throw new Error(
      'Database name does not match APP_DATABASE_NAME. Configure a dedicated installation database explicitly.',
    );
}
export function assertTestDatabase(value: string | undefined) {
  if (!value || new URL(value).pathname !== '/tournament_platform_test')
    throw new Error('Automated tests require the isolated tournament_platform_test database.');
}
