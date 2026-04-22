import { config } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeerConfig {
  publicKey: string;
  presharedKey?: string;
  allowedIps: string; // e.g., "10.10.0.2/32"
  endpoint?: string; // router's public IP if known
}

interface ServerInterfaceConfig {
  privateKey: string;
  address: string; // e.g., "10.10.0.1/16"
  listenPort: number;
  peers: PeerConfig[];
}

// ---------------------------------------------------------------------------
// Server-side helpers
// ---------------------------------------------------------------------------

/**
 * Generate a single [Peer] block for inclusion in the VPS wg0.conf.
 * Used when a new router is registered.
 */
export function generateServerPeerBlock(params: {
  routerPublicKey: string;
  routerTunnelIp: string; // e.g., "10.10.0.2"
  presharedKey?: string;
  comment?: string;
}): string {
  const lines: string[] = [];

  lines.push('[Peer]');
  if (params.comment) {
    lines.push(`# Router: ${params.comment}`);
  }
  lines.push(`PublicKey = ${params.routerPublicKey}`);
  if (params.presharedKey) {
    lines.push(`PresharedKey = ${params.presharedKey}`);
  }
  lines.push(`AllowedIPs = ${params.routerTunnelIp}/32`);

  return lines.join('\n');
}

interface ServerPeerInput {
  routerPublicKey: string;
  routerTunnelIp: string;
  presharedKey?: string;
  comment?: string;
}

/**
 * Generate a complete wg0.conf for the VPS WireGuard server, including the
 * server private key. Used for initial bootstrap or full config regeneration
 * on the VPS itself.
 *
 * Contains the server private key; treat as SECRET. Never log the return value
 * or expose it to admin/display endpoints — use generateSafeServerConfig for that.
 */
export function generateBootstrapServerConfig(peers: Array<ServerPeerInput>): string {
  const interfaceBlock = [
    '[Interface]',
    `PrivateKey = ${config.WG_SERVER_PRIVATE_KEY}`,
    `Address = 10.10.0.1/16`,
    `ListenPort = ${config.WG_SERVER_PORT}`,
  ].join('\n');

  const peerBlocks = peers.map((peer) => generateServerPeerBlock(peer));

  return [interfaceBlock, '', ...peerBlocks].join('\n') + '\n';
}

/**
 * Generate the same wg0.conf shape as generateBootstrapServerConfig but with
 * the server private key redacted. Safe for logging, admin preview, or sending
 * to operator-facing UIs.
 */
export function generateSafeServerConfig(peers: Array<ServerPeerInput>): string {
  const interfaceBlock = [
    '[Interface]',
    `# PrivateKey = <redacted>`,
    `Address = 10.10.0.1/16`,
    `ListenPort = ${config.WG_SERVER_PORT}`,
  ].join('\n');

  const peerBlocks = peers.map((peer) => generateServerPeerBlock(peer));

  return [interfaceBlock, '', ...peerBlocks].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Mikrotik RouterOS helpers
// ---------------------------------------------------------------------------

/**
 * Parse a "host:port" endpoint string into its components.
 */
function parseEndpoint(endpoint: string): { host: string; port: string } {
  // Handle IPv6 in brackets, e.g. [::1]:51820
  const bracketMatch = endpoint.match(/^\[(.+)]:(\d+)$/);
  if (bracketMatch) {
    return { host: bracketMatch[1], port: bracketMatch[2] };
  }
  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: endpoint, port: '51820' };
  }
  return {
    host: endpoint.substring(0, lastColon),
    port: endpoint.substring(lastColon + 1),
  };
}

/**
 * Derive the /30 network address from a tunnel IP.
 * E.g., 10.10.0.2 -> 10.10.0.2/30
 */
function toSubnet30(ip: string): string {
  return `${ip}/30`;
}

/**
 * Generate RouterOS CLI commands that configure WireGuard + RADIUS on a Mikrotik router.
 * The operator pastes these into a Mikrotik terminal (SSH or Winbox terminal).
 */
