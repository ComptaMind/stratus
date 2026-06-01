import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { StorageModule } from "./storage/storage.module";
import { FecModule } from "./fec/fec.module";
import { FiscalClientsModule } from "./fiscal-clients/fiscal-clients.module";
import { FecImportsModule } from "./fec-imports/fec-imports.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { BetaSignupModule } from "./beta-signup/beta-signup.module";

@Module({
  imports: [
    // BullMQ root — reads REDIS_URL env var
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    }),
    PrismaModule,    // @Global — PrismaService available everywhere
    AuthModule,      // @Global — ClerkAuthGuard, TenantGuard, TenantInterceptor
    AuditModule,     // @Global — AuditService available everywhere
    StorageModule,   // @Global — StorageService available everywhere
    FecModule,       // FECParserService + BullMQ worker
    FiscalClientsModule,
    FecImportsModule,
    OnboardingModule,
    BetaSignupModule,  // Public — no auth guard
  ],
  controllers: [AppController],
  providers: [AppService],  // AppService injects PrismaService (global)
})
export class AppModule {}
