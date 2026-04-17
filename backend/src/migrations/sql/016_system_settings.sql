CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

INSERT INTO system_settings (key, value) VALUES
    ('bank.name',          '""'::jsonb),
    ('bank.accountNumber', '""'::jsonb),
    ('bank.accountHolder', '""'::jsonb),
    ('bank.instructions',  '""'::jsonb)
ON CONFLICT (key) DO NOTHING;
