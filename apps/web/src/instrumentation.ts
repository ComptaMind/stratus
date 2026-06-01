/**
 * Next.js instrumentation — runs once at server startup.
 * Initialises Sentry for server-side error tracking.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import(/* webpackIgnore: true */ "@sentry/nextjs");
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    });
  }
}

export const onRequestError = async (
  err: unknown,
  _request: Request,
  _context: unknown,
) => {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const { captureException } = await import(/* webpackIgnore: true */ "@sentry/nextjs");
    captureException(err);
  }
};
