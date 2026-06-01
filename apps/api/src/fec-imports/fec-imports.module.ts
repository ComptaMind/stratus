import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { FecImportsController } from "./fec-imports.controller";
import { FecImportsService } from "./fec-imports.service";
import { FEC_PARSE_QUEUE } from "../fec/fec-parse.processor";
import { FEC_VAT_CLASSIFY_QUEUE, FecVatClassifyProcessor } from "../fec/fec-vat-classify.processor";

@Module({
  imports: [
    BullModule.registerQueue({ name: FEC_PARSE_QUEUE }),
    BullModule.registerQueue({ name: FEC_VAT_CLASSIFY_QUEUE }),
  ],
  controllers: [FecImportsController],
  providers: [FecImportsService, FecVatClassifyProcessor],
  exports: [FecImportsService],
})
export class FecImportsModule {}
