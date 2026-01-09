CREATE TABLE IF NOT EXISTS players (
    uid TEXT PRIMARY KEY,
    name TEXT,
    level INTEGER,
    exp INTEGER,
    region TEXT,
    likes INTEGER,
    last_update TEXT,
    last_fetched TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_admin_added BOOLEAN DEFAULT FALSE
);
