const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const normalizeResult = require('./normalizeResult');
const {
  BLOCK_COLLECTION,
} = require('../../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);

  // search data
  output = await search(BLOCK_COLLECTION, query, _params);

  output = {
    ...output,
    data: normalizeResult(output?.data),
  };

  return output;
};