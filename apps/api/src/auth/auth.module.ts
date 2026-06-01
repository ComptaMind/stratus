import { Global, Module } from "@nestjs/common";
import { ClerkAuthGuard } from "./clerk.guard";
import { TenantGuard } from "./tenant.guard";
import { TenantInterceptor } from "./tenant.interceptor";

@Global()
@Module({
  providers: [ClerkAuthGuard, TenantGuard, TenantInterceptor],
  exports: [ClerkAuthGuard, TenantGuard, TenantInterceptor],
})
export class AuthModule {}
