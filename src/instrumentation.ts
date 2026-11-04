/** Next.js calls this once when the server starts. */
export async function register(): Promise<void> {
  // Imported here, so the edge runtime never tries to load the database or file system code.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const [{ getAppContext }, { startRetentionSchedule }, { createLogger }] = await Promise.all([
    import('./server/app-context'),
    import('./server/retention/retention-job'),
    import('./lib/logger'),
  ]);

  try {
    startRetentionSchedule(await getAppContext());
  } catch (error) {
    // Bad configuration shouldn't stop the server starting. API routes report it as a 500, and
    // the message names only the missing settings. Its text isn't logged, by the logger's rule.
    createLogger().error('server.startup_failed', { error });
  }
}
