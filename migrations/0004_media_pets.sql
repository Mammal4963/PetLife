-- Per-photo pet tags: which pets appear in each photo of a post,
-- refining the post-level post_pets tags.
CREATE TABLE IF NOT EXISTS media_pets (
  media_id INTEGER NOT NULL REFERENCES post_media(id) ON DELETE CASCADE,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, pet_id)
);
