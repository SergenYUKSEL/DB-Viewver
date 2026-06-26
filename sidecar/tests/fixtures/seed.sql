DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  name text
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  total numeric
);

CREATE VIEW active_users AS
  SELECT id, email FROM users;

INSERT INTO users (email, name) VALUES
  ('a@x.com', 'A'), ('b@x.com', 'B'), ('c@x.com', NULL);
INSERT INTO orders (user_id, total) VALUES
  (1, 10.0), (1, 20.0), (2, 5.5);

ANALYZE;
