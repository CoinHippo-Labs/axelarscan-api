const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updateUnwraps = require('./updateUnwraps');
const { UNWRAP_COLLECTION } = require('../../../../utils/config');

module.exports = async (params = {}) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(UNWRAP_COLLECTION, query, _params);
  if (await updateUnwraps(UNWRAP_COLLECTION, output?.data, params)) {
    output = await search(UNWRAP_COLLECTION, query, _params, 0.5 * 1000);
  }

  return output;
};