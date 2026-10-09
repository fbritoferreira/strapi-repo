const { factories } = require('@strapi/strapi');

// public for the demo; a real app would use API tokens or users-permissions
const open = { auth: false };

module.exports = factories.createCoreRouter('api::article.article', {
  config: { find: open, findOne: open, create: open, update: open, delete: open },
});
