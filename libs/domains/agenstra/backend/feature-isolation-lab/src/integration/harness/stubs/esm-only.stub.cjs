// Stand-in for ESM-only packages pulled in by library barrels (e.g. Decabill's export features) that the
// isolation lab never executes; Jest's CommonJS runtime cannot load them.
module.exports = new Proxy(function stub() {}, { get: () => stub });
function stub() {}
