import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

// ---- Hoisted module mocks ----------------------------------------------------

const { getPeerStatusMock } = vi.hoisted(() => ({
  getPeerStatusMock: vi.fn(),
}));
const { testConnectionMock, connectToRouterMock } = vi.hoisted(() => ({
  testConnectionMock: vi.fn(),
  connectToRouterMock: vi.fn(),
}));
const { sendAccessRequestMock } = vi.hoisted(() => ({
  sendAccessRequestMock: vi.fn(),
}));
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

// probeFreeradiusSeesNas no longer calls showFreeradiusClients — it queries
// postgres directly. The freeradius.service mock only needs to export the
// symbols that routerHealth.service.ts still imports (none after the rewrite).
vi.mock('../../services/freeradius.service', () => ({}));

vi.mock('../../services/wireguardPeer', () => ({
  getPeerStatus: getPeerStatusMock,
}));

const { listHotspotServersMock } = vi.hoisted(() => ({
  listHotspotServersMock: vi.fn<(api: unknown) => Promise<unknown[]>>(),
}));

vi.mock('../../services/routerOs.service', () => ({
  testConnection: testConnectionMock,
  connectToRouter: connectToRouterMock,
  listHotspotServers: listHotspotServersMock,
}));

vi.mock('../../services/radclient.service', () => ({
  sendAccessRequest: sendAccessRequestMock,
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: (
      cmd: string,
      args: string[],
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => execFileMock(cmd, args, cb),
  };
});

vi.mock('../../utils/encryption', () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));

// Import after mocks are wired.
import { runHealthCheck } from '../../services/routerHealth.service';

// ---- Helpers -----------------------------------------------------------------

const USER_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const ROUTER_ID = 'bbbbbbbb-1111-4000-8000-000000000001';

function mockRouterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTER_ID,
    tunnel_ip: '10.10.0.2',
    wg_public_key: 'pk-router',
    radius_secret_enc: 'enc:secret',
    last_health_check_at: null,
    last_health_report: null,
    ...overrides,
  };
}

function okApi() {
  return {
    menu: vi.fn((_path: string) => ({
      get: vi.fn(),
    })),
  };
}

function connectStub(menuImpl: (path: string) => Array<Record<string, unknown>>) {
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const api = {
    menu: (path: string) => ({
      get: async () => menuImpl(path),
    }),
  };
  return {
    client: { disconnect },
    api,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  listHotspotServersMock.mockResolvedValue([]);
});

/**
 * Push the three DB queries that every test needs before probes 3+:
 *   1. loadRouterForHealth SELECT
 *   2. probeNasRowPresent SELECT 1 FROM nas WHERE nasname=$1
 *   3. probeFreeradiusSeesNas SELECT 1 FROM nas WHERE nasname=$1 AND secret ...
 *
 * nasPresent controls both probes (if the row is absent, probe 2 is also absent).
 */
function primeLoadAndNas(routerRow: Record<string, unknown>, nasPresent: boolean) {
  // 1) loadRouterForHealth SELECT
  mockQuery.mockResolvedValueOnce({ rows: [routerRow] });
  // 2) probeNasRowPresent
  mockQuery.mockResolvedValueOnce({ rows: nasPresent ? [{ present: 1 }] : [] });
  // 3) probeFreeradiusSeesNas (postgres query — dynamic_clients source of truth)
  mockQuery.mockResolvedValueOnce({ rows: nasPresent ? [{ present: 1 }] : [] });
}

// Every run ends with a persist UPDATE — allow any number of trailing queries.
function allowPersist() {
  mockQuery.mockResolvedValue({ rows: [] });
}

// ---- Tests -------------------------------------------------------------------

