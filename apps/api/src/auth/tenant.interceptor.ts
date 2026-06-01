import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tenantStorage } from "../prisma/prisma.service";
import { TenantRequest } from "./request-context.interface";

/**
 * Wraps the request handler execution inside AsyncLocalStorage.run({ orgId }).
 * This allows PrismaService middleware to read orgId without prop-drilling.
 * Applied globally in main.ts — safe to run on all routes (no-op if orgId absent).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const orgId = req.orgId;

    // No orgId (unauthenticated or onboarding routes) → skip tenant context.
    if (!orgId) return next.handle();

    return new Observable((subscriber) => {
      tenantStorage.run({ orgId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
