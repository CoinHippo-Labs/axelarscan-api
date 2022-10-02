const config = require('config-yml');
const cli = require('./cli');
const {
  to_json,
} = require('../utils');

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
    const valid_height = Number.isInteger(height) &&
      height > 0;

    const _response = await cli(
      undefined,
      {
        cmd: `axelard q nexus chain-maintainers ${chain} ${valid_height ? `--height ${height} ` : ''}-oj`,
        cache: true,
        cache_timeout: 30,
      },
    );

    const {
      maintainers,
    } = { ...to_json(_response?.stdout) };

    if (maintainers) {
      response = {
        maintainers,
      };
    }
  }

  return response;
};