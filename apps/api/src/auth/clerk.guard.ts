import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { verifyToken } from "@clerk/backend";
import { TenantRequest } from "./request-context.interface";

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY ?? "",
      });
      // Attach Clerk sub (clerkUserId) for TenantGuard to look up the DB user.
      request.auth = { sub: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired Clerk token");
    }
  }
}
