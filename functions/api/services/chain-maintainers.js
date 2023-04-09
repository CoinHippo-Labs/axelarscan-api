const config = require('config-yml');
const lcd = require('./lcd');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../data')?.chains?.[environment]?.evm || [];

module.exports = async (
  params = {},
) => {
  let response;

  const {
    chain,
    height,
  } = { ...params };

  if (evm_chains_data.findIndex(c => c?.maintainer_id === chain) > -1) {
    const valid_height = Number.isInteger(height) && height > 0;

    const _response = await lcd(`/axelar/nexus/v1beta1/chain_maintainers/${chain}`);

    const {
      maintainers,
    } = { ..._response };

    if (maintainers) {
      response = {
        maintainers,
      };
    }
  }

  return response;
};