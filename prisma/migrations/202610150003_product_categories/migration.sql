CREATE TYPE "ProductCategory" AS ENUM ('SODA', 'SNACK');

ALTER TABLE "Product"
  ADD COLUMN "category" "ProductCategory" NOT NULL DEFAULT 'SNACK';

UPDATE "Product"
SET "category" = 'SODA'
WHERE lower("name") IN ('gaseosa', 'agua');
