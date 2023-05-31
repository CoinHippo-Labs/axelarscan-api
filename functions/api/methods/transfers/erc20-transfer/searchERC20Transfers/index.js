const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updateERC20Transfers = require('./updateERC20Transfers');
const { ERC20_TRANSFER_COLLECTION } = require('../../../../utils/config');

module.exports = async (params = {}) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(ERC20_TRANSFER_COLLECTION, query, _params);
  if (await updateERC20Transfers(ERC20_TRANSFER_COLLECTION, output?.data, params)) {
    output = await search(ERC20_TRANSFER_COLLECTION, query, _params, 0.5 * 1000);
  }

  return output;
};