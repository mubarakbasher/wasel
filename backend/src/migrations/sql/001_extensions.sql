-- Migration: 001_extensions
-- Description: Enable required PostgreSQL extensions
-- Date: 2026-03-28

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
