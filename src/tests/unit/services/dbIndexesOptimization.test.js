import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../../");

describe("Database Indexes & Query Optimization Suite (Step 1)", () => {
  const sqlFilePath = path.join(
    projectRoot,
    "deploy",
    "sql",
    "0007_add_performance_and_relationship_indexes.sql"
  );
  const prismaSchemaPath = path.join(projectRoot, "prisma", "schema.prisma");

  const expectedIndexes = [
    // Article composite and foreign key indexes
    "idx_article_is_deleted_created",
    "idx_article_is_deleted_pub_year",
    "idx_article_primary_topic",
    "idx_article_issue_id",
    "idx_article_doi",
    // Junction table reverse indexes
    "idx_keyword_article_article_id",
    "idx_author_article_article_id",
    // Hierarchy foreign key indexes
    "idx_issue_volume_id",
    "idx_volume_journal_id",
    // Journal indexes
    "idx_journal_publisher_id",
    "idx_journal_is_deleted",
    // Topic & category indexes
    "idx_sub_topic_topic_id",
    "idx_topic_subject_area_id",
    "idx_topic_subject_category_id",
    "idx_jsc_subject_category_id",
    // Project and bookmark indexes
    "idx_project_user_id",
    "idx_pab_article_id",
    "idx_pab_user_id",
    "idx_bookmark_article_id",
    // Linkage indexes
    "idx_citing_work_citing_article_id",
    "idx_reference_referenced_article_id",
  ];

  describe("Deploy SQL Migration Script (0007)", () => {
    test("migration SQL file exists and is readable", () => {
      assert.ok(fs.existsSync(sqlFilePath), "File 0007_add_performance_and_relationship_indexes.sql must exist");
      const stat = fs.statSync(sqlFilePath);
      assert.ok(stat.size > 500, "Migration file must contain full index declarations");
    });

    test("all index creation statements use zero-downtime CONCURRENTLY IF NOT EXISTS", () => {
      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
      const lines = sqlContent.split("\n");
      const createIndexLines = lines
        .map((line) => line.trim())
        .filter((line) => !line.startsWith("--") && /CREATE\s+INDEX/i.test(line));

      assert.ok(createIndexLines.length >= expectedIndexes.length, `Expected at least ${expectedIndexes.length} CREATE INDEX statements`);
      for (const line of createIndexLines) {
        assert.match(
          line,
          /CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS/i,
          `Index line must use CONCURRENTLY IF NOT EXISTS: ${line}`
        );
      }
    });

    test("contains no dangerous statements or transactions", () => {
      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
      assert.ok(!/DROP\s+(TABLE|DATABASE|SCHEMA)/i.test(sqlContent), "SQL must not drop tables or schemas");
      assert.ok(!/TRUNCATE/i.test(sqlContent), "SQL must not truncate tables");
      assert.ok(!/BEGIN\s*;/i.test(sqlContent), "CONCURRENTLY indexes must not run inside BEGIN blocks");
      assert.ok(!/COMMIT\s*;/i.test(sqlContent), "CONCURRENTLY indexes must not have COMMIT statements");
    });

    test("declares every expected performance and relation index", () => {
      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
      for (const idxName of expectedIndexes) {
        assert.ok(
          sqlContent.includes(`"${idxName}"`),
          `SQL migration must declare index: "${idxName}"`
        );
      }
    });

    test("targets expected tables for reverse junction lookups and article filters", () => {
      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
      assert.ok(sqlContent.includes('ON "Article" ("is_deleted", "created_at" DESC)'), "Must create composite index for active article creation sort");
      assert.ok(sqlContent.includes('ON "Keyword_Article" ("article_id")'), "Must index Keyword_Article by article_id");
      assert.ok(sqlContent.includes('ON "Author_Article" ("article_id")'), "Must index Author_Article by article_id");
      assert.ok(sqlContent.includes('ON "Issue" ("volume_id")'), "Must index Issue by volume_id");
      assert.ok(sqlContent.includes('ON "Volume" ("journal_id")'), "Must index Volume by journal_id");
    });
  });

  describe("Prisma Schema Synchronization", () => {
    test("prisma schema file exists", () => {
      assert.ok(fs.existsSync(prismaSchemaPath), "prisma/schema.prisma must exist");
    });

    test("schema.prisma defines all newly added index mappings", () => {
      const schemaContent = fs.readFileSync(prismaSchemaPath, "utf8");
      for (const idxName of expectedIndexes) {
        assert.ok(
          schemaContent.includes(`map: "${idxName}"`),
          `prisma/schema.prisma must include index mapped to "${idxName}"`
        );
      }
    });

    test("Article model in schema.prisma has composite indexes with sort directions", () => {
      const schemaContent = fs.readFileSync(prismaSchemaPath, "utf8");
      assert.ok(
        schemaContent.includes('@@index([is_deleted, created_at(sort: Desc)], map: "idx_article_is_deleted_created")'),
        "Article model must specify sort: Desc for created_at index"
      );
      assert.ok(
        schemaContent.includes('@@index([is_deleted, publication_year], map: "idx_article_is_deleted_pub_year")'),
        "Article model must specify composite index for publication_year"
      );
    });

    test("junction models Author_Article and Keyword_Article define reverse article_id indexes", () => {
      const schemaContent = fs.readFileSync(prismaSchemaPath, "utf8");
      assert.ok(
        schemaContent.includes('@@index([article_id], map: "idx_author_article_article_id")'),
        "Author_Article must have @@index([article_id])"
      );
      assert.ok(
        schemaContent.includes('@@index([article_id], map: "idx_keyword_article_article_id")'),
        "Keyword_Article must have @@index([article_id])"
      );
    });

    test("hierarchy and linkage models define foreign key indexes", () => {
      const schemaContent = fs.readFileSync(prismaSchemaPath, "utf8");
      assert.ok(schemaContent.includes('@@index([volume_id], map: "idx_issue_volume_id")'));
      assert.ok(schemaContent.includes('@@index([journal_id], map: "idx_volume_journal_id")'));
      assert.ok(schemaContent.includes('@@index([publisher_id], map: "idx_journal_publisher_id")'));
      assert.ok(schemaContent.includes('@@index([topic_id], map: "idx_sub_topic_topic_id")'));
      assert.ok(schemaContent.includes('@@index([user_id], map: "idx_project_user_id")'));
      assert.ok(schemaContent.includes('@@index([article_id], map: "idx_bookmark_article_id")'));
    });
  });
});
