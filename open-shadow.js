// Must load before Polaris. Polaris may create closed shadow roots, which hide each component's
// internals from other scripts, so the measuring and export scripts would only see empty hosts.
// Forcing them open changes nothing visually; it only makes the rendered internals readable.
(function () {
  var attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attach.call(this, Object.assign({}, init, { mode: 'open' }));
  };
})();
