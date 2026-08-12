-- Each photo carries its own date (from EXIF at upload, editable). The
-- post's date range is derived from its photos; existing photos inherit
-- their post's date.
ALTER TABLE post_media ADD COLUMN media_date TEXT;
UPDATE post_media SET media_date = (SELECT post_date FROM posts WHERE posts.id = post_media.post_id)
  WHERE media_date IS NULL;
