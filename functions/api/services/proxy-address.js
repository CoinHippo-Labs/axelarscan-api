const cli = require('./cli');
const {
  is_operator_address,
} = require('../utils/address');
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

  if (is_operator_address(operator_address)) {
    const _response = await cli(
      undefined,
      {
        cmd: `axelard q snapshot proxy ${operator_address} -oj`,
      },
      true,
      300,
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