const _ = require('lodash');
const {
  read,
} = require('../index');
const {
  get_others_version_chain_ids,
} = require('../transfers/utils');

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
    // transfer
    let _response =
      await read(
        'token_sent_events',
        {
          bool: {
            must: [
              { match_phrase: { 'event.chain': chain } },
              { exists: { field: 'event.blockNumber' } },
            ],
            must_not:
              get_others_version_chain_ids(chain)
                .map(id => {
                  return {
                    match_phrase: {
                      'event.chain': id,
                    },
                  };
                }),
          },
        },
        {
          size: 1,
          sort: [{ 'event.blockNumber': 'desc' }],
        },
      );

    let height =
      _.head(
        _response?.data
      )?.event?.blockNumber;

    // cross-chain transfer
    /*let _response =
      await read(
        'cross_chain_transfers',
        {
          bool: {
            must: [
              { exists: { field: 'send.height' } },
              { match_phrase: { 'send.source_chain': chain } },
            ],
            must_not:
              get_others_version_chain_ids(chain)
                .map(id => {
                  return {
                    match_phrase: {
                      'send.source_chain': id,
                    },
                  };
                }),
          },
        },
        {
          size: 1,
          sort: [{ 'send.height': 'desc' }],
        },
      );

    let height =
      _.head(
        _response?.data
      )?.send?.height;*/

    if (height) {
      response = {
        ...response,
        latest: {
          ...response?.latest,
          token_sent_block: height,
        },
      };
    }

    _response =
      await read(
        'command_events',
        {
          bool: {
            must: [
              { match_phrase: { chain } },
              { exists: { field: 'blockNumber' } },
            ],
            must_not:
              get_others_version_chain_ids(chain)
                .map(id => {
                  return {
                    match_phrase: {
                      chain: id,
                    },
                  };
                }),
          },
        },
        {
          size: 1,
          sort: [{ 'blockNumber': 'desc' }],
        },
      );

    height =
      _.head(
        _response?.data
      )?.event?.blockNumber;

    if (height) {
      response = {
        ...response,
        latest: {
          ...response?.latest,
          batches_executed_block: height,
        },
      };
    }

    // finalize
    response = {
      chain,
      ...response,
      latest: {
        ...response?.latest,
        gateway_block:
          _.min(
            _.concat(
              response?.latest?.token_sent_block,
              response?.latest?.batches_executed_block,
            )
            .filter(b => b),
          ),
      },
    };
  }

  return response;
};