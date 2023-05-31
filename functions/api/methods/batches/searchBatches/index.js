const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updateBatches = require('./updateBatches');
const normalizeResult = require('./normalizeResult');
const { BATCH_COLLECTION } = require('../../../utils/config');

module.exports = async (params = {}) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(BATCH_COLLECTION, query, _params);
  if (await updateBatches(output?.data)) {
    output = await search(BATCH_COLLECTION, query, _params, 0.5 * 1000);
  }
  output = normalizeResult(output);

  return output;
};