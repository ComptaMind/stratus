// reflect-metadata must be the FIRST import for NestJS decorators to work.
import "reflect-metadata";

import { config } from "dotenv";
import path from "path";

// Load root .env so DATABASE_URL and other secrets are available in tests.
config({ path: path.resolve(__dirname, "../../../.env") });
