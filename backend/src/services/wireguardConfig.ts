import { lookup } from 'dns/promises';
import { config } from '../config';
import logger from '../config/logger';

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
 * Best-effort DNS check for the configured WG_SERVER_ENDPOINT host.
 *
 * If the host is a DNS name and does not resolve (typo, missing record, etc.)
 * this logs a WARN so the operator sees it in the boot log. It never throws
 * or blocks startup — a transient DNS outage must not prevent the API from
 * coming up. A bare IPv4/IPv6 literal simply resolves to itself.
 *
 * Called from server bootstrap alongside the other startup log lines.
 */
export async function verifyServerEndpointResolves(): Promise<void> {
  const raw = config.WG_SERVER_ENDPOINT;
  const { host } = parseEndpoint(raw);

  try {
    const result = await lookup(host);
    logger.info('WG_SERVER_ENDPOINT resolves', {
      host,
      address: result.address,
      family: result.family,
    });
  } catch (err) {
    logger.warn(
      'WG_SERVER_ENDPOINT DNS lookup failed — typo or missing record? (non-fatal, boot continues)',
      {
        host,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

/**
 * Parse a "host:port" endpoint string into its components.
 *
 * Handles three shapes:
 *   1. Bracketed IPv6:  "[2001:db8::1]:51820" → host "2001:db8::1", port "51820"
 *   2. host:port:       "wg.wa-sel.com:51820"  → host "wg.wa-sel.com", port "51820"
 *   3. host only:       "76.13.59.23"          → host "76.13.59.23", port "51820"
 *
 * The host is returned verbatim and passed straight into the RouterOS
 * `endpoint-address=` field, so DNS hostnames (recommended) work identically
 * to raw IPs — no IP-only assumption anywhere in this function.
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
 * Generate RouterOS CLI commands that configure WireGuard + RADIUS + hotspot +
 * firewall on a Mikrotik router. The operator pastes all 11 lines into a
 * Mikrotik terminal (SSH or Winbox terminal) in one shot — no Stage-2 push needed.
 *
 * service=hotspot,login is required on some RouterOS versions for the PPP/hotspot
 * login flow to route authentication requests to FreeRADIUS; `hotspot` alone is
 * insufficient on those builds.
 */
export function generateMikrotikConfig(params: {
  routerPrivateKey: string;
  routerTunnelIp: string; // e.g., "10.10.0.2"
  serverPublicKey: string;
  serverEndpoint: string; // e.g., "vpn.wasel.app:51820"
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string; // e.g., "10.10.0.1"
  apiPassword: string;
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

    // 4. Route the Wasel /16 through the tunnel — without this only the /30 pair is
    //    reachable; ping to ${params.radiusServerIp} fails even though the WG handshake succeeds.
    `/ip route add dst-address=10.10.0.0/16 gateway=wg-wasel`,

    // 5. RouterOS API user
    `/user add name=wasel_auto password="${params.apiPassword}" group=full comment="Wasel auto-provision — do not remove"`,

    // 6. Enable RouterOS API so the backend can read live sessions and run health probes
    `/ip service enable api`,

    // 7. RADIUS client — service=hotspot,login required on some ROS versions for hotspot
    //    login to route auth to FreeRADIUS; src-address ties the NAS-IP to the tunnel IP
    //    so FreeRADIUS matches the correct per-router shared secret.
    `/radius add service=hotspot,login address=${params.radiusServerIp} secret="${params.radiusSecret}" src-address=${params.routerTunnelIp} comment=wasel`,

    // 8. CoA listener — accept=yes lets FreeRADIUS disconnect sessions and push policy updates
    `/radius incoming set accept=yes port=3799`,

    // 9. Firewall — allow RADIUS auth from VPS
    `/ip firewall filter add chain=input action=accept protocol=udp src-address=${params.radiusServerIp} dst-port=1812 comment=wasel-radius-auth place-before=0`,

    // 10. Firewall — allow RADIUS CoA from VPS
    `/ip firewall filter add chain=input action=accept protocol=udp src-address=${params.radiusServerIp} dst-port=3799 comment=wasel-radius-coa place-before=1`,

    // 11. Firewall — allow WireGuard
    `/ip firewall filter add chain=input action=accept protocol=udp dst-port=51820 comment=wasel-wg place-before=2`,
  ];

  return lines.join('\n') + '\n';
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
  apiPassword: string;
}): string {
  const { host, port } = parseEndpoint(params.serverEndpoint);
  const network = deriveNetwork30(params.routerTunnelIp);

  const pskNote = params.presharedKey
    ? `\n   preshared-key="${params.presharedKey}" \\`
    : '';

  return `
================================================================================
  Wasel Setup Guide — ${params.routerName}
================================================================================

Open a terminal session on your router (SSH, Winbox terminal, or WebFig terminal)
and paste each command block below, or use the "Copy all commands" button to paste
everything at once.

Your tunnel IP : ${params.routerTunnelIp}
VPS endpoint   : ${params.serverEndpoint}

--------------------------------------------------------------------------------
STEP 1: Create the WireGuard interface
--------------------------------------------------------------------------------

  /interface wireguard add name=wg-wasel listen-port=51820 \\
     private-key="${params.routerPrivateKey}"

--------------------------------------------------------------------------------
STEP 2: Add the Wasel VPS as a WireGuard peer
--------------------------------------------------------------------------------
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

  /ip address add address=${toSubnet30(params.routerTunnelIp)} \\
     interface=wg-wasel network=${network}

--------------------------------------------------------------------------------
STEP 4: Route the Wasel subnet through the tunnel
--------------------------------------------------------------------------------
Without this route only the /30 pair is reachable — ping to the VPS tunnel IP
fails even though the WireGuard handshake succeeds.

  /ip route add dst-address=10.10.0.0/16 gateway=wg-wasel

--------------------------------------------------------------------------------
STEP 5: Create Wasel API user
--------------------------------------------------------------------------------
Wasel uses this user to read live session data and run health probes over the
tunnel. Keep it — deleting it stops Wasel from monitoring the router.

  /user add name=wasel_auto password="${params.apiPassword}" \\
     group=full comment="Wasel auto-provision — do not remove"

--------------------------------------------------------------------------------
STEP 6: Enable RouterOS API
--------------------------------------------------------------------------------

  /ip service enable api

--------------------------------------------------------------------------------
STEP 7: Add the RADIUS server
--------------------------------------------------------------------------------
service=hotspot,login is required on some RouterOS versions. src-address ties
this NAS to the correct per-router shared secret on the Wasel server.

  /radius add service=hotspot,login \\
     address=${params.radiusServerIp} \\
     secret="${params.radiusSecret}" \\
     src-address=${params.routerTunnelIp} \\
     comment=wasel

--------------------------------------------------------------------------------
STEP 8: Enable CoA listener
--------------------------------------------------------------------------------
Allows Wasel to disconnect voucher sessions and push policy updates.

  /radius incoming set accept=yes port=3799

--------------------------------------------------------------------------------
STEP 9: Firewall — allow RADIUS authentication traffic
--------------------------------------------------------------------------------

  /ip firewall filter add chain=input action=accept \\
     protocol=udp src-address=${params.radiusServerIp} \\
     dst-port=1812 comment=wasel-radius-auth place-before=0

--------------------------------------------------------------------------------
STEP 10: Firewall — allow RADIUS CoA traffic
--------------------------------------------------------------------------------

  /ip firewall filter add chain=input action=accept \\
     protocol=udp src-address=${params.radiusServerIp} \\
     dst-port=3799 comment=wasel-radius-coa place-before=1

--------------------------------------------------------------------------------
STEP 11: Firewall — allow WireGuard
--------------------------------------------------------------------------------

  /ip firewall filter add chain=input action=accept \\
     protocol=udp dst-port=51820 comment=wasel-wg place-before=2

--------------------------------------------------------------------------------
VERIFICATION
--------------------------------------------------------------------------------
After pasting, tap "Verify connection" in the app. You can also run:

  /radius print
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
 * Steps 1–6 bring the WireGuard tunnel up and create the API user so the
 * backend can run health probes and read live sessions.
 * Steps 7–11 configure RADIUS and firewall so voucher auth works immediately
 * after the operator pastes the script — no Stage-2 push required.
 * Hotspot RADIUS and MAC-cookie settings (formerly steps 9–10) are omitted here
 * because ensureHotspotRadiusSettings() applies them programmatically on connect.
 *
 * service=hotspot,login on step 7 is required on some RouterOS versions; using
 * only hotspot causes the login flow to not route auth requests to FreeRADIUS.
 */
export function generateSetupSteps(params: {
  routerPrivateKey: string;
  routerTunnelIp: string;
  serverPublicKey: string;
  serverEndpoint: string;
  presharedKey?: string;
  radiusSecret: string;
  radiusServerIp: string;
  apiPassword: string;
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
      description: 'Wasel uses this user to read live session data and run health probes over the tunnel. Keep it — deleting it stops Wasel from monitoring the router.',
      command: `/user add name=wasel_auto password="${params.apiPassword}" group=full comment="Wasel auto-provision — do not remove"`,
    },
    {
      step: 6,
      title: 'Enable RouterOS API',
      description: 'Allows Wasel to connect over the tunnel to read sessions and run health probes.',
      command: `/ip service enable api`,
    },
    {
      step: 7,
      title: 'Add the RADIUS server',
      description: 'Points your router at the Wasel RADIUS server for voucher authentication. service=hotspot,login is required on some RouterOS versions.',
      command: `/radius add service=hotspot,login address=${params.radiusServerIp} secret="${params.radiusSecret}" src-address=${params.routerTunnelIp} comment=wasel`,
    },
    {
      step: 8,
      title: 'Enable CoA listener',
      description: 'Allows Wasel to disconnect voucher sessions and push policy updates from the server side.',
      command: `/radius incoming set accept=yes port=3799`,
    },
    {
      step: 9,
      title: 'Firewall — allow RADIUS authentication traffic',
      description: 'Allows UDP port 1812 from the Wasel VPS so RADIUS authentication packets are not dropped.',
      command: `/ip firewall filter add chain=input action=accept protocol=udp src-address=${params.radiusServerIp} dst-port=1812 comment=wasel-radius-auth place-before=0`,
    },
    {
      step: 10,
      title: 'Firewall — allow RADIUS CoA traffic',
      description: 'Allows UDP port 3799 from the Wasel VPS so CoA disconnect and policy-push packets are not dropped.',
      command: `/ip firewall filter add chain=input action=accept protocol=udp src-address=${params.radiusServerIp} dst-port=3799 comment=wasel-radius-coa place-before=1`,
    },
    {
      step: 11,
      title: 'Firewall — allow WireGuard',
      description: 'Allows UDP port 51820 so the WireGuard tunnel can be established even if the default firewall has a drop rule.',
      command: `/ip firewall filter add chain=input action=accept protocol=udp dst-port=51820 comment=wasel-wg place-before=2`,
    },
  ];
}
