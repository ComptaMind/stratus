import { Injectable, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateBetaSignupDto {
  email: string;
  name: string;
  firmName?: string;
  country?: string;
}

@Injectable()
export class BetaSignupService {
  private readonly logger = new Logger(BetaSignupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBetaSignupDto) {
    const existing = await this.prisma.betaSignup.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException("Email already registered for beta");
    }

    const signup = await this.prisma.betaSignup.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name.trim(),
        firmName: dto.firmName?.trim() ?? null,
        country: dto.country ?? "FR",
      },
    });

    // Send confirmation email via Resend (fire-and-forget — never block signup)
    this.sendConfirmationEmail(signup.email, signup.name).catch((err) => {
      this.logger.warn(`Resend email failed for ${signup.email}: ${String(err)}`);
    });

    return { id: signup.id, email: signup.email };
  }

  private async sendConfirmationEmail(email: string, name: string) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn("RESEND_API_KEY not set — skipping confirmation email");
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Stratus <hello@stratus.finance>",
        to: email,
        reply_to: "ac@stratus.finance",
        subject: "You're on the Stratus private beta list",
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <div style="background:#0E1116;padding:32px 40px;border-radius:12px 12px 0 0;">
    <p style="color:#FF5A4E;font-weight:700;font-size:20px;margin:0;">⚡ Stratus</p>
  </div>
  <div style="background:#fff;padding:40px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;">
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Hi ${name}, you're in.</h1>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
      Thank you for signing up for the <strong>Stratus private beta</strong> — the AI fiscal agent for French VAT compliance.
    </p>
    <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
      We're launching in <strong>September 2026</strong>. As a beta user, you'll get:
    </p>
    <ul style="color:#374151;line-height:2;padding-left:20px;margin:0 0 24px;">
      <li>6 months free at your plan tier</li>
      <li>Priority onboarding with our team</li>
      <li>Direct input on the product roadmap</li>
    </ul>
    <p style="color:#374151;line-height:1.6;margin:0 0 32px;">
      We'll reach out personally before launch. In the meantime, explore how our audit trail works:
    </p>
    <a href="https://stratus.finance/audit-by-design"
       style="background:#FF5A4E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
      See Audit by Design →
    </a>
    <p style="margin:32px 0 0;color:#9ca3af;font-size:13px;">
      — Anne-Carla Kamgang, Founder &amp; CEO<br/>
      <a href="mailto:ac@stratus.finance" style="color:#9ca3af;">ac@stratus.finance</a>
    </p>
  </div>
</div>`,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Resend ${res.status}: ${text}`);
    }

    // Mark email as sent
    await this.prisma.betaSignup.update({
      where: { email },
      data: { emailSentAt: new Date() },
    });
  }
}
