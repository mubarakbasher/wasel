-- Add role column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- Mark seed admin user
UPDATE users SET role = 'admin' WHERE email = 'admin@wa-sel.com';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
