CREATE TABLE IF NOT EXISTS products (
  code varchar(14) PRIMARY KEY,
  name text,
  brand text,
  quantity text,
  image_url text,
  category text,
  source varchar(40) NOT NULL DEFAULT 'open_food_facts',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar(40) NOT NULL,
  external_id varchar(160) NOT NULL,
  name text NOT NULL,
  city text,
  country_code varchar(2),
  lat numeric(10, 7),
  lon numeric(10, 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_source_external_id_uq UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar(40) NOT NULL,
  external_id varchar(160),
  product_code varchar(14) NOT NULL,
  product_name text,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price numeric(10, 2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'BRL',
  observed_at timestamptz NOT NULL,
  verification varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prices_source_external_id_uq UNIQUE (source, external_id),
  CONSTRAINT prices_positive_price_ck CHECK (price > 0)
);
CREATE INDEX IF NOT EXISTS prices_product_code_observed_at_idx ON prices (product_code, observed_at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'running',
  records integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id uuid PRIMARY KEY,
  legacy_cart_imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopping_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name varchar(160) NOT NULL,
  size varchar(30),
  price numeric(10, 2) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_cart_items_price_ck CHECK (price > 0),
  CONSTRAINT shopping_cart_items_quantity_ck CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS shopping_cart_items_session_position_idx ON shopping_cart_items (session_id, position);

CREATE TABLE IF NOT EXISTS scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL,
  product_name text,
  brand text,
  variant text,
  size text,
  unit varchar(8),
  barcode varchar(14),
  price numeric(10, 2),
  promo_price numeric(10, 2),
  member_price numeric(10, 2),
  raw_text text,
  price_uncertain boolean NOT NULL DEFAULT false,
  recognized boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scans_kind_ck CHECK (kind IN ('ticket', 'product'))
);
CREATE INDEX IF NOT EXISTS scans_session_created_at_idx ON scans (session_id, created_at DESC);
