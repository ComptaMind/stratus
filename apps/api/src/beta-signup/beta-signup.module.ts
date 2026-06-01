import { Module } from "@nestjs/common";
import { BetaSignupController } from "./beta-signup.controller";
import { BetaSignupService } from "./beta-signup.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [BetaSignupController],
  providers: [BetaSignupService],
})
export class BetaSignupModule {}
