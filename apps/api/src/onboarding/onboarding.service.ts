import { Injectable, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createClerkClient } from "@clerk/backend";

export class OnboardingDto {
  orgName: string;
  country?: string;
  vatRegimeDefault?: string;
  siret?: string;
  siren?: string;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async onboard(clerkUserId: string, email: string, dto: OnboardingDto) {
    // Idempotent: if user already has an org, return existing.
    const existingUser = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: { org: true },
    });

    if (existingUser) {
      return { user: existingUser, organization: existingUser.org, alreadyOnboarded: true };
    }

    // Create Organization + User in a transaction.
    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          clerkOrgId: `clerk_${clerkUserId}`, // personal org tied to this user
          name: dto.orgName,
          countryDefault: dto.country ?? "FR",
          vatRegimeDefault: dto.vatRegimeDefault ?? null,
          siret: dto.siret ?? null,
          siren: dto.siren ?? null,
        },
      });

      const user = await tx.user.create({
        data: {
          clerkUserId,
          email,
          orgId: org.id,
        },
      });

      return { user, organization: org };
    });

    // Persist orgId in Clerk publicMetadata so the frontend can read it.
    try {
      const clerk = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY ?? "",
      });
      await clerk.users.updateUser(clerkUserId, {
        publicMetadata: { stratusOrgId: organization.id },
      });
    } catch {
      // Non-fatal: metadata sync failure doesn't block onboarding.
    }

    return { user, organization, alreadyOnboarded: false };
  }
}
