// Stands in for Node-only packages (TypeScript compiler, sharp) that Strapi
// imports but does not call when serving requests from a Worker.
const stub = new Proxy(function stub() {}, {
  get: (target, key) => (key === '__esModule' ? false : stub),
  apply: () => {
    throw new Error('This Node-only module is not available in the Worker build');
  },
});

module.exports = stub;
