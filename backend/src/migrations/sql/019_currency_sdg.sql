-- 019_currency_sdg.sql
-- Switch platform currency from USD to SDG (Sudanese Pound).

ALTER TABLE plans    ALTER COLUMN currency SET DEFAULT 'SDG';
ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'SDG';

UPDATE plans    SET currency = 'SDG' WHERE currency = 'USD';
UPDATE payments SET currency = 'SDG' WHERE currency = 'USD';
