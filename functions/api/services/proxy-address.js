const cli = require('./cli');
const {
  to_json,
} = require('../utils');

module.exports = async (
  params = {},
) => {
  let response;

  const {
    operator_address,
  } = { ...params };

  if (operator_address) {
    const _response = await cli(
      undefined,
      {
        cmd: `axelard q snapshot proxy ${operator_address} -oj`,
        cache: true,
        cache_timeout: 300,
      },
    );

    const {
      address,
    } = { ...to_json(_response?.stdout) };

    if (address) {
      response = {
        address,
      };
    }
  }

  return response;
};