import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TenantRequest } from "./request-context.interface";

/**
 * Must run after ClerkAuthGuard (which sets request.auth.sub).
 * Loads the DB User + orgId and attaches them to the request.
 * If the user has no record yet, they must complete onboarding first.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const clerkUserId = req.auth?.sub;

    if (!clerkUserId) {
      throw new UnauthorizedException("No Clerk user ID on request");
    }

    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new UnauthorizedException(
        "User not provisioned — please complete onboarding at /onboarding"
      );
    }

    req.tenantUser = user;
    req.orgId = user.orgId;

    return true;
  }
}
