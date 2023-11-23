const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updateTransfers = require('./updateTransfers');
const addFieldsToResult = require('./addFieldsToResult');
const { TRANSFER_COLLECTION } = require('../../../utils/config');

module.exports = async (params = {}, cache_id) => {
  let output;
  const query = await generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(TRANSFER_COLLECTION, query, _params, undefined, cache_id);
  if (await updateTransfers(TRANSFER_COLLECTION, output?.data, params)) {
    output = await search(TRANSFER_COLLECTION, query, _params, 0.5 * 1000);
  }
  output = {
    ...output,
    data: addFieldsToResult(output?.data),
  };
  return output;
};