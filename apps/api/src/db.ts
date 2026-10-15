import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL es obligatorio");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