export function generateMikrotikConfig(params: {
  routerPrivateKey: string;
  routerTunnelIp: string; // e.g., "10.10.0.2"
  serverPublicKey: string;
  serverEndpoint: string; // e.g., "vpn.wasel.app:51820"
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string; // e.g., "10.10.0.1"
}): string {
  const { host, port } = parseEndpoint(params.serverEndpoint);

  const pskPart = params.presharedKey
    ? ` preshared-key="${params.presharedKey}"`
    : '';

  const lines: string[] = [
    // 1. WireGuard interface
    `/interface wireguard add name=wg-wasel listen-port=51820 private-key="${params.routerPrivateKey}"`,

    // 2. WireGuard peer (VPS)
    `/interface wireguard peers add interface=wg-wasel public-key="${params.serverPublicKey}" endpoint-address=${host} endpoint-port=${port} allowed-address=10.10.0.0/16 persistent-keepalive=25s${pskPart}`,

    // 3. IP address on WireGuard interface (/30)
    `/ip address add address=${toSubnet30(params.routerTunnelIp)} interface=wg-wasel network=${deriveNetwork30(params.routerTunnelIp)}`,

    // 4. Route the Wasel /16 through the tunnel — without this only the /30 pair is reachable,
    //    so ping to ${params.radiusServerIp} fails even though the WG handshake succeeds.
    `/ip route add dst-address=10.10.0.0/16 gateway=wg-wasel`,

    // 5. RADIUS server pointing to VPS tunnel IP
    `/radius add service=hotspot address=${params.radiusServerIp} secret="${params.radiusSecret}"`,

    // 6. Hotspot profile to use RADIUS
    `/ip hotspot profile set default use-radius=yes radius-default-domain=""`,

    // 7. Firewall rules — allow RADIUS traffic over WireGuard
    `/ip firewall filter add chain=input protocol=udp src-address=${params.radiusServerIp} dst-port=1812,1813 action=accept comment="Allow RADIUS auth/acct from Wasel VPS" place-before=0`,
    `/ip firewall filter add chain=input protocol=udp src-address=${params.radiusServerIp} dst-port=3799 action=accept comment="Allow RADIUS CoA from Wasel VPS" place-before=1`,
    `/ip firewall filter add chain=input protocol=udp dst-port=51820 action=accept comment="Allow WireGuard" place-before=2`,
  ];

  return lines.join('\n') + '\n';
}

/**
 * Derive the network address for a /30 subnet.
 * In a /30 the network is the address with the lowest 2 bits cleared.
 * E.g., 10.10.0.2 -> 10.10.0.0, 10.10.0.5 -> 10.10.0.4
 */
function deriveNetwork30(ip: string): string {
  const octets = ip.split('.').map(Number);
  octets[3] = octets[3] & 0xfc; // clear lowest 2 bits
  return octets.join('.');
}

/**
 * Generate a human-readable setup guide with RouterOS commands and explanations.
 * Intended to be displayed in the mobile app or sent to the operator.
 */
export function generateMikrotikConfigText(params: {
  routerName: string;
  routerPrivateKey: string;
  routerTunnelIp: string;
  serverPublicKey: string;
  serverEndpoint: string;
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string;
  // NEW — embedded in the generated script
  apiPassword: string;
  callbackUrl: string;
}): string {
  const { host, port } = parseEndpoint(params.serverEndpoint);
  const network = deriveNetwork30(params.routerTunnelIp);

  const pskNote = params.presharedKey
    ? `\n   preshared-key="${params.presharedKey}" \\`
    : '';

  return `
================================================================================
  Wasel WireGuard Setup Guide — ${params.routerName}
================================================================================

Follow these steps to connect your Mikrotik router to the Wasel VPN.
Open a terminal session on your router (SSH, Winbox terminal, or WebFig terminal)
and paste each command block below.

Your tunnel IP : ${params.routerTunnelIp}
VPS endpoint   : ${params.serverEndpoint}

--------------------------------------------------------------------------------
STEP 1: Create the WireGuard interface
--------------------------------------------------------------------------------
This creates a new WireGuard interface named "wg-wasel" on your router.

  /interface wireguard add name=wg-wasel listen-port=51820 \\
     private-key="${params.routerPrivateKey}"

--------------------------------------------------------------------------------
STEP 2: Add the Wasel VPS as a WireGuard peer
--------------------------------------------------------------------------------
This tells your router how to reach the Wasel VPS through the encrypted tunnel.
The persistent-keepalive ensures the tunnel stays up even behind NAT.

  /interface wireguard peers add interface=wg-wasel \\
     public-key="${params.serverPublicKey}" \\
     endpoint-address=${host} \\
     endpoint-port=${port} \\
     allowed-address=10.10.0.0/16 \\
     persistent-keepalive=25s${pskNote}

--------------------------------------------------------------------------------
STEP 3: Assign the tunnel IP address
--------------------------------------------------------------------------------
This gives your router its unique address on the VPN.

  /ip address add address=${toSubnet30(params.routerTunnelIp)} \\
     interface=wg-wasel network=${network}

--------------------------------------------------------------------------------
STEP 4: Route the Wasel subnet through the tunnel
--------------------------------------------------------------------------------
Without this route, only the /30 pair is reachable — you cannot reach the VPS
tunnel IP even though the handshake succeeds.

  /ip route add dst-address=10.10.0.0/16 gateway=wg-wasel

--------------------------------------------------------------------------------
STEP 5: Create Wasel API user
--------------------------------------------------------------------------------
Wasel uses this user to auto-configure RADIUS, firewall, and hotspot over the
tunnel. Keep it — deleting it stops Wasel from managing the router.

  /user add name=wasel_auto password="${params.apiPassword}" \\
     group=full comment="Wasel auto-provision — do not remove"

--------------------------------------------------------------------------------
STEP 6: Enable RouterOS API
--------------------------------------------------------------------------------
Allows Wasel to connect over the tunnel to finish setup automatically.

  /ip service enable api

--------------------------------------------------------------------------------
STEP 7: Notify Wasel
--------------------------------------------------------------------------------
Last step — pings Wasel over the tunnel so the app finalizes setup.
You should see the checklist go green right after this runs.

  /tool fetch url="${params.callbackUrl}" keep-result=no

--------------------------------------------------------------------------------
VERIFICATION
--------------------------------------------------------------------------------
Wasel should show a green checklist within seconds. If not, run the following
commands manually to diagnose the tunnel:

  /interface wireguard peers print
  /ping ${params.radiusServerIp} count=4

================================================================================
`.trimStart();
}

