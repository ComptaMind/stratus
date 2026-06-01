import { Injectable, Logger } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";

const LOCAL_UPLOAD_DIR = "/tmp/stratus-uploads";

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: "s3" | "local";
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly baseUrl?: string;

  constructor() {
    const accessKey = process.env.SCW_ACCESS_KEY;
    const secretKey = process.env.SCW_SECRET_KEY;
    this.bucket = process.env.SCW_BUCKET_NAME;
    const endpoint =
      process.env.SCW_ENDPOINT_URL ?? "https://s3.fr-par.scw.cloud";
    const region = process.env.SCW_REGION ?? "fr-par";

    if (accessKey && secretKey && this.bucket) {
      this.driver = "s3";
      this.s3 = new S3Client({
        region,
        endpoint,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        forcePathStyle: true,
      });
      this.baseUrl = `${endpoint}/${this.bucket}`;
      this.logger.log("Storage driver: Scaleway S3");
    } else {
      this.driver = "local";
      fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
      this.logger.warn(
        "SCW credentials not set — using local storage at " + LOCAL_UPLOAD_DIR
      );
    }
  }

  async upload(
    key: string,
    buffer: Buffer,
    contentType = "text/plain"
  ): Promise<string> {
    if (this.driver === "s3") {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket!,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );
      return `${this.baseUrl}/${key}`;
    }

    // Local fallback
    const filePath = path.join(LOCAL_UPLOAD_DIR, key.replace(/\//g, "_"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return `local://${filePath}`;
  }

  async download(fileUrl: string): Promise<Buffer> {
    if (fileUrl.startsWith("local://")) {
      return fs.readFileSync(fileUrl.replace("local://", ""));
    }

    // S3 download
    const url = new URL(fileUrl);
    const key = url.pathname.replace(`/${this.bucket}/`, "");
    const response = await this.s3!.send(
      new GetObjectCommand({ Bucket: this.bucket!, Key: key })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
