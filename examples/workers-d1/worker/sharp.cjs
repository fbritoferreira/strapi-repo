// sharp is a native addon. Boot-time settings are accepted; processing an image
// fails loudly until an images adapter (WASM, Cloudflare Images) replaces it.
function sharp() {
  throw new Error(
    'Image processing is not available in the Worker build (sharp is a native addon)'
  );
}
sharp.cache = () => {};
sharp.concurrency = () => {};
sharp.simd = () => false;
sharp.format = {};
sharp.versions = {};

module.exports = sharp;