// ---------------------------------------------------------------------------
// Structured setup steps (for mobile step-by-step UI)
// ---------------------------------------------------------------------------

export interface SetupStep {
  step: number;
  title: string;
  description: string;
  command: string;
}

/**
 * Generate structured setup steps for the mobile app UI.
 *
 * Steps 1-4 bring the WireGuard tunnel up so Wasel can reach the router API.
 * Step 5 creates the wasel_auto RouterOS user that the backend logs in as.
 * Step 6 enables the RouterOS API service over the tunnel.
 * Step 7 fires the callback URL so the backend finalizes provisioning immediately.
 *
 * RADIUS, CoA, hotspot profile, and firewall rules are applied automatically
 * by the backend once the callback is received (or by the fallback poller).
 */
export function generateSetupSteps(params: {
  routerPrivateKey: string;
  routerTunnelIp: string;
  serverPublicKey: string;
  serverEndpoint: string;
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string;
  // NEW — embedded in the generated script
  apiPassword: string;
  callbackUrl: string;
}): SetupStep[] {
  const { host, port } = parseEndpoint(params.serverEndpoint);
  const network = deriveNetwork30(params.routerTunnelIp);

  const pskPart = params.presharedKey
    ? ` preshared-key="${params.presharedKey}"`
    : '';

  return [
    {
      step: 1,
      title: 'Create the WireGuard interface',
      description: 'Creates a new WireGuard interface named "wg-wasel" on your router.',
      command: `/interface wireguard add name=wg-wasel listen-port=51820 private-key="${params.routerPrivateKey}"`,
    },
    {
      step: 2,
      title: 'Add the Wasel VPS as a WireGuard peer',
      description: 'Tells your router how to reach the Wasel VPS through the encrypted tunnel. The persistent-keepalive ensures the tunnel stays up even behind NAT.',
      command: `/interface wireguard peers add interface=wg-wasel public-key="${params.serverPublicKey}" endpoint-address=${host} endpoint-port=${port} allowed-address=10.10.0.0/16 persistent-keepalive=25s${pskPart}`,
    },
    {
      step: 3,
      title: 'Assign the tunnel IP address',
      description: 'Gives your router its unique address on the VPN.',
      command: `/ip address add address=${toSubnet30(params.routerTunnelIp)} interface=wg-wasel network=${network}`,
    },
    {
      step: 4,
      title: 'Route the Wasel subnet through the tunnel',
      description: `Without this route only the /30 pair is reachable; ping to ${params.radiusServerIp} would fail even though the handshake succeeds.`,
      command: `/ip route add dst-address=10.10.0.0/16 gateway=wg-wasel`,
    },
    {
      step: 5,
      title: 'Create Wasel API user',
      description: 'Wasel uses this user to auto-configure RADIUS, firewall, and hotspot over the tunnel. Keep it — deleting it stops Wasel from managing the router.',
      command: `/user add name=wasel_auto password="${params.apiPassword}" group=full comment="Wasel auto-provision — do not remove"`,
    },
    {
      step: 6,
      title: 'Enable RouterOS API',
      description: 'Allows Wasel to connect over the tunnel to finish setup automatically.',
      command: `/ip service enable api`,
    },
    {
      step: 7,
      title: 'Notify Wasel',
      description: 'Last step — pings Wasel over the tunnel so the app finalizes setup. You should see the checklist go green right after this runs.',
      command: `/tool fetch url="${params.callbackUrl}" keep-result=no`,
    },
  ];
}
