import { Controller, Post, Body, HttpCode, HttpStatus, ConflictException } from "@nestjs/common";
import { BetaSignupService, type CreateBetaSignupDto } from "./beta-signup.service";

@Controller("v1/beta-signups")
export class BetaSignupController {
  constructor(private readonly service: BetaSignupService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateBetaSignupDto) {
    return this.service.create(body);
  }
}
