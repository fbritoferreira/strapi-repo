// Workers forbid new Function, which depd uses to wrap deprecated functions.
// Same API, but deprecated calls pass straight through without a warning.
module.exports = function depd() {
  function deprecate() {}
  deprecate.function = (fn) => fn;
  deprecate.property = () => {};
  return deprecate;
};
