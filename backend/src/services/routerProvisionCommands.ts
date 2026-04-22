/**
 * routerProvisionCommands.ts
 *
 * Pure functions that return declarative RouterOS command descriptors.
 * No I/O, no side-effects — easy to unit-test without a live router.
 * The apply layer in routerOs.service.ts consumes these objects.
 */

// ---------------------------------------------------------------------------
// Descriptor types
// ---------------------------------------------------------------------------

export interface UpsertCommand {
  type: 'upsert';
  menu: string;
  commentTag: string;
  desired: Record<string, string>;
}

export interface SingletonCommand {
  type: 'singleton';
  menu: string;
  matcher: Record<string, string>;
  args: Record<string, string>;
}

export interface AddCommand {
  type: 'add';
  menu: string;
  args: Record<string, string>;
}

export type ProvisionCommand = UpsertCommand | SingletonCommand | AddCommand;

// ---------------------------------------------------------------------------
// Stage-2 command builders
// ---------------------------------------------------------------------------

/**
 * /radius entry — idempotent via comment='wasel'.
 * Never matches by address so third-party RADIUS entries are protected.
 */
export function radiusClientCommand(params: {
  radiusServerIp: string;
  radiusSecret: string;
  tunnelIp: string;
}): UpsertCommand {
  return {
    type: 'upsert',
    menu: '/radius',
    commentTag: 'wasel',
    desired: {
      service: 'hotspot,login',
      address: params.radiusServerIp,
      secret: params.radiusSecret,
      'src-address': params.tunnelIp,
      comment: 'wasel',
    },
  };
}

/**
 * /radius/incoming singleton — set accept=yes, port=3799 on the single entry.
 * RouterOS always has exactly one /radius/incoming entry.
 */
export function coaListenerCommand(): SingletonCommand {
  return {
    type: 'singleton',
    menu: '/radius/incoming',
    matcher: {},   // no filter needed — there is always exactly one entry
    args: {
      accept: 'yes',
      port: '3799',
    },
  };
}

/**
 * /ip/hotspot/profile set default — enable RADIUS auth and interim updates.
 * nas-port-type is omitted; the router's default is correct for hotspot.
 */
export function hotspotProfileCommand(): SingletonCommand {
  return {
    type: 'singleton',
    menu: '/ip/hotspot/profile',
    matcher: { name: 'default' },
    args: {
      'use-radius': 'yes',
      'radius-interim-update': 'received',
    },
  };
}

/**
 * /ip/hotspot/user/profile set default — safe timing defaults.
 * Real per-user limits still come from RADIUS reply attributes.
 */
export function hotspotUserProfileDefaultsCommand(): SingletonCommand {
  return {
    type: 'singleton',
    menu: '/ip/hotspot/user/profile',
    matcher: { name: 'default' },
    args: {
      'idle-timeout': '5m',
      'keepalive-timeout': '2m',
    },
  };
}

/**
 * /ip/firewall/filter — allow RADIUS auth/accounting from Wasel VPS (UDP 1812).
 */
export function firewallRadiusAuthCommand(params: {
  radiusServerIp: string;
}): UpsertCommand {
  return {
    type: 'upsert',
    menu: '/ip/firewall/filter',
    commentTag: 'wasel-radius-auth',
    desired: {
      chain: 'input',
      action: 'accept',
      protocol: 'udp',
      'src-address': params.radiusServerIp,
      'dst-port': '1812',
      comment: 'wasel-radius-auth',
    },
  };
}

/**
 * /ip/firewall/filter — allow RADIUS CoA from Wasel VPS (UDP 3799).
 */
export function firewallRadiusCoaCommand(params: {
  radiusServerIp: string;
}): UpsertCommand {
  return {
    type: 'upsert',
    menu: '/ip/firewall/filter',
    commentTag: 'wasel-radius-coa',
    desired: {
      chain: 'input',
      action: 'accept',
      protocol: 'udp',
      'src-address': params.radiusServerIp,
      'dst-port': '3799',
      comment: 'wasel-radius-coa',
    },
  };
}

/**
 * /ip/firewall/filter — allow WireGuard (UDP 51820).
 */
export function firewallWgCommand(): UpsertCommand {
  return {
    type: 'upsert',
    menu: '/ip/firewall/filter',
    commentTag: 'wasel-wg',
    desired: {
      chain: 'input',
      action: 'accept',
      protocol: 'udp',
      'dst-port': '51820',
      comment: 'wasel-wg',
    },
  };
}

