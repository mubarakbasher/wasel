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

/**
 * Generate a complete wg0.conf for the VPS WireGuard server.
 * Used for initial setup or full config regeneration.
 */
export function generateFullServerConfig(
  peers: Array<{
    routerPublicKey: string;
    routerTunnelIp: string;
    presharedKey?: string;
    comment?: string;
  }>
): string {
  const interfaceBlock = [
    '[Interface]',
    `PrivateKey = ${config.WG_SERVER_PRIVATE_KEY}`,
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

    // 4. RADIUS server pointing to VPS tunnel IP
    `/radius add service=hotspot address=${params.radiusServerIp} secret="${params.radiusSecret}"`,

    // 5. Hotspot profile to use RADIUS
    `/ip hotspot profile set default use-radius=yes radius-default-domain=""`,

    // 6. Firewall rules — allow RADIUS traffic over WireGuard
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
STEP 4: Configure RADIUS authentication
--------------------------------------------------------------------------------
This points the router's hotspot to the Wasel RADIUS server on the VPN.

  /radius add service=hotspot address=${params.radiusServerIp} \\
     secret="${params.radiusSecret}"

--------------------------------------------------------------------------------
STEP 5: Enable RADIUS on the hotspot profile
--------------------------------------------------------------------------------
This tells the hotspot to authenticate users via RADIUS instead of local users.

  /ip hotspot profile set default use-radius=yes \\
     radius-default-domain=""

--------------------------------------------------------------------------------
STEP 6: Add firewall rules for RADIUS and WireGuard traffic
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
