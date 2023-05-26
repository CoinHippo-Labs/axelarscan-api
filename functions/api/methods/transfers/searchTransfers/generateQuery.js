const _ = require('lodash');

const {
  getOthersChainIds,
} = require('../../../utils/chain');
const {
  getOthersDenoms,
} = require('../../../utils/asset');
const {
  getChainsList,
  getAssetData,
} = require('../../../utils/config');
const {
  toArray,
} = require('../../../utils');

module.exports = params => {
  const {
    query,
  } = { ...params };

  return {
    bool: {
      must:
        Object.entries(params)
          .filter(([k, v]) =>
            ![
              'method',
              'query',
              'aggs',
              'fields',
              '_source',
              'from',
              'size',
              'sort',
            ]
            .includes(k)
          )
          .map(([k, v]) => {
            let obj;

            switch (k) {
              case 'txHash':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'send.txhash': v } },
                        { match: { 'wrap.txhash': v } },
                        { match: { 'wrap.tx_hash_wrap': v } },
                        { match: { 'command.transactionHash': v } },
                        { match: { 'unwrap.txhash': v } },
                        { match: { 'unwrap.tx_hash_unwrap': v } },
                        { match: { 'erc20_transfer.txhash': v } },
                        { match: { 'erc20_transfer.tx_hash_transfer': v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'type':
                if (v) {
                  switch (v) {
                    case 'deposit_address':
                      obj = {
                        bool: {
                          should: [
                            { match: { type: v } },
                            {
                              bool: {
                                must_not: [
                                  { exists: { field: 'type' } },
                                ],
                              },
                            },
                          ],
                          minimum_should_match: 1,
                        },
                      };
                      break;
                    default:
                      obj = { match: { type: v } };
                      break;
                  }
                }
                break;
              case 'confirmed':
                if (v) {
                  switch (v) {
                    case 'confirmed':
                      obj = {
                        bool: {
                          should: [
                            { exists: { field: 'confirm' } },
                            { exists: { field: 'vote' } },
                          ],
                          minimum_should_match: 1,
                        },
                      };
                      break;
                    case 'unconfirmed':
                      obj = {
                        bool: {
                          must_not: [
                            { exists: { field: 'confirm' } },
                            { exists: { field: 'vote' } },
                          ],
                        },
                      };
                      break;
                    default:
                      break;
                  }
                }
                break;
              case 'state':
                if (v) {
                  switch (v) {
                    case 'completed':
                      obj = {
                        bool: {
                          should: [
                            {
                              bool: {
                                must: [
                                  { exists: { field: 'command' } },
                                ],
                                should: getChainsList('evm').flatMap(c => { return toArray([{ match_phrase: { 'send.original_destination_chain': c.id } }, { match_phrase: { 'send.original_destination_chain': c.chain_name?.toLowerCase() } }]); }),
                                minimum_should_match: 1,
                              },
                            },
                            {
                              bool: {
                                must: [
                                  { exists: { field: 'ibc_send' } },
                                ],
                                should: getChainsList('cosmos').flatMap(c => { return toArray([{ match_phrase: { 'send.original_destination_chain': c.id } }, { match_phrase: { 'send.original_destination_chain': c.chain_name?.toLowerCase() } }]); }),
                                minimum_should_match: 1,
                                must_not: [
                                  { exists: { field: 'ibc_send.failed_txhash' } },
                                ],
                              },
                            },
                            {
                              bool: {
                                must: [
                                  { match_phrase: { 'send.original_destination_chain': 'axelarnet' } },
                                  { exists: { field: 'axelar_transfer' } },
                                ],
                              },
                            },
                          ],
                          minimum_should_match: 1,
                        },
                      };
                      break;
                    case 'pending':
                      obj = {
                        bool: {
                          must_not: [
                            {
                              bool: {
                                should: [
                                  {
                                    bool: {
                                      must: [
                                        { exists: { field: 'command' } },
                                      ],
                                      should: getChainsList('evm').flatMap(c => { return toArray([{ match_phrase: { 'send.original_destination_chain': c.id } }, { match_phrase: { 'send.original_destination_chain': c.chain_name?.toLowerCase() } }]); }),
                                      minimum_should_match: 1,
                                    },
                                  },
                                  {
                                    bool: {
                                      must: [
                                        { exists: { field: 'ibc_send' } },
                                      ],
                                      should: getChainsList('cosmos').flatMap(c => { return toArray([{ match_phrase: { 'send.original_destination_chain': c.id } }, { match_phrase: { 'send.original_destination_chain': c.chain_name?.toLowerCase() } }]); }),
                                      minimum_should_match: 1,
                                    },
                                  },
                                  {
                                    bool: {
                                      must: [
                                        { match_phrase: { 'send.original_destination_chain': 'axelarnet' } },
                                        { exists: { field: 'axelar_transfer' } },
                                      ],
                                    },
                                  },
                                ],
                                minimum_should_match: 1,
                              },
                            }
                          ],
                        },
                      };
                      break;
                    default:
                      break;
                  }
                }
                break;
              case 'sourceChain':
                if (v) {
                  v = toArray(v);
                  obj = {
                    bool: {
                      should:
                        v.map(c => {
                          return {
                            bool: {
                              must: [
                                { match_phrase: { 'send.original_source_chain': c } },
                              ],
                              must_not: getOthersChainIds(c).flatMap(_c => [{ match_phrase: { 'send.original_source_chain': _c } }, { match_phrase: { 'send.source_chain': _c } }]),
                            },
                          };
                        }),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'destinationChain':
                if (v) {
                  v = toArray(v);
                  obj = {
                    bool: {
                      should:
                        v.map(c => {
                          return {
                            bool: {
                              must: [
                                { match_phrase: { 'send.original_destination_chain': c } },
                              ],
                              must_not: getOthersChainIds(c).flatMap(_c => [{ match_phrase: { 'send.original_destination_chain': _c } }, { match_phrase: { 'send.destination_chain': _c } }]),
                            },
                          };
                        }),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'asset':
              case 'assets':
                if (v) {
                  v = toArray(v);
                  if (v.length > 0) {
                    obj = {
                      bool: {
                        should:
                          v.map(_v => {
                            const {
                              denom,
                              denoms,
                            } = { ...getAssetData(_v) };

                            const _denoms = toArray(_.concat(denom, denoms));
                            if (_denoms.findIndex(d => d.endsWith('-wei')) > -1) {
                              return {
                                bool: {
                                  should:
                                    _denoms.map(d => {
                                      return (
                                        d.startsWith('w') && _denoms.includes(d.substring(1)) ?
                                          {
                                            bool: {
                                              must: [
                                                { match_phrase: { 'send.denom': d } },
                                              ],
                                              should: [
                                                { match: { type: 'wrap' } },
                                                { match: { type: 'unwrap' } },
                                                { match: { type: 'erc20_transfer' } },
                                              ],
                                              minimum_should_match: 1,
                                              must_not: getOthersDenoms(d).map(_d => { return { match_phrase: { 'send.denom': _d } }; }),
                                            },
                                          } :
                                          {
                                            bool: {
                                              must: [
                                                { match_phrase: { 'send.denom': d } },
                                              ],
                                              must_not: getOthersDenoms(d).map(_d => { return { match_phrase: { 'send.denom': _d } }; }),
                                            }
                                          }
                                      );
                                    }),
                                  minimum_should_match: 1,
                                },
                              };
                            }
                            else {
                              return {
                                bool: {
                                  should:
                                    _denoms.map(d => {
                                      return {
                                        bool: {
                                          must: [
                                            { match_phrase: { 'send.denom': d } },
                                          ],
                                          must_not: getOthersDenoms(d).map(_d => { return { match_phrase: { 'send.denom': _d } }; }),
                                        }
                                      };
                                    }),
                                  minimum_should_match: 1,
                                },
                              };
                            }
                          }),
                        minimum_should_match: 1,
                      },
                    };
                  }
                }
                break;
              case 'depositAddress':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'send.recipient_address': v } },
                        { match: { 'wrap.deposit_address': v } },
                        { match: { 'unwrap.deposit_address': v } },
                        { match: { 'unwrap.deposit_address_link': v } },
                        { match: { 'erc20_transfer.deposit_address': v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'senderAddress':
              case 'contractAddress':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'send.sender_address': v } },
                        { match: { 'wrap.sender_address': v } },
                        { match: { 'erc20_transfer.sender_address': v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'recipientAddress':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'link.recipient_address': v } },
                        { match: { 'unwrap.recipient_address': v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'address':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'send.sender_address': v } },
                        { match: { 'send.recipient_address': v } },
                        { match: { 'link.recipient_address': v } },
                        { match: { 'wrap.sender_address': v } },
                        { match: { 'wrap.deposit_address': v } },
                        { match: { 'unwrap.deposit_address': v } },
                        { match: { 'unwrap.deposit_address_link': v } },
                        { match: { 'unwrap.recipient_address': v } },
                        { match: { 'erc20_transfer.sender_address': v } },
                        { match: { 'erc20_transfer.deposit_address': v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'transferId':
                if (v) {
                  obj = {
                    bool: {
                      should: [
                        { match: { 'confirm.transfer_id': v } },
                        { match: { 'vote.transfer_id': v } },
                        { match: { transfer_id: v } },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'status':
                switch (v) {
                  case 'to_fix_value':
                    obj = {
                      bool: {
                        must: [
                          { exists: { field: 'send.txhash' } },
                          { exists: { field: 'send.amount' } },
                        ],
                        must_not: [
                          { exists: { field: 'send.value' } },
                        ],
                      },
                    };
                    break;
                  default:
                    break;
                }
                break;
              case 'fromTime':
                if (v) {
                  obj = { range: { 'send.created_at.ms': { gte: Number(v) * 1000 } } };
                }
                break;
              case 'toTime':
                if (v) {
                  obj = { range: { 'send.created_at.ms': { lte: Number(v) * 1000 } } };
                }
                break;
              case 'fromBlock':
                if (v) {
                  obj = { range: { 'send.height': { gte: Number(v) } } };
                }
                break;
              case 'toBlock':
                if (v) {
                  obj = { range: { 'send.height': { lte: Number(v) } } };
                }
                break;
              default:
                break;
            }

            return obj;
          })
          .filter(q => q),
      ...query?.bool,
    },
  };
};