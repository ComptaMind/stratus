import { Module } from "@nestjs/common";
import { FiscalClientsController } from "./fiscal-clients.controller";
import { FiscalClientsService } from "./fiscal-clients.service";

@Module({
  controllers: [FiscalClientsController],
  providers: [FiscalClientsService],
  exports: [FiscalClientsService],
})
export class FiscalClientsModule {}
