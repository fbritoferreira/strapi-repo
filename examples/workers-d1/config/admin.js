module.exports = ({ env }) => ({
  // the admin panel is built separately and served by its own Worker (wrangler.admin.jsonc)
  serveAdminPanel: false,
  url: env('ADMIN_URL', 'http://127.0.0.1:8788/admin'),
  auth: { secret: env('ADMIN_JWT_SECRET', 'example-token') },
  apiToken: { salt: env('API_TOKEN_SALT', 'example-salt') },
  transfer: { token: { salt: env('TRANSFER_TOKEN_SALT', 'example-salt') } },
  secrets: { encryptionKey: env('ENCRYPTION_KEY', 'example-key') },
});
