-- Migration: 009_router_preshared_key
-- Description: Add encrypted preshared key column to routers for WireGuard peer sync on restart
-- Date: 2026-04-03

ALTER TABLE routers ADD COLUMN IF NOT EXISTS wg_preshared_key_enc TEXT;
