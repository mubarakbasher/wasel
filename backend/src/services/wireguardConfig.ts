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
}): string {
  const { host, port } = parseEndpoint(params.serverEndpoint);
  const network = deriveNetwork30(params.routerTunnelIp);

  const pskNote = params.presharedKey
    ? `\n   preshared-key="${params.presharedKey}" \\`
    : '';
  const pskCmd = params.presharedKey
    ? ` preshared-key="${params.presharedKey}"`
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
RADIUS server  : ${params.radiusServerIp}

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
tunnel IP (${params.radiusServerIp}) even though the handshake succeeds.

  /ip route add dst-address=10.10.0.0/16 gateway=wg-wasel

--------------------------------------------------------------------------------
STEP 5: Configure RADIUS authentication
--------------------------------------------------------------------------------
This points the router's hotspot to the Wasel RADIUS server on the VPN.

  /radius add service=hotspot address=${params.radiusServerIp} \\
     secret="${params.radiusSecret}"

--------------------------------------------------------------------------------
STEP 6: Enable RADIUS on the hotspot profile
--------------------------------------------------------------------------------
This tells the hotspot to authenticate users via RADIUS instead of local users.

  /ip hotspot profile set default use-radius=yes \\
     radius-default-domain=""

--------------------------------------------------------------------------------
STEP 7: Add firewall rules for RADIUS and WireGuard traffic
--------------------------------------------------------------------------------
These rules ensure the router accepts RADIUS and WireGuard packets.
They are placed at the top of the input chain so they are evaluated first.

  /ip firewall filter add chain=input protocol=udp \\
     src-address=${params.radiusServerIp} dst-port=1812,1813 \\
     action=accept comment="Allow RADIUS auth/acct from Wasel VPS" place-before=0

  /ip firewall filter add chain=input protocol=udp \\
     src-address=${params.radiusServerIp} dst-port=3799 \\
     action=accept comment="Allow RADIUS CoA from Wasel VPS" place-before=1

  /ip firewall filter add chain=input protocol=udp dst-port=51820 \\
     action=accept comment="Allow WireGuard" place-before=2

--------------------------------------------------------------------------------
VERIFICATION
--------------------------------------------------------------------------------
After running all commands, verify the tunnel is up:

  /interface wireguard peers print
  /ping ${params.radiusServerIp} count=4

You should see handshake activity and successful pings to the VPS tunnel IP.

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
 * After these 4 commands, the rest is configured automatically over the tunnel.
 *
 * Steps 1-4 bring the WireGuard tunnel up so Wasel can reach the router API.
 * Steps 5-6 are verification — confirm the tunnel is active and responsive.
 * RADIUS, CoA, hotspot profile, and firewall rules are applied automatically
 * once the tunnel is detected.
 */
export function generateSetupSteps(params: {
  routerPrivateKey: string;
  routerTunnelIp: string;
  serverPublicKey: string;
  serverEndpoint: string;
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string;
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
      title: 'Verify the tunnel',
      description: 'Check that the WireGuard peer is active and the handshake is recent. Wasel will auto-configure RADIUS, hotspot, and firewall once this is seen.',
      command: `/interface wireguard peers print`,
    },
    {
      step: 6,
      title: 'Ping the VPS',
      description: 'You should see successful replies confirming the tunnel is working. Everything else is configured automatically.',
      command: `/ping ${params.radiusServerIp} count=4`,
    },
  ];
}
