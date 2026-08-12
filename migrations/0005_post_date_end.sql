-- Posts can span a date range (e.g. photos from a whole weekend).
-- post_date stays the start date and the sort key; post_date_end is
-- NULL for single-day posts.
ALTER TABLE posts ADD COLUMN post_date_end TEXT;
