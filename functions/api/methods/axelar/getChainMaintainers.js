const lcd = require('../lcd');
const {
  getChainData,
} = require('../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;

  const {
    chain,
  } = { ...params };

  const {
    maintainer_id,
  } = { ...getChainData(chain, 'evm') };

  if (maintainer_id) {
    const {
      maintainers,
    } = { ...await lcd(`/axelar/nexus/v1beta1/chain_maintainers/${maintainer_id}`, { index: true }) };

    if (maintainers) {
      output = { maintainers };
    }
  }

  return output;
};