import { PrismaClient } from "@prisma/client";
import "./env.js";

const prisma = new PrismaClient();

try {
  await prisma.$queryRaw`SELECT 1`;
  console.info("Database connection verified.");
} catch {
  console.error("Database connection failed. Check the Supabase Session Pooler URL and credentials in .env.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
