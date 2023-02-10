const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const getTransfersStatus = require('./getTransfersStatus');
const {
  get_others_version_chain_ids,
  normalize_link,
  update_link,
  update_send,
  save_time_spent,
} = require('./utils');
const {
  read,
  write,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
  get_granularity,
  getTransaction,
  getBlockTime,
  getProvider,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../data')?.chains?.[environment]?.cosmos ||
  [];
const assets_data =
  require('../../data')?.assets?.[environment] ||
  [];

const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );

const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );

module.exports = async (
  params = {},
  collection = 'cross_chain_transfers',
) => {
  let response;

  const {
    txHash,
    type,
    confirmed,
    state,
    status,
    sourceChain,
    destinationChain,
    asset,
    depositAddress,
    senderAddress,
    recipientAddress,
    transferId,
    from,
    size,
    sort,
  } = { ...params };
  let {
    fromTime,
    toTime,
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (txHash) {
    must
      .push(
        {
          bool: {
            should: [
              { match: { 'send.txhash': txHash } },
              { match: { 'wrap.txhash': txHash } },
              { match: { 'command.transactionHash': txHash } },
              { match: { 'unwrap.txhash': txHash } },
              { match: { 'unwrap.tx_hash_unwrap': txHash } },
            ],
            minimum_should_match: 1,
          },
        }
      );
  }

  if (type) {
    switch (type) {
      case 'deposit_address':
        must
          .push(
            {
              bool: {
                should: [
                  { match: { type } },
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
            }
          );
        break;
      default:
        must.push({ match: { type } });
        break;
    }
  }

  if (confirmed) {
    switch (confirmed) {
      case 'confirmed':
        should.push({ exists: { field: 'confirm' } });
        should.push({ exists: { field: 'vote' } });
        break;
      case 'unconfirmed':
        must_not.push({ exists: { field: 'confirm' } });
        must_not.push({ exists: { field: 'vote' } });
        break;
      default:
        break;
    }
  }

  if (state) {
    switch (state) {
      case 'completed':
        const _should =
          [
            {
              bool: {
                must: [
                  { exists: { field: 'command' } },
                ],
                should:
                  evm_chains_data
                    .map(c => {
                      return {
                        match_phrase: {
                          'send.original_destination_chain': c?.id,
                        },
                      };
                    }),
                minimum_should_match: 1,
              },
            },
            {
              bool: {
                must: [
                  { exists: { field: 'ibc_send' } },
                ],
                should:
                  cosmos_chains_data
                    .flatMap(c => {
                      const {
                        id,
                        overrides,
                      } = { ...c };

                      return (
                        _.uniq(
                          _.concat(
                            id,
                            Object.keys({ ...overrides }),
                          )
                        )
                        .map(id => {
                          return {
                            match_phrase: {
                              'send.original_destination_chain': id,
                            },
                          };
                        })
                      );
                    }),
                must_not: [
                  { exists: { field: 'ibc_send.failed_txhash' } },
                ],
                minimum_should_match: 1,
              },
            },
            {
              bool: {
                must: [
                  { match_phrase: { 'send.original_destination_chain': axelarnet.id } },
                  { exists: { field: 'axelar_transfer' } },
                ],
              },
            },
          ];

        must
          .push(
            {
              bool: {
                should: _should,
                minimum_should_match:
                  _should.length > 0 ?
                    1 :
                    0,
              },
            }
          );
        break
      case 'pending':
        must_not
          .push(
            {
              bool: {
                should: [
                  {
                    bool: {
                      must: [
                        { exists: { field: 'command' } },
                      ],
                      should:
                        evm_chains_data
                          .map(c => {
                            return {
                              match_phrase: {
                                'send.original_destination_chain': c?.id,
                              },
                            };
                          }),
                      minimum_should_match: 1,
                    },
                  },
                  {
                    bool: {
                      must: [
                        { exists: { field: 'ibc_send' } },
                      ],
                      should:
                        cosmos_chains_data
                          .flatMap(c => {
                            const {
                              id,
                              overrides,
                            } = { ...c };

                            return (
                              _.uniq(
                                _.concat(
                                  id,
                                  Object.keys({ ...overrides }),
                                )
                              )
                              .map(id => {
                                return {
                                  match_phrase: {
                                    'send.original_destination_chain': id,
                                  },
                                };
                              })
                            );
                          }),
                      minimum_should_match: 1,
                    },
                  },
                  {
                    bool: {
                      must: [
                        { match_phrase: { 'send.original_destination_chain': axelarnet.id } },
                        { exists: { field: 'axelar_transfer' } },
                      ],
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            }
          );
        break;
      default:
        break;
    }
  }

  if (status) {
    switch (status) {
      case 'to_fix_value':
        must.push({ exists: { field: 'send.txhash' } });
        must.push({ exists: { field: 'send.amount' } });
        must_not.push({ exists: { field: 'send.value' } });
        break;
      case 'to_fix_confirm':
        must.push({ exists: { field: 'send.txhash' } });
        must.push({ exists: { field: 'send.value' } });
        must.push(
          {
            bool: {
              should: [
                { match: { type: 'deposit_address' } },
                { match: { type: 'unwrap' } },
              ],
              minimum_should_match: 1,
            },
          }
        );
        must_not.push({ exists: { field: 'confirm' } });
        must_not.push({ match: { 'send.status': 'failed' } });
        must_not.push({ match: { 'send.insufficient_fee': true } });
        must_not.push({ match_phrase: { 'send.source_chain': 'terra' } });
        must_not.push({ match_phrase: { 'send.source_chain': 'terra-2' } });
        break;
      case 'to_fix_terra_to_terra_classic':
        must.push({ exists: { field: 'send.txhash' } });
        must.push({ match_phrase: { 'send.source_chain': 'terra-2' } });
        must.push({ range: { 'send.height': { gt: 1000000 } } });
        must.push({ range: { 'send.created_at.ms': { lt: 1659712921000 } } });
        must_not.push({ match: { 'ignore_fix_terra': true } });
        break;
      case 'to_fix_terra_classic_to_terra':
        must.push({ exists: { field: 'send.txhash' } });
        must.push({ match_phrase: { 'send.source_chain': 'terra' } });
        must.push({ range: { 'send.height': { lt: 5000000 } } });
        must.push({ range: { 'send.created_at.ms': { gte: 1634884994000 } } });
        must_not.push({ match_phrase: { 'send.source_chain': 'terra-2' } });
        break;
      default:
        break;
    }
  }

  if (sourceChain) {
    must.push({ match_phrase: { 'send.original_source_chain': sourceChain } });

    for (const id of get_others_version_chain_ids(sourceChain)) {
      must_not.push({ match_phrase: { 'send.original_source_chain': id } });
      must_not.push({ match_phrase: { 'send.source_chain': id } });
    }
  }

  if (destinationChain) {
    must.push({ match_phrase: { 'send.original_destination_chain': destinationChain } });

    for (const id of get_others_version_chain_ids(destinationChain)) {
      must_not.push({ match_phrase: { 'send.original_destination_chain': id } });
      must_not.push({ match_phrase: { 'send.destination_chain': id } });
    }
  }

  if (asset) {
    if (
      asset.endsWith('-wei') &&
      assets_data
        .findIndex(a =>
          a?.id === `w${asset}`
        ) > -1
    ) {
      must
        .push(
          {
            bool: {
              should:
                [
                  { match_phrase: { 'send.denom': asset } },
                  {
                    bool: {
                      must:
                        [
                          { match_phrase: { 'send.denom': `w${asset}` } },
                        ],
                      should:
                        [
                          { match: { type: 'wrap' } },
                          { match: { type: 'unwrap' } },
                        ],
                      minimum_should_match: 1,
                    },
                  },
                ],
              minimum_should_match: 1,
            },
          }
        );
    }
    else {
      must.push({ match_phrase: { 'send.denom': asset } });
    }
  }

  if (depositAddress) {
    must
      .push(
        {
          bool: {
            should: [
              { match: { 'send.recipient_address': depositAddress } },
              { match: { 'wrap.deposit_address': depositAddress } },
              { match: { 'unwrap.deposit_address': depositAddress } },
              { match: { 'unwrap.deposit_address_link': depositAddress } },
            ],
            minimum_should_match: 1,
          },
        }
      );
  }

  if (senderAddress) {
    must
      .push(
        {
          bool: {
            should: [
              { match: { 'send.sender_address': senderAddress } },
              { match: { 'wrap.sender_address': senderAddress } },
            ],
            minimum_should_match: 1,
          },
        }
      );
  }

  if (recipientAddress) {
    must
      .push(
        {
          bool: {
            should: [
              { match: { 'link.recipient_address': recipientAddress } },
              { match: { 'unwrap.recipient_address': recipientAddress } },
            ],
            minimum_should_match: 1,
          },
        }
      );
  }

  if (transferId) {
    must.push({
      bool: {
        should: [
          { match: { 'confirm.transfer_id': transferId } },
          { match: { 'vote.transfer_id': transferId } },
          { match: { transfer_id: transferId } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime =
      toTime ?
        Number(toTime) * 1000 :
        moment()
          .valueOf();

    must.push({ range: { 'send.created_at.ms': { gte: fromTime, lte: toTime } } });
  }

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match:
          should.length > 0 ?
            1 :
            0,
      },
    };
  }

  const read_params = {
    from:
      !isNaN(from) ?
        Number(from) :
        0,
    size:
      !isNaN(size) ?
        Number(size) :
        100,
    sort:
      sort ||
      [{ 'send.created_at.ms': 'desc' }],
    track_total_hits: true,
  };

  if (txHash) {
    read_params.sort =
      _.concat(
        read_params.sort,
        [
          { 'confirm.created_at.ms': 'desc' },
        ],
      );
  }

  response =
    await read(
      collection,
      query,
      read_params,
    );

  if (txHash) {
    const {
      data,
    } = { ...response };

    // flag to check is there any update
    let updated;

    if (data?.length < 1) {
      if (txHash.startsWith('0x')) {
        const chains_config = {
          ...config?.[environment]?.gateway?.chains,
        };

        const contracts_config = {
          ...config?.[environment]?.gateway?.contracts,
        };

        const chains = Object.keys({ ...chains_config });

        for (const chain of chains) {
          const _response =
            await require('../gateway/recoverEvents')(
              chains_config,
              contracts_config,
              chain,
              txHash,
            );

          if (_response?.code === 200) {
            updated = true;
            break;
          }
        }
      }
    }
    else {
      for (const d of data) {
        const {
          type,
          send,
        } = { ...d };
        let {
          wrap,
        } = { ...d };
        const {
          txhash,
          source_chain,
        } = { ...send };

        switch (type) {
          case 'send_token':
            try {
              if (
                !wrap &&
                txhash &&
                source_chain
              ) {
                const _response =
                  await read(
                    'wraps',
                    {
                      bool: {
                        must: [
                          { match: { tx_hash_wrap: txhash } },
                          { match: { source_chain } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                wrap =
                  _.head(
                    _response?.data
                  );

                if (wrap) {
                  const {
                    tx_hash,
                  } = { ...wrap };

                  if (tx_hash) {
                    const chain_data = evm_chains_data
                      .find(c =>
                        c?.id === source_chain
                      );

                    const provider =
                      getProvider(
                        chain_data,
                      );

                    if (provider) {
                      const _data =
                        await getTransaction(
                          provider,
                          tx_hash,
                          source_chain,
                        );

                      const {
                        blockNumber,
                        from,
                      } = { ..._data?.transaction };

                      if (blockNumber) {
                        const block_timestamp =
                          await getBlockTime(
                            provider,
                            blockNumber,
                          );

                        wrap = {
                          ...wrap,
                          txhash: tx_hash,
                          height: blockNumber,
                          type: 'evm',
                          created_at:
                            get_granularity(
                              moment(
                                block_timestamp * 1000
                              )
                              .utc()
                            ),
                          sender_address: from,
                        };
                      }
                    }
                  }

                  const _data = {
                    type: 'wrap',
                    wrap,
                  };

                  const _id = `${txhash}_${source_chain}`.toLowerCase();

                  await write(
                    collection,
                    _id,
                    {
                      ...d,
                      ..._data,
                    },
                    true,
                  );

                  updated = true;
                }
              }
            } catch (error) {}
            break;
          default:
            break;
        }
      }
    }

    if (updated) {
      // search again after updated
      await sleep(1 * 1000);

      response =
        await read(
          collection,
          query,
          read_params,
        );
    }
  }

  let updated;

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            send,
            confirm,
            vote,
            command,
            ibc_send,
            axelar_transfer,
            unwrap,
          } = { ...d };
          const {
            txhash,
            source_chain,
            destination_chain,
            amount,
            value,
            fee,
            insufficient_fee,
          } = { ...send };

          return (
            txhash &&
            (
              !(
                source_chain &&
                destination_chain &&
                typeof amount === 'number' &&
                typeof value === 'number' &&
                typeof fee === 'number'
              ) ||
              (
                evm_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      destination_chain,
                    )
                  ) > -1 &&
                !insufficient_fee &&
                (
                  vote ||
                  confirm
                ) &&
                !command?.executed
              ) ||
              (
                cosmos_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      destination_chain,
                    )
                  ) > -1 &&
                ![
                  'axelarnet',
                ]
                .includes(destination_chain) &&
                !insufficient_fee &&
                (
                  vote ||
                  confirm
                ) &&
                !(
                  ibc_send?.failed_txhash ||
                  ibc_send?.ack_txhash ||
                  ibc_send?.recv_txhash
                )
              ) ||
              (
                [
                  'axelarnet',
                ]
                .includes(destination_chain) &&
                !insufficient_fee &&
                !axelar_transfer
              ) ||
              !(
                vote?.transfer_id ||
                confirm?.transfer_id
              ) ||
              (
                unwrap &&
                !unwrap.tx_hash_unwrap
              ) ||
              (
                evm_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      source_chain,
                    )
                  ) > -1 &&
                !insufficient_fee &&
                !vote &&
                (
                  command ||
                  ibc_send ||
                  axelar_transfer
                )
              )
            )
          );
        });

    if (data.length > 0) {
      data =
        _.slice(
          0,
          10,
        );

      for (const d of data) {
        const {
          send,
        } = { ...d };
        const {
          txhash,
          source_chain,
        } = { ...send };

        if (data.length === 1) {
          await getTransfersStatus(
            {
              txHash: txhash,
              sourceChain: source_chain,
            },
          );
        }
        else {
          getTransfersStatus(
            {
              txHash: txhash,
              sourceChain: source_chain,
            },
          );
        }
      }

      await sleep(
        (
          data.length > 1 ?
            4 :
            0
        ) *
        1000
      );

      updated = true;
    }
  }

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            send,
            command,
            ibc_send,
            unwrap,
            time_spent,
          } = { ...d };
          const {
            txhash,
            source_chain,
          } = { ...send };
          const {
            total,
          } = { ...time_spent };

          return (
            txhash &&
            source_chain &&
            !total &&
            (
              command?.executed ||
              ibc_send?.ack_txhash ||
              unwrap
            )
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          send,
        } = { ...d };
        const {
          txhash,
          source_chain,
        } = { ...send };

        const _id = `${txhash}_${source_chain}`.toLowerCase();

        save_time_spent(
          _id,
        );
      }

      await sleep(0.5 * 1000);

      updated = true;
    }
  }

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            send,
          } = { ...d };
          const {
            created_at,
            denom,
            amount,
            fee,
          } = { ...send };
          const {
            ms,
          } = { ...created_at };

          return (
            [
              'uluna',
              'uusd',
            ].includes(denom) &&
            ms <
            moment(
              '20220401',
              'YYYYMMDD',
            )
            .utc()
            .valueOf() &&
            fee >
            parseFloat(
              (
                amount * 0.001
              )
              .toFixed(6)
            )
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          send,
          link,
        } = { ...d };

        update_send(
          send,
          link,
          d,
          true,
        );
      }

      await sleep(0.5 * 1000);

      updated = true;
    }
  }

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            send,
          } = { ...d };
          const {
            txhash,
            height,
            source_chain,
          } = { ...send };

          return (
            txhash &&
            source_chain &&
            typeof height === 'string'
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          send,
          link,
        } = { ...d };
        const {
          height,
        } = { ...send };

        send.height = Number(height);

        update_send(
          send,
          link,
          d,
          true,
        );
      }

      await sleep(0.5 * 1000);

      updated = true;
    }
  }

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            type,
            send,
            wrap,
            unwrap,
          } = { ...d };
          const {
            txhash,
            source_chain,
          } = { ...send };

          return (
            txhash &&
            source_chain &&
            (
              (
                wrap &&
                type !== 'wrap'
              ) ||
              (
                unwrap &&
                type !== 'unwrap'
              )
            )
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          send,
          wrap,
          unwrap,
        } = { ...d };
        let {
          type,
        } = { ...d };
        const {
          txhash,
          source_chain,
        } = { ...send };

        type =
          wrap ?
            'wrap' :
            unwrap ?
              'unwrap' :
              type;

        const _id = `${txhash}_${source_chain}`.toLowerCase();

        await write(
          collection,
          _id,
          {
            ...d,
            type,
          },
          true,
        );
      }

      await sleep(0.5 * 1000);

      updated = true;
    }
  }

  if (
    [
      'to_fix_value',
    ]
    .includes(status) &&
    Array.isArray(response?.data)
  ) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            send,
            link,
          } = { ...d };
          const {
            txhash,
            source_chain
          } = { ...send };
          const {
            price,
          } = { ...link };

          return (
            txhash &&
            source_chain &&
            typeof price !== 'number'
          );
        });

    if (data.length > 0) {
      data =
        _.slice(
          0,
          10,
        );

      for (const d of data) {
        const {
          send,
        } = { ...d };
        let {
          link,
        } = { ...d };

        link = normalize_link(link);

        link =
          await update_link(
            link,
            send,
          );

        update_send(
          send,
          link,
          d,
          true,
        );
      }

      await sleep(0.5 * 1000);

      updated = true;
    }
  }

  if (updated) {
    response =
      await read(
        collection,
        query,
        read_params,
      );
  }

  if (Array.isArray(response?.data)) {
    response.data =
      response.data
        .map(d => {
          const {
            send,
            link,
            confirm,
            vote,
            command,
            ibc_send,
            axelar_transfer,
            wrap,
            unwrap,
          } = { ...d };
          let {
            type,
          } = { ...d };
          const {
            amount,
            value,
          } = { ...send };
          let {
            price,
          } = { ...link };

          type =
            wrap ?
              'wrap' :
              unwrap ?
                'unwrap' :
                type;

          if (
            typeof price !== 'number' &&
            typeof amount === 'number' &&
            typeof value === 'number'
          ) {
            price = value / amount;
          }

          const status =
            ibc_send ?
              ibc_send.failed_txhash &&
              !ibc_send.ack_txhash ?
                'ibc_failed' :
                ibc_send.recv_txhash ||
                unwrap ?
                  'executed' :
                  'ibc_sent' :
              command?.executed ||
              unwrap ?
                'executed' :
                 command ?
                  'batch_signed' :
                  axelar_transfer ||
                  unwrap ?
                    'executed' :
                    vote ?
                      'voted' :
                      confirm ?
                        'deposit_confirmed' :
                        send?.status === 'failed' &&
                        !wrap ?
                          'send_failed' :
                          'asset_sent';

          let simplified_status;

          switch (status) {
            case 'ibc_failed':
            case 'send_failed':
              simplified_status = 'failed';
              break;
            case 'executed':
              simplified_status = 'received';
              break;
            case 'ibc_sent':
            case 'batch_signed':
            case 'voted':
            case 'deposit_confirmed':
              simplified_status = 'approved';
              break;
            default:
              simplified_status = 'sent';
              break;
          }

          return {
            ...d,
            type,
            link:
              link &&
              {
                ...link,
                price,
              },
            status,
            simplified_status,
          };
        });
  }

  return response;
};