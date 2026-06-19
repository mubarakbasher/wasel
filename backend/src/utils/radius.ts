/** True if an Acct-Session-Id from radacct contains only safe chars (defense-in-depth before forwarding to radclient). */
export function isSafeAcctSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}
