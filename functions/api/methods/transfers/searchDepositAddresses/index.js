const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const { DEPOSIT_ADDRESS_COLLECTION } = require('../../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;
  const query = generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(DEPOSIT_ADDRESS_COLLECTION, query, _params);
  return output;
};