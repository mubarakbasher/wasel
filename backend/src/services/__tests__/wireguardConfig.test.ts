import { describe, it, expect, vi, beforeAll } from 'vitest';

// Config is loaded at module scope in wireguardConfig.ts, so mock it before importing.
vi.mock('../../config', () => ({
  config: {
    WG_SERVER_PRIVATE_KEY: 'server-private-key',
    WG_SERVER_PUBLIC_KEY: 'server-public-key',
    WG_SERVER_PORT: 51820,
    WG_SERVER_ENDPOINT: 'vpn.wasel.app',
  },
}));

import {
  generateMikrotikConfig,
  generateSetupSteps,
  generateMikrotikConfigText,
} from '../wireguardConfig';

const BASE_PARAMS = {
  routerPrivateKey: 'router-private-key-abc123',
  routerTunnelIp: '10.10.0.2',
  serverPublicKey: 'server-public-key-xyz789',
  serverEndpoint: 'vpn.wasel.app:51820',
  radiusSecret: 'supersecretradius',
  radiusServerIp: '10.10.0.1',
  apiPassword: 'api-password-def456',
};

describe('generateMikrotikConfig', () => {
  it('emits exactly 13 non-empty lines', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    const lines = output.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(13);
  });

  it('step 7 is the correct /radius add line with interpolated values', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    const lines = output.split('\n').filter((l) => l.trim().length > 0);
    const radiusLine = lines[6]; // 0-indexed step 7
    expect(radiusLine).toBe(
      `/radius add service=hotspot,login address=10.10.0.1 secret="supersecretradius" src-address=10.10.0.2 comment=wasel`,
    );
  });

  it('contains the wasel-radius-auth firewall comment', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain('comment=wasel-radius-auth');
  });

  it('contains the wasel-radius-coa firewall comment', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain('comment=wasel-radius-coa');
  });

  it('contains the wasel-wg firewall comment', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain('comment=wasel-wg');
  });

  it('includes the router private key in step 1', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain(`private-key="router-private-key-abc123"`);
  });

  it('includes the radius secret in the /radius add line', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain(`secret="supersecretradius"`);
  });

  it('includes src-address equal to the tunnel IP', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).toContain(`src-address=10.10.0.2`);
  });

  it('includes preshared-key when provided', () => {
    const output = generateMikrotikConfig({ ...BASE_PARAMS, presharedKey: 'mypsk' });
    expect(output).toContain(`preshared-key="mypsk"`);
  });

  it('omits preshared-key when not provided', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    expect(output).not.toContain('preshared-key');
  });

  it('derives the correct /30 network for step 3', () => {
    const output = generateMikrotikConfig(BASE_PARAMS);
    // 10.10.0.2 -> network 10.10.0.0
    expect(output).toContain('network=10.10.0.0');
  });
});

describe('generateSetupSteps', () => {
  it('returns exactly 13 steps', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps).toHaveLength(13);
  });

  it('step numbers are 1 through 13 in order', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    steps.forEach((s, idx) => {
      expect(s.step).toBe(idx + 1);
    });
  });

  it('step 7 (index 6) command starts with /radius add service=hotspot,login address=10.10.0.1', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[6].command).toMatch(/^\/radius add service=hotspot,login address=10\.10\.0\.1/);
  });

  it('step 7 command contains the correct secret', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[6].command).toContain(`secret="supersecretradius"`);
  });

  it('step 7 command contains src-address equal to the tunnel IP', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[6].command).toContain('src-address=10.10.0.2');
  });

  it('step 11 (index 10) command contains wasel-radius-auth', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[10].command).toContain('comment=wasel-radius-auth');
  });

  it('step 12 (index 11) command contains wasel-radius-coa', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[11].command).toContain('comment=wasel-radius-coa');
  });

  it('step 13 (index 12) command contains wasel-wg', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    expect(steps[12].command).toContain('comment=wasel-wg');
  });

  it('every step has a non-empty title, description, and command', () => {
    const steps = generateSetupSteps(BASE_PARAMS);
    for (const s of steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.command.length).toBeGreaterThan(0);
    }
  });
});

describe('generateMikrotikConfigText', () => {
  const TEXT_PARAMS = {
    ...BASE_PARAMS,
    routerName: 'Office Router',
  };

  it('contains the /radius add line with correct values', () => {
    const text = generateMikrotikConfigText(TEXT_PARAMS);
    expect(text).toContain('service=hotspot,login');
    expect(text).toContain('address=10.10.0.1');
    expect(text).toContain('secret="supersecretradius"');
    expect(text).toContain('src-address=10.10.0.2');
    expect(text).toContain('comment=wasel');
  });

  it('contains all 13 STEP headings', () => {
    const text = generateMikrotikConfigText(TEXT_PARAMS);
    for (let i = 1; i <= 13; i++) {
      expect(text).toContain(`STEP ${i}:`);
    }
  });

  it('does not contain /tool fetch (old callback step)', () => {
    const text = generateMikrotikConfigText(TEXT_PARAMS);
    expect(text).not.toContain('/tool fetch');
  });

  it('does not contain radius-interim-update', () => {
    const text = generateMikrotikConfigText(TEXT_PARAMS);
    expect(text).not.toContain('radius-interim-update');
  });
});
