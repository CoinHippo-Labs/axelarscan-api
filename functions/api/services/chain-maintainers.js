const cli = require('./cli');
const {
  to_json,
} = require('../utils');

module.exports = async (
  params = {},
) => {
  let response;

  const {
    chain,
    height,
  } = { ...params };

  if (chain) {
    const _response = await cli(
      null,
      {
        cmd: `axelard q nexus chain-maintainers ${chain} ${height ? `--height ${height} ` : ''}-oj`,
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