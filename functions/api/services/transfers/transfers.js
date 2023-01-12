const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const getTransfersStatus = require('./getTransfersStatus');
const {
  get_others_version_chain_ids,
  normalize_link,
  _update_link,
  _update_send,
  save_time_spent,
} = require('./utils');
const {
  read,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
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
              { match: { 'unwrap.txhash': txHash } },
            ],
            minimum_should_match: 1,
          },
        }
      );
  }

  if (type) {
    must.push({ match: { type } });
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
        must_not.push({ exists: { field: 'confirm' } });
        must_not.push({ match_phrase: { 'send.source_chain': 'terra' } });
        must_not.push({ match_phrase: { 'send.source_chain': 'terra-2' } });
        break;
      case 'to_fix_terra_to_classic':
        must.push({ exists: { field: 'send.txhash' } });
        must.push({ match_phrase: { 'send.source_chain': 'terra-2' } });
        must.push({ range: { 'send.height': { gt: 5500000 } } });
        must.push({ match: { 'send.created_at.year': 1640995200000 } });
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
    must.push({ match_phrase: { 'send.denom': asset } });
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
      typeof from === 'number' ?
        from :
        0,
    size:
      typeof size === 'number' ?
        size :
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
          { 'confirm.created_at.ms': 'desc' }
        ],
      );
  }

  response =
    await read(
      'cross_chain_transfers',
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

    if (updated) {
      // search again after updated
      await sleep(1 * 1000);

      response =
        await read(
          'cross_chain_transfers',
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
          } = { ...d };
          const {
            txhash,
            destination_chain,
            amount,
            value,
            insufficient_fee,
          } = { ...send };

          return (
            txhash &&
            (
              !(
                destination_chain &&
                typeof amount === 'number' &&
                typeof value === 'number'
              ) ||
              (
                cosmos_chains_data
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
                !(
                  ibc_send?.failed_txhash ||
                  ibc_send?.ack_txhash ||
                  ibc_send?.recv_txhash
                )
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
              !(
                vote?.transfer_id ||
                confirm?.transfer_id
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

        getTransfersStatus(
          {
            txHash: txhash,
            sourceChain: source_chain,
          },
        );
      }

      await sleep(2 * 1000);

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

        _update_send(
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

        _update_send(
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

  if (
    [
      'to_fix_value',
    ].includes(status) &&
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
          await _update_link(
            link,
            send,
          );

        _update_send(
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
        'cross_chain_transfers',
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
          const {
            amount,
            value,
          } = { ...send };
          let {
            price,
          } = { ...link };

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