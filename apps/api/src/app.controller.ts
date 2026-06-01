import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Public liveness + readiness probe — no auth. Used by Better Uptime / k8s. */
  @Get("health")
  async getHealth() {
    return this.appService.getHealth();
  }
}