describe('runHealthCheck', () => {
  it('returns ROUTER_NOT_FOUND when the row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(runHealthCheck(USER_ID, ROUTER_ID, { force: true })).rejects.toMatchObject({
      statusCode: 404,
      code: 'ROUTER_NOT_FOUND',
    });
  });

  it('short-circuits when the nas row is missing (no probes 3-9)', async () => {
    // primeLoadAndNas handles all three DB calls for load + probe 1 + probe 2
    primeLoadAndNas(mockRouterRow(), false);
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    expect(report.overall).toBe('broken');
    expect(report.probes.map((p) => p.id)).toEqual([
      'nasRowPresent',
      'freeradiusSeesNas',
    ]);
    expect(report.probes[0].status).toBe('fail');
  });

  it('passes probe 2 when the nas row has a non-empty secret', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    // Active hotspot server using the 'default' profile
    listHotspotServersMock.mockResolvedValue([
      { id: '*1', name: 'wasel-hotspot', interface: 'bridge', profile: 'default', disabled: false },
    ]);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'yes' }];
        if (path === '/radius') return [{ address: '10.10.0.1', service: 'hotspot', secret: 'x' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812,1813', disabled: 'false' },
          { action: 'accept', protocol: 'udp', 'dst-port': '3799', disabled: 'false' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820', disabled: 'false' },
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    const p2 = report.probes.find((p) => p.id === 'freeradiusSeesNas');
    expect(p2?.status).toBe('pass');
    expect(report.overall).toBe('healthy');
  });

  it('fails probe 2 when the nas row is missing or has no secret', async () => {
    // Load router row succeeds, but both nas probes return empty
    mockQuery.mockResolvedValueOnce({ rows: [mockRouterRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [{ present: 1 }] }); // probeNasRowPresent — present
    mockQuery.mockResolvedValueOnce({ rows: [] });                // probeFreeradiusSeesNas — missing secret
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(false);
    sendAccessRequestMock.mockResolvedValueOnce('timeout');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });
    const p2 = report.probes.find((p) => p.id === 'freeradiusSeesNas');
    expect(p2?.status).toBe('fail');
  });

  it('fails probe 3 when WireGuard handshake is stale', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    // handshake well past the 150 s threshold
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 10_000,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(new Error('timeout'), '', ''));
    testConnectionMock.mockResolvedValueOnce(false);
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    const p3 = report.probes.find((p) => p.id === 'wgHandshakeRecent');
    expect(p3?.status).toBe('fail');
    expect(report.overall).toBe('broken');
  });

  it('fails probe 4 (pingTunnel) when ping exits non-zero', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(new Error('100% packet loss'), '', ''));
    testConnectionMock.mockResolvedValueOnce(false);
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    const p4 = report.probes.find((p) => p.id === 'pingTunnel');
    expect(p4?.status).toBe('fail');
  });

  it('skips probes 6/7/8 when RouterOS API (probe 5) is unreachable', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(false);
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    const byId = Object.fromEntries(report.probes.map((p) => [p.id, p]));
    expect(byId.routerOsApiReachable.status).toBe('fail');
    expect(byId.hotspotUsesRadius.status).toBe('skipped');
    expect(byId.radiusClientConfigured.status).toBe('skipped');
    expect(byId.firewallAllowsRadius.status).toBe('skipped');
    expect(report.overall).toBe('degraded');
  });

  it('fails probe 6 when /ip/hotspot/profile default has use-radius=no', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'no' }];
        if (path === '/radius') return [{ address: '10.10.0.1', service: 'hotspot', secret: 'x' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812' },
          { action: 'accept', protocol: 'udp', 'dst-port': '3799' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820' },
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });
    const p6 = report.probes.find((p) => p.id === 'hotspotUsesRadius');
    expect(p6?.status).toBe('fail');
    expect(p6?.setupStep).toBe(6);
    expect(report.overall).toBe('degraded');
  });

  it('fails probe 7 when no /radius entry matches Wasel address', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'yes' }];
        if (path === '/radius') return [{ address: '8.8.8.8', service: 'login', secret: '' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812' },
          { action: 'accept', protocol: 'udp', 'dst-port': '3799' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820' },
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });
    const p7 = report.probes.find((p) => p.id === 'radiusClientConfigured');
    expect(p7?.status).toBe('fail');
    expect(p7?.setupStep).toBe(5);
  });

  it('fails probe 8 when firewall is missing an accept rule for UDP 3799', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'yes' }];
        if (path === '/radius') return [{ address: '10.10.0.1', service: 'hotspot', secret: 'x' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812,1813' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820' },
          // 3799 intentionally missing
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });
    const p8 = report.probes.find((p) => p.id === 'firewallAllowsRadius');
    expect(p8?.status).toBe('fail');
    expect(p8?.setupStep).toBe(7);
    expect(p8?.detail).toContain('3799');
  });

  it('fails freeradiusAlive probe and marks overall degraded when synthetic RADIUS times out', async () => {
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'yes' }];
        if (path === '/radius') return [{ address: '10.10.0.1', service: 'hotspot', secret: 'x' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812' },
          { action: 'accept', protocol: 'udp', 'dst-port': '3799' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820' },
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('timeout');
    allowPersist();

    const report = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });

    // freeradiusAlive is a global signal (FreeRADIUS-up check) — failing it
    // marks the report degraded, NOT broken, because it isn't per-router-
    // actionable and shouldn't suppress auto-heal for routers that have
    // genuine config issues elsewhere.
    const p9 = report.probes.find((p) => p.id === 'freeradiusAlive');
    expect(p9?.status).toBe('fail');
    expect(p9?.detail).toContain('timeout');
    expect(report.overall).toBe('degraded');
  });

  it('enforces the 30 s rate-limit by returning the cached report without re-running probes', async () => {
    // First run — forced, seeds all data for a healthy outcome
    primeLoadAndNas(mockRouterRow(), true);
    getPeerStatusMock.mockResolvedValueOnce({
      publicKey: 'pk-router',
      endpoint: '',
      allowedIps: '',
      latestHandshake: Math.floor(Date.now() / 1000) - 5,
      transferRx: 0,
      transferTx: 0,
    });
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));
    testConnectionMock.mockResolvedValueOnce(true);
    listHotspotServersMock.mockResolvedValue([
      { id: '*1', name: 'wasel-hotspot', interface: 'bridge', profile: 'default', disabled: false },
    ]);
    connectToRouterMock.mockImplementation(() =>
      Promise.resolve(connectStub((path) => {
        if (path === '/ip/hotspot/profile') return [{ name: 'default', 'use-radius': 'yes' }];
        if (path === '/radius') return [{ address: '10.10.0.1', service: 'hotspot', secret: 'x' }];
        if (path === '/ip/firewall/filter') return [
          { action: 'accept', protocol: 'udp', 'dst-port': '1812' },
          { action: 'accept', protocol: 'udp', 'dst-port': '3799' },
          { action: 'accept', protocol: 'udp', 'dst-port': '51820' },
        ];
        return [];
      })),
    );
    sendAccessRequestMock.mockResolvedValueOnce('reject');
    allowPersist();

    const firstReport = await runHealthCheck(USER_ID, ROUTER_ID, { force: true });
    expect(firstReport.overall).toBe('healthy');

    // Second run — within rate window, without force. The service loads the
    // router row again (one DB call) and returns last_health_report without
    // re-running any probes.
    const cachedRow = mockRouterRow({ last_health_report: firstReport });
    mockQuery.mockResolvedValueOnce({ rows: [cachedRow] });

    const secondReport = await runHealthCheck(USER_ID, ROUTER_ID);
    // Must return the same report, not run fresh probes
    expect(secondReport).toEqual(firstReport);
    // Confirm no extra probe DB calls fired (mockQuery should not have been
    // called beyond the single loadRouterForHealth SELECT)
    // getPeerStatusMock was already consumed; calling it again would fail
    expect(getPeerStatusMock).toHaveBeenCalledTimes(1);
  });
});
