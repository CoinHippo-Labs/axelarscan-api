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
    let _response = await read(
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

    let blockNumber = _.head(_response?.data)?.event?.blockNumber;

    if (blockNumber) {
      response = {
        ...response,
        latest: {
          ...response?.latest,
          token_sent_block: blockNumber,
        },
      };
    }

    _response = await read(
      'batches',
      {
        bool: {
          must: [
            { match: { chain } },
            { exists: { field: 'blockNumber' } },
          ],
        },
      },
      {
        size: 1,
        sort: [{ 'blockNumber': 'desc' }],
      },
    );

    blockNumber = _.head(_response?.data)?.event?.blockNumber;

    if (blockNumber) {
      response = {
        ...response,
        latest: {
          ...response?.latest,
          batches_executed_block: blockNumber,
        },
      };
    }

    // finalize
    response = {
      chain,
      ...response,
      latest: {
        ...response?.latest,
        gateway_block: _.max(
          response?.latest?.token_sent_block,
          response?.latest?.batches_executed_block,
        ),
      },
    };
  }

  return response;
};