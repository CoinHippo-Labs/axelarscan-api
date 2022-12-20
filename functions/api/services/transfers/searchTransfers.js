const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const getTransfersStatus = require('./getTransfersStatus');
const {
  saveTimeSpent,
  get_others_version_chain_ids,
  update_source,
} = require('./utils');
const {
  read,
  write,
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
    must.push({ match: { 'source.id': txHash } });
  }

  if (confirmed) {
    switch (confirmed) {
      case 'confirmed':
        should.push({ exists: { field: 'confirm_deposit' } });
        should.push({ exists: { field: 'vote' } });
        break;
      case 'unconfirmed':
        must_not.push({ exists: { field: 'confirm_deposit' } });
        must_not.push({ exists: { field: 'vote' } });
        break;
      default:
        break;
    }
  }

  if (state) {
    switch (state) {
      case 'completed':
        const _should = [];

        _should.push({
          bool: {
            must: [
              { exists: { field: 'sign_batch' } },
            ],
            should: evm_chains_data
              .map(c => {
                return { match_phrase: { 'source.original_recipient_chain': c?.id } };
              }),
            minimum_should_match: 1,
          },
        });

        _should.push({
          bool: {
            must: [
              { exists: { field: 'ibc_send' } },
            ],
            should: cosmos_chains_data
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
                    return { match_phrase: { 'source.original_recipient_chain': id } };
                  })
                );
              }),
            must_not: [
              { exists: { field: 'ibc_send.failed_txhash' } },
            ],
            minimum_should_match: 1,
          },
        });

        _should.push({
          bool: {
            must: [
              { match_phrase: { 'source.original_recipient_chain': axelarnet.id } },
            ],
            should: [
              { exists: { field: 'axelar_transfer' } },
            ],
            minimum_should_match: 1,
          },
        });

        must.push({
          bool: {
            should: _should,
            minimum_should_match:
              _should.length > 0 ?
                1 :
                0,
          },
        });
        break
      case 'pending':
        must_not.push({
          bool: {
            should: [
              {
                bool: {
                  must: [
                    { exists: { field: 'sign_batch' } },
                  ],
                  should: evm_chains_data
                    .map(c => {
                      return { match_phrase: { 'source.original_recipient_chain': c?.id } };
                    }),
                  minimum_should_match: 1,
                },
              },
              {
                bool: {
                  must: [
                    { exists: { field: 'ibc_send' } },
                  ],
                  should: cosmos_chains_data
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
                          return { match_phrase: { 'source.original_recipient_chain': id } };
                        })
                      );
                    }),
                  minimum_should_match: 1,
                },
              },
              {
                bool: {
                  must: [
                    { match_phrase: { 'source.original_recipient_chain': axelarnet.id } },
                  ],
                  should: [
                    { exists: { field: 'axelar_transfer' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
            minimum_should_match: 1,
          },
        });
        break;
      default:
        break;
    }
  }

  if (status) {
    switch (status) {
      case 'to_migrate':
        must.push({ exists: { field: 'source.id' } });
        must.push({ exists: { field: 'source.recipient_address' } });
        must.push({
          bool: {
            should: [
              {
                bool: {
                  must_not: [
                    { exists: { field: 'num_migrate_time' } },
                  ],
                },
              },
              {
                range: {
                  num_migrate_time: {
                    lt: 5,
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        });
        break;
      default:
        break;
    }
  }

  if (sourceChain) {
    must.push({ match_phrase: { 'source.original_sender_chain': sourceChain } });

    for (const id of get_others_version_chain_ids(sourceChain)) {
      must_not.push({ match_phrase: { 'source.original_sender_chain': id } });
      must_not.push({ match_phrase: { 'source.sender_chain': id } });
    }
  }

  if (destinationChain) {
    must.push({ match_phrase: { 'source.original_recipient_chain': destinationChain } });

    for (const id of get_others_version_chain_ids(destinationChain)) {
      must_not.push({ match_phrase: { 'source.original_recipient_chain': id } });
      must_not.push({ match_phrase: { 'source.recipient_chain': id } });
    }
  }

  if (asset) {
    must.push({ match_phrase: { 'source.denom': asset } });
  }

  if (depositAddress) {
    must.push({ match: { 'source.recipient_address': depositAddress } });
  }

  if (senderAddress) {
    must.push({ match: { 'source.sender_address': senderAddress } });
  }

  if (recipientAddress) {
    must.push({ match: { 'link.recipient_address': recipientAddress } });
  }

  if (transferId) {
    must.push({
      bool: {
        should: [
          { match: { 'confirm_deposit.transfer_id': transferId } },
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

    must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });
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
      [{ 'source.created_at.ms': 'desc' }],
    track_total_hits: true,
  };

  response =
    await read(
      'transfers',
      query,
      read_params,
    );

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d => {
          const {
            source,
            confirm_deposit,
            vote,
            sign_batch,
            ibc_send,
          } = { ...d };
          const {
            id,
            recipient_chain,
            amount,
            value,
            insufficient_fee,
          } = { ...source };

          return (
            id &&
            (
              !(
                recipient_chain &&
                typeof amount === 'number' &&
                typeof value === 'number'
              ) ||
              (
                cosmos_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      recipient_chain,
                    )
                  ) > -1 &&
                !insufficient_fee &&
                (
                  vote ||
                  confirm_deposit
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
                      recipient_chain,
                    )
                  ) > -1 &&
                !insufficient_fee &&
                (
                  vote ||
                  confirm_deposit
                ) &&
                !sign_batch?.executed
              ) ||
              !(
                vote?.transfer_id ||
                confirm_deposit?.transfer_id
              )
            )
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          source,
        } = { ...d };
        const {
          id,
          sender_chain,
        } = { ...source };

        getTransfersStatus(
          {
            txHash: id,
            sourceChain: sender_chain,
          },
        );
      }

      await sleep(2 * 1000);

      response =
        await read(
          'transfers',
          query,
          read_params,
        );
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
            sign_batch,
            ibc_send,
            time_spent,
          } = { ...d };
          const {
            total,
          } = { ...time_spent };

          return (
            !total &&
            (
              sign_batch?.executed ||
              ibc_send?.ack_txhash
            )
          );
        });

    if (data.length > 0) {
      for (const d of data) {
        const {
          id,
        } = { ...d };

        saveTimeSpent(
          id,
          d,
        );
      }

      await sleep(0.5 * 1000);

      response =
        await read(
          'transfers',
          query,
          read_params,
        );
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
            source,
          } = { ...d };
          const {
            created_at,
            denom,
            amount,
            fee,
          } = { ...source };
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
          source,
          link,
        } = { ...d };

        update_source(
          source,
          link,
          true,
        );
      }

      await sleep(0.5 * 1000);

      response =
        await read(
          'transfers',
          query,
          read_params,
        );
    }
  }

  if (Array.isArray(response?.data)) {
    response.data =
      response.data
        .map(d => {
          const {
            source,
            link,
            confirm_deposit,
            vote,
            sign_batch,
            ibc_send,
            axelar_transfer,
          } = { ...d };
          const {
            amount,
            value,
          } = { ...source };
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
                ibc_send.recv_txhash ?
                  'executed' :
                  'ibc_sent' :
              sign_batch?.executed ?
                'executed' :
                 sign_batch ?
                  'batch_signed' :
                  axelar_transfer ?
                    'executed' :
                    vote ?
                      'voted' :
                      confirm_deposit ?
                        'deposit_confirmed' :
                        source?.status === 'failed' ?
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

  if (Array.isArray(response?.data)) {
    const {
      data,
    } = { ...response };

    if (status === 'to_migrate') {
      for (const d of data) {
        const {
          source,
        } = { ...d };
        let {
          num_migrate_time,
        } = { ...d };
        const {
          id,
          recipient_address,
        } = { ...source };

        num_migrate_time =
          (typeof num_migrate_time === 'number' ?
            num_migrate_time :
            -1
          ) +
          1;

        const _d = {
          ...d,
          num_migrate_time,
        };

        const _id = `${id}_${recipient_address}`.toLowerCase();

        await write(
          'transfers',
          _id,
          _d,
          true,
        );

        const index = data
          .findIndex(_d =>
            equals_ignore_case(
              _d?.id,
              id,
            )
          );

        if (index > -1) {
          data[index] = _d;
        }
      }
    }

    response.data = data;
  }

  return response;
};