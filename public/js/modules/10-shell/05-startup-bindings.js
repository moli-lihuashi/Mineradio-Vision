// Startup bindings fragment — QQ VIP force recheck on boot.
// Invoked from 01-splash-and-boot.js via bootstrapStartupLoginStatus().
function ensureStartupQQVipRecheck() {
  if (typeof refreshQQLoginStatus !== 'function') return Promise.resolve(null);
  return refreshQQLoginStatus({ forceVip: true, reason: 'startup' });
}
