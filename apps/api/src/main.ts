import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { TenantInterceptor } from "./auth/tenant.interceptor";

// Sentry must be initialised before anything else so it can instrument the app.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/node") as typeof import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version ?? "local",
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  });

  // Global interceptor: seeds AsyncLocalStorage with orgId for every request.
  // No-op for routes without a tenant (onboarding, health).
  app.useGlobalInterceptors(new TenantInterceptor());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Stratus API running on http://localhost:${port}`);
}

bootstrap();
