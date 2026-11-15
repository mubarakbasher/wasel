import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sqlDir = join(__dirname, '../migrations/sql');

function readMigration(name: string): string {
  return readFileSync(join(sqlDir, name), 'utf8');
}

function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

const FORBIDDEN_TABLES = ['radacct', 'voucher_meta', 'radpostauth', 'users', 'routers', 'payments', 'subscriptions'];

describe('analyticsMigrations', () => {
  const raws: Record<string, string> = {
    '044': readMigration('044_analytics_money.sql'),
    '045': readMigration('045_analytics_recording.sql'),
    '046': readMigration('046_analytics_summaries.sql'),
  };

  for (const [num, raw] of Object.entries(raws)) {
    const sql = stripLineComments(raw);

    describe('Migration ' + num, () => {
      it('every CREATE TABLE uses IF NOT EXISTS', () => {
        const tables = sql.match(/CREATE\s+TABLE\s+(?!IF NOT EXISTS)/gi);
        expect(tables).toBeNull();
      });

      it('every CREATE INDEX uses IF NOT EXISTS', () => {
        const indexes = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi);
        expect(indexes).toBeNull();
      });

      it('contains no REFERENCES', () => {
        expect(sql).not.toMatch(/\bREFERENCES\b/i);
      });

      it('contains no ALTER TABLE', () => {
        expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
      });

      it('contains no DROP', () => {
        expect(sql).not.toMatch(/\bDROP\b/i);
      });

      it('does not name protected tables', () => {
        for (const table of FORBIDDEN_TABLES) {
          const re = new RegExp('\\b' + table + '\\b', 'i');
          expect(re.test(sql), 'should not reference ' + table).toBe(false);
        }
      });
    });
  }

  describe('Migration 045 seed insert', () => {
    it("lists exactly 'radacct_cursor' and 'monitor_heartbeat' and ends ON CONFLICT DO NOTHING", () => {
      const sql = stripLineComments(raws['045']);
      expect(sql).toMatch(/'radacct_cursor'/);
      expect(sql).toMatch(/'monitor_heartbeat'/);
      expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
      const insertMatch = sql.match(/INSERT INTO analytics_state \(key\) VALUES \(([^)]+)\),\(([^)]+)\)/i);
      expect(insertMatch).not.toBeNull();
      const vals = [insertMatch![1].trim(), insertMatch![2].trim()].sort();
      expect(vals).toEqual(["'monitor_heartbeat'", "'radacct_cursor'"].sort());
    });
  });

  describe('Migration 046 nullable router_id columns', () => {
    it('analytics_usage_hourly allows a NULL router_id and uses UNIQUE NULLS NOT DISTINCT', () => {
      const sql = stripLineComments(raws['046']);
      const hourlyMatch = sql.match(/CREATE TABLE IF NOT EXISTS analytics_usage_hourly\s*\(([^;]+?)\);/is);
      expect(hourlyMatch).not.toBeNull();
      const hourlyDef = hourlyMatch![1];
      const routerLine = hourlyDef.split('\n').find((l: string) => l.match(/router_id/i));
      expect(routerLine).toBeDefined();
      expect(routerLine).not.toMatch(/NOT NULL/i);
      expect(hourlyDef).toMatch(/UNIQUE NULLS NOT DISTINCT/i);
    });

    it('analytics_usage_daily allows a NULL router_id and uses UNIQUE NULLS NOT DISTINCT', () => {
      const sql = stripLineComments(raws['046']);
      const dailyMatch = sql.match(/CREATE TABLE IF NOT EXISTS analytics_usage_daily\s*\(([^;]+?)\);/is);
      expect(dailyMatch).not.toBeNull();
      const dailyDef = dailyMatch![1];
      const routerLine = dailyDef.split('\n').find((l: string) => l.match(/router_id/i));
      expect(routerLine).toBeDefined();
      expect(routerLine).not.toMatch(/NOT NULL/i);
      expect(dailyDef).toMatch(/UNIQUE NULLS NOT DISTINCT/i);
    });
  });
});
