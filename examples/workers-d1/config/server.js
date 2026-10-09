module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // the API Worker's public URL; the admin build calls it from another origin
  url: env('PUBLIC_URL', 'http://127.0.0.1:8787'),
  app: {
    keys: env.array('APP_KEYS', ['toBeModified1', 'toBeModified2']),
  },
});
