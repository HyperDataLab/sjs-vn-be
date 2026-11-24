-- 0007_add_performance_and_relationship_indexes.sql
-- Thêm các chỉ mục (indexes) để tối ưu hóa hiệu năng truy vấn cho các bảng:
-- Article, Keyword_Article, Author_Article, Issue, Volume, Journal, Topic, Sub_Topic,
-- Journal_Subject_Category, Project, Project_Article_Bookmark, Article_Citing_Work,
-- Article_Reference, Bookmark.
--
-- QUAN TRỌNG:
-- - Script này an toàn tuyệt đối cho cơ sở dữ liệu production.
-- - CREATE INDEX CONCURRENTLY không lock bảng (zero-downtime), nhưng KHÔNG được chạy trong transaction block.
-- - Tự động bỏ qua nếu index đã tồn tại nhờ IF NOT EXISTS.

-- 1. Bảng Article (Bộ lọc chính và sắp xếp phân trang)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_article_is_deleted_created"
  ON "Article" ("is_deleted", "created_at" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_article_is_deleted_pub_year"
  ON "Article" ("is_deleted", "publication_year");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_article_primary_topic"
  ON "Article" ("primary_topic");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_article_issue_id"
  ON "Article" ("issue_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_article_doi"
  ON "Article" ("doi");

-- 2. Chỉ mục đảo chiều cho bảng trung gian quan hệ nhiều - nhiều (Junction Tables)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_keyword_article_article_id"
  ON "Keyword_Article" ("article_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_author_article_article_id"
  ON "Author_Article" ("article_id");

-- 3. Phân cấp Tạp chí: Issue & Volume (Hỗ trợ lọc theo số / tập)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_issue_volume_id"
  ON "Issue" ("volume_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_volume_journal_id"
  ON "Volume" ("journal_id");

-- 4. Bảng Journal (Lọc theo nhà xuất bản và trạng thái hoạt động)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_journal_publisher_id"
  ON "Journal" ("publisher_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_journal_is_deleted"
  ON "Journal" ("is_deleted");

-- 5. Bảng Chủ đề: Sub_Topic & Topic (Lọc bài báo theo chủ đề phân cấp)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sub_topic_topic_id"
  ON "Sub_Topic" ("topic_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_topic_subject_area_id"
  ON "Topic" ("subject_area_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_topic_subject_category_id"
  ON "Topic" ("subject_category_id");

-- 6. Phân loại Tạp chí theo chuyên ngành (Journal_Subject_Category)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jsc_subject_category_id"
  ON "Journal_Subject_Category" ("subject_category_id");

-- 7. Dự án & Dấu trang người dùng (Project & Bookmark)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_project_user_id"
  ON "Project" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_pab_article_id"
  ON "Project_Article_Bookmark" ("article_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_pab_user_id"
  ON "Project_Article_Bookmark" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_bookmark_article_id"
  ON "Bookmark" ("article_id");

-- 8. Trích dẫn & Tài liệu tham khảo liên kết nội bộ
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_citing_work_citing_article_id"
  ON "Article_Citing_Work" ("citing_article_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_reference_referenced_article_id"
  ON "Article_Reference" ("referenced_article_id");
