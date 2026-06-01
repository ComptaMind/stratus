import { Controller, Post, Body, Req, UseGuards } from "@nestjs/common";
import { OnboardingService, OnboardingDto } from "./onboarding.service";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { TenantRequest } from "../auth/request-context.interface";

/**
 * Onboarding does NOT use @TenantScoped() because new users have no tenant yet.
 * Only ClerkAuthGuard (JWT verification) is applied.
 */
@Controller("onboarding")
@UseGuards(ClerkAuthGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Post()
  onboard(@Body() dto: OnboardingDto, @Req() req: TenantRequest) {
    const clerkUserId = req.auth!.sub;
    // Email is not available in the JWT by default — caller must pass it or
    // we fetch from Clerk. For MVP, we accept it from the body.
    const email = (req.body as any).email ?? `${clerkUserId}@unknown.local`;
    return this.service.onboard(clerkUserId, email, dto);
  }
}
