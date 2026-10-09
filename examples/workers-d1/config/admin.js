module.exports = ({ env }) => ({
  serveAdminPanel: false,
  auth: { secret: env('ADMIN_JWT_SECRET', 'example-token') },
  apiToken: { salt: env('API_TOKEN_SALT', 'example-salt') },
  transferToken: { salt: env('TRANSFER_TOKEN_SALT', 'example-salt') },
  secrets: { encryptionKey: env('ENCRYPTION_KEY', 'example-key') },
});
