const _ = require('lodash');

const {
  read,
} = require('../../services/index');
const {
  getOthersChainIds,
} = require('../../utils/chain');
const {
  TRANSFER_COLLECTION,
  COMMAND_EVENT_COLLECTION,
} = require('../../utils/config');
const {
  toArray,
} = require('../../utils');

module.exports = async chain => {
  let output;

  // normalize
  chain = chain?.toLowerCase();

  if (!chain) {
    output = {
      error: true,
      code: 400,
      message: 'chain not valid',
    };
  }
  else {
    output = {
      latest: {
        ...Object.fromEntries(
          await Promise.all(
            [TRANSFER_COLLECTION, COMMAND_EVENT_COLLECTION].map(c =>
              new Promise(
                async resolve => {
                  let key;
                  let height;

                  switch (c) {
                    case TRANSFER_COLLECTION:
                      key = 'token_sent_block';
                      try {
                        const response =
                          await read(
                            c,
                            {
                              bool: {
                                must: [
                                  { exists: { field: 'send.height' } },
                                  { match_phrase: { 'send.source_chain': chain } },
                                ],
                                should: [
                                  { match: { type: 'send_token' } },
                                  { match: { type: 'wrap' } },
                                  { match: { type: 'erc20_transfer' } },
                                ],
                                minimum_should_match: 1,
                                must_not: getOthersChainIds(chain).map(c => { return { match_phrase: { 'send.source_chain': c } }; }),
                              },
                            },
                            { size: 1, sort: [{ 'send.created_at.ms': 'desc' }] },
                          );

                        const {
                          send,
                        } = { ..._.head(response?.data) };

                        height = send?.height;
                      } catch (error) {}
                      break;
                    case COMMAND_EVENT_COLLECTION:
                      key = 'batches_executed_block';
                      try {
                        const response =
                          await read(
                            c,
                            {
                              bool: {
                                must: [
                                  { exists: { field: 'blockNumber' } },
                                  { match_phrase: { chain } },
                                ],
                                must_not: getOthersChainIds(chain).map(c => { return { match_phrase: { chain: c } }; }),
                              },
                            },
                            { size: 1, sort: [{ 'blockNumber': 'desc' }] },
                          );

                        const event = { ..._.head(response?.data) };
                        height = event?.blockNumber;
                      } catch (error) {}
                      break;
                    default:
                      break;
                  }

                  resolve([key, height]);
                }
              )
            )
          ),
        ),
      },
    };

    // finalize
    output = {
      method: 'getLatestEventBlock',
      params: { chain },
      ...output,
      latest: {
        ...output.latest,
        gateway_block: _.min(toArray(Object.values(output.latest))),
      },
    };
  }

  return output;
};