import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { FECParserService } from "./fec-parser.service";
import { FecParseProcessor, FEC_PARSE_QUEUE } from "./fec-parse.processor";

@Module({
  imports: [
    BullModule.registerQueue({ name: FEC_PARSE_QUEUE }),
  ],
  providers: [FECParserService, FecParseProcessor],
  exports: [FECParserService, BullModule],
})
export class FecModule {}
