# Hotspot re-login troubleshooting — "customers must retype the voucher"

Use this when an operator says returning customers are asked for their voucher again after leaving and rejoining the Wi-Fi.

Written 2026-10-08 after a live investigation on the staging router and the prod router `alzarg.net`.

## How auto re-login works

After a customer's first successful voucher login, RouterOS saves a **MAC cookie**: the voucher code tied to the phone's MAC address. When the same phone comes back, the router logs it in automatically with that cookie.

That automatic login still sends a fresh RADIUS Access-Request to Wasel. A disabled or expired voucher is therefore still rejected.

Auto re-login needs **both** of these:

| Where | Setting | Correct value |
|---|---|---|
| Hotspot **server** profile, the one the hotspot server actually uses (often `hsprof1`, not `default`) | `login-by` | includes `mac-cookie` |
| Hotspot **user** profile `default` (every Wasel/RADIUS voucher lands here) | `add-mac-cookie` / `mac-cookie-timeout` | `yes` / non-zero (Wasel uses `30d`) |

Wasel repairs these settings automatically when they're missing. The repair adds `mac-cookie` and keeps the operator's other login methods and longer timeouts. It runs:

- from the router health check
- from login-page (template) apply
- from a daily background sweep of online routers (`macCookieConvergence` job, 03:30 server time)

Routers onboarded with the 2026-04-25 → ~07-20 setup script had MAC cookies switched **off** on purpose (`add-mac-cookie=no mac-cookie-timeout=0s`). They converge on the first sweep after the fix is deployed.

## Read-only diagnosis (operator pastes into Winbox → New Terminal)

Ask the operator for the **voucher code** of a customer who was asked again, then run:

```
/ip hotspot print detail
/ip hotspot profile print detail
/ip hotspot user profile print detail
/ip hotspot cookie print
/log print where topics~"hotspot|radius"
/interface wireguard peers print detail
```

To find the phone's MAC address: `/ip hotspot host print`, `/ip hotspot active print`, or the cookie list.

## Decision table

| What you see | Cause | Action |
|---|---|---|
| The server's profile `login-by` has no `mac-cookie`, or `add-mac-cookie=no` / `mac-cookie-timeout=0s` | Setting missing | Run the router health check in the app; it repairs it. Or wait for the daily sweep. |
| The voucher has an **M** cookie, the log shows `trying to log in by mac-cookie` followed by a failure such as `RADIUS server is not responding` | Wasel RADIUS unreachable or slow at that moment: tunnel down after a power cut, or a RADIUS incident | Check WireGuard `last-handshake` and the FreeRADIUS monitor. Not a router setting. |
| The voucher has an **M** cookie, but the phone came back with a **different MAC** | The phone randomises its MAC: iPhone "Rotate Wi-Fi Address", Android "non-persistent" randomisation, or "Forget network" and rejoin | Not router-fixable. Tell the customer to set Private/Random MAC to **Fixed** / "Use device MAC" for this network. |
| The code isn't a Wasel voucher (operator's local card, e.g. profiles `1D` / `8H` from another tool) | Local cards are outside Wasel | Out of Wasel's control. Those cards get no MAC cookie in this setup. |
| The voucher has no M cookie, only a browser cookie | The phone logged in by browser cookie only, or the MAC cookie was never created | Check the settings above; if they're correct, collect the log line from the next occurrence. |

Facts confirmed on `alzarg.net` (RouterOS 7.22.3), 2026-10-08:

- Wasel vouchers re-logged in automatically after a 5-minute-plus Wi-Fi drop and after a full power-off.
- The MAC cookie survives a reboot.

## Make the log survive reboots (optional; operator's choice, this is a config change)

RouterOS keeps logs in memory, so a power cut erases the evidence. To keep hotspot and RADIUS logs on disk:

```
/system logging action set disk disk-file-name=hslog disk-lines-per-file=5000
/system logging add topics=hotspot action=disk
/system logging add topics=radius action=disk
```

Read them back with `/log print where topics~"hotspot|radius"`, or download `hslog.*.txt` from Files.
