-- 004_seed_data.sql
-- Seed initial data for the Wasel Mikrotik Hotspot Voucher Manager

-- Default subscription plans reference (for documentation, actual enforcement is in code)
-- Starter: $5/mo, 1 router, 500 vouchers/mo
-- Professional: $12/mo, 3 routers, 2000 vouchers/mo
-- Enterprise: $25/mo, 10 routers, unlimited vouchers

-- Insert a default admin user (password: 'admin123' bcrypt hashed with cost 12)
-- Use bcrypt hash: '$2b$12$LJ3m4ys3Lg2VHqwMwKMfveYYP8wOg/GBR8sMSoRqpNRoCxGt7mfSa'
INSERT INTO users (name, email, password_hash, business_name, is_verified, is_active)
VALUES ('Admin', 'admin@wa-sel.com', '$2b$12$LJ3m4ys3Lg2VHqwMwKMfveYYP8wOg/GBR8sMSoRqpNRoCxGt7mfSa', 'Wasel Platform', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;
