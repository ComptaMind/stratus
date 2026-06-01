import { Request } from "express";
import { User } from "@prisma/client";

export interface TenantRequest extends Request {
  /** Populated by ClerkAuthGuard: contains the Clerk JWT sub (clerkUserId). */
  auth?: { sub: string };

  /** Populated by TenantGuard: the DB User record for the authenticated user. */
  tenantUser?: User;

  /** Shorthand for tenantUser.orgId — injected by TenantGuard. */
  orgId?: string;
}
