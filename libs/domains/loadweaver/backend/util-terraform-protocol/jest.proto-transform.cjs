const { createHash } = require('node:crypto');

/** Jest: a `.proto` import yields its source text, like the webpack `asset/source` rule of the provider app. */
module.exports = {
  process(sourceText) {
    return {
      code: `module.exports = { __esModule: true, default: ${JSON.stringify(sourceText)} };`,
    };
  },
  getCacheKey(sourceText, sourcePath) {
    return createHash('sha256')
      .update('loadweaver-proto-source-1')
      .update(sourcePath)
      .update(sourceText)
      .digest('hex');
  },
};
