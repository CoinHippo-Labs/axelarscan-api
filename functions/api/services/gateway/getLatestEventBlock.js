const _ = require('lodash');
const {
  read,
} = require('../index');

module.exports = async (
  params = {},
) => {
  let response;

  let {
    chain,
  } = { ...params };

  if (chain) {
    chain = chain.toLowerCase();
  }

  if (!(chain)) {
    response = {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else {
    const _response = await read(
      'token_sent_events',
      {
        bool: {
          must: [
            { match: { 'event.chain': chain } },
            { exists: { field: 'event.blockNumber' } },
          ],
        },
      },
      {
        size: 1,
        sort: [{ 'event.blockNumber': 'desc' }],
      },
    );

    const {
      blockNumber,
    } = { ..._.head(_response?.data)?.event };

    if (blockNumber) {
      response = {
        ...response,
        latest: {
          ...response?.latest,
          token_sent_block: blockNumber,
        },
      };
    }

    // finalize
    response = {
      chain,
      ...response,
      latest: {
        ...response?.latest,
        gateway_block: response?.latest?.token_sent_block,
      },
    };
  }

  return response;
};