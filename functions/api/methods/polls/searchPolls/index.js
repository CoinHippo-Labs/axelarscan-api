const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updatePolls = require('./updatePolls');
const addFieldsToResult = require('./addFieldsToResult');
const normalizeResult = require('./normalizeResult');
const { POLL_COLLECTION } = require('../../../utils/config');

module.exports = async (params = {}) => {
  let output;
  const query = await generateQuery(params);
  const _params = generateReadParams(params);
  // search data
  output = await search(POLL_COLLECTION, query, _params);
  // if (await updatePolls(POLL_COLLECTION, output?.data, params)) {
  //   output = await search(POLL_COLLECTION, query, _params, 0.5 * 1000);
  // }
  output = {
    ...output,
    data: addFieldsToResult(output?.data),
  };
  output = normalizeResult(output);
  return output;
};