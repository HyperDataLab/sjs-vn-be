import { describe, test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import prisma from "../../../config/prisma.js";
import {
  normalizePagination,
  formatPaginationResponse,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_PAGE_LIMIT,
} from "../../../utils/pagination.js";
import {
  getCachedArticleStats,
  getArticleListData,
} from "../../../modules/article/services/articleDiscoveryCache.service.js";
import * as articleService from "../../../modules/article/services/article.service.js";

describe("Query Optimization, Safe Pagination & Caching Suite", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe("Pagination Utility Safeguards", () => {
    test("returns default values when query is empty", () => {
      const result = normalizePagination({});
      assert.deepEqual(result, {
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        offset: 0,
      });
    });

    test("clamps negative page or zero to DEFAULT_PAGE", () => {
      assert.equal(normalizePagination({ page: 0 }).page, 1);
      assert.equal(normalizePagination({ page: -5 }).page, 1);
      assert.equal(normalizePagination({ page: "invalid" }).page, 1);
    });

    test("clamps excessive limit to MAX_PAGE_LIMIT (100) to protect server memory", () => {
      const result = normalizePagination({ limit: 50000 });
      assert.equal(result.limit, MAX_PAGE_LIMIT);
    });

    test("clamps negative or zero limit to default limit", () => {
      assert.equal(normalizePagination({ limit: 0, defaultLimit: 20 }).limit, 20);
      assert.equal(normalizePagination({ limit: -10 }, { defaultLimit: 20 }).limit, 20);
      assert.equal(normalizePagination({ limit: "abc", defaultLimit: 20 }).limit, 20);
    });

    test("calculates offset accurately from page and limit", () => {
      const result = normalizePagination({ page: 3, limit: 20 });
      assert.equal(result.page, 3);
      assert.equal(result.limit, 20);
      assert.equal(result.offset, 40);
    });

    test("respects explicit valid offset when provided", () => {
      const result = normalizePagination({ page: 1, limit: 10, offset: 25 });
      assert.equal(result.offset, 25);
    });

    test("ignores negative or invalid offset and falls back to (page - 1) * limit", () => {
      const result = normalizePagination({ page: 2, limit: 10, offset: -5 });
      assert.equal(result.offset, 10);
      const invalidResult = normalizePagination({ page: 2, limit: 10, offset: "invalid" });
      assert.equal(invalidResult.offset, 10);
    });

    test("formatPaginationResponse produces valid metadata and handles zero total", () => {
      const normal = formatPaginationResponse(95, 2, 10);
      assert.deepEqual(normal, {
        total: 95,
        page: 2,
        limit: 10,
        total_pages: 10,
      });

      const zero = formatPaginationResponse(0, 1, 10);
      assert.deepEqual(zero, {
        total: 0,
        page: 1,
        limit: 10,
        total_pages: 1,
      });
    });
  });

  describe("Article Stats Caching across Paginated Requests", () => {
    test("getCachedArticleStats ignores page/limit/offset and reuses cached stats across pages", async () => {
      mock.method(prisma, "$queryRawUnsafe", async (sql) => {
        if (sql.includes("COUNT(*)")) {
          return [{
            totalArticles: 1500,
            openAccessCount: 600,
            authorsCount: 0,
            topicsCount: 45,
          }];
        }
        return [];
      });

      // Page 1
      const statsPage1 = await getCachedArticleStats({
        limit: 10,
        offset: 0,
        sortBy: "created_at",
        sortOrder: "DESC",
        publicationYear: "2026",
      });

      // Page 2 - same filter, different page/offset
      const statsPage2 = await getCachedArticleStats({
        limit: 10,
        offset: 10,
        sortBy: "created_at",
        sortOrder: "DESC",
        publicationYear: "2026",
      });

      assert.deepEqual(statsPage1, statsPage2);
      assert.equal(statsPage1.totalArticles, 1500);
      assert.equal(statsPage1.openAccessCount, 600);
      assert.equal(statsPage1.topicsCount, 45);
    });

    test("getArticleListData reuses cached stats when navigating through pages", async () => {
      mock.method(prisma, "$queryRawUnsafe", async (sql, ...values) => {
        if (sql.includes("COUNT(*)")) {
          return [{
            totalArticles: 50,
            openAccessCount: 20,
            authorsCount: 0,
            topicsCount: 5,
          }];
        }
        const offset = values[values.length - 1] || 0;
        return [
          { article_id: String(offset + 1), title: `Article ${offset + 1}`, authors: [], sub_topics: [] },
        ];
      });

      const page1 = await getArticleListData({ limit: 10, offset: 0, publicationYear: "2025" });
      const page2 = await getArticleListData({ limit: 10, offset: 10, publicationYear: "2025" });

      assert.equal(page1.total, 50);
      assert.equal(page2.total, 50);
      assert.equal(page1.articles[0].article_id, "1");
      assert.equal(page2.articles[0].article_id, "11");
    });
  });

  describe("Service Layer Limit & Offset Safeguards", () => {
    test("getAllArticles clamps limit to 100 max and offset to 0 min in SQL parameters", async () => {
      let capturedValues = [];
      mock.method(prisma, "$queryRawUnsafe", async (sql, ...values) => {
        capturedValues = values;
        return [];
      });

      await articleService.getAllArticles({ limit: 99999, offset: -50 });

      const limitVal = capturedValues[capturedValues.length - 2];
      const offsetVal = capturedValues[capturedValues.length - 1];

      assert.equal(limitVal, 100, "limit must be clamped to 100");
      assert.equal(offsetVal, 0, "offset must not be negative");
    });

    test("getArticlesByKeywords clamps limit to 100 max and offset to 0 min", async () => {
      let capturedValues = [];
      mock.method(prisma, "$queryRawUnsafe", async (sql, ...values) => {
        capturedValues = values;
        return [];
      });

      await articleService.getArticlesByKeywords(["ai", "deep learning"], 5000, -10);

      const limitVal = capturedValues[capturedValues.length - 2];
      const offsetVal = capturedValues[capturedValues.length - 1];

      assert.equal(limitVal, 100, "limit must be clamped to 100");
      assert.equal(offsetVal, 0, "offset must not be negative");
    });
  });
});
