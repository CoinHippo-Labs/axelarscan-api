const {
  Contract,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  saveTimeSpent,
} = require('../transfers/utils');
const lcd = require('../lcd');
const {
  read,
  write,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
  getProvider,
} = require('../../utils');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

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
    sourceChain,
    destinationChain,
    asset,
    senderAddress,
    recipientAddress,
    transferId,
    fromTime,
    from,
    size,
    sort,
  } = { ...params };
  let {
    toTime,
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (txHash) {
    must.push({ match: { 'event.transactionHash': txHash } });
  }

  if (sourceChain) {
    must.push({ match: { 'event.chain': sourceChain } });
  }

  if (destinationChain) {
    must.push({ match: { 'event.returnValues.destinationChain': destinationChain } });
  }

  if (asset) {
    must.push({ match: { 'event.returnValues.asset': asset } });
  }

  if (senderAddress) {
    should.push({ match: { 'event.transaction.from': senderAddress } });
    should.push({ match: { 'event.receipt.from': senderAddress } });
  }

  if (recipientAddress) {
    must.push({ match: { 'event.returnValues.destinationAddress': recipientAddress } });
  }

  if (transferId) {
    must.push({
      bool: {
        should: [
          { match: { 'vote.transfer_id': transferId } },
          { match: { transfer_id: transferId } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (fromTime) {
    fromTime = Number(fromTime);
    toTime =
      toTime ?
        Number(toTime) :
        moment()
          .unix();

    must.push({ range: { 'event.block_timestamp': { gte: fromTime, lte: toTime } } });
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
      [{ 'event.block_timestamp': 'desc' }],
  };

  response =
    await read(
      'token_sent_events',
      query,
      read_params,
    );

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data =
      data
        .filter(d =>
          d?.event?.transactionHash &&
          !d.vote?.transfer_id
        );

    if (data.length > 0) {
      const _response =
        await read(
          'evm_polls',
          {
            bool: {
              should:
                data
                  .map(d => {
                    const {
                      event,
                    } = { ...d };
                    const {
                      transactionHash,
                    } = { ...event };

                    return {
                      match: { transaction_id: transactionHash },
                    };
                  }),
              minimum_should_match: 1,
            },
          },
          {
            size: data.length,
          },
        );

      const polls_data = _response?.data;

      if (
        Array.isArray(polls_data) &&
        polls_data.length > 0
      ) {
        for (const poll_data of polls_data) {
          const txhash =
            _.head(
              Object.entries({ ...poll_data })
                .filter(([k, v]) =>
                  k?.startsWith(axelarnet.prefix_address) &&
                  typeof v === 'object' &&
                  v?.confirmed &&
                  v.id
                )
                .map(([k, v]) => v.id)
            );

          if (txhash) {
            lcd(
              `/cosmos/tx/v1beta1/txs/${txhash}`,
            );
          }
        }

        await sleep(2 * 1000);
    
        response =
          await read(
            'token_sent_events',
            query,
            read_params,
          );
      }
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
            event,
            vote,
            sign_batch,
            ibc_send,
          } = { ...d };
          const {
            id,
            returnValues,
            insufficient_fee,
          } = { ...event };
          let {
            destinationChain,
          } = { ...returnValues };
          let {
            height,
          } = { ...vote };

          destinationChain = destinationChain?.toLowerCase();

          height =
            ibc_send?.height ||
            height;

          return (
            id &&
            !insufficient_fee &&
            vote &&
            (
              (
                cosmos_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      destinationChain,
                    )
                  ) > -1 &&
                height &&
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
                      destinationChain,
                    )
                  ) > -1 &&
                !sign_batch?.executed
              )
            )
          );
        });

    if (data.length > 0) {
      const heights =
        _.orderBy(
          _.uniq(
            data
              .filter(d =>
                cosmos_chains_data
                  .findIndex(c =>
                    equals_ignore_case(
                      c?.id,
                      d.event.returnValues?.destinationChain,
                    )
                  ) > -1
              )
              .map(d => {
                const {
                  vote,
                  ibc_send,
                } = { ...d };
                let {
                  height,
                } = { ...vote };

                height =
                  ibc_send?.height ||
                  height;

                return height;
              })
              .filter(h => h)
              .flatMap(h =>
                _.range(
                  1,
                  7,
                )
                .map(i =>
                  h + i
                )
              )
          ),
          [],
          ['asc'],
        );

      for (const height of heights) {
        lcd(
          '/cosmos/tx/v1beta1/txs',
          {
            events: `tx.height=${height}`,
          },
        );
      }

      await sleep(
        (heights.length > 5 ?
          3 :
          heights.length > 0 ?
            2 :
            0
        ) *
        1000
      );

      const _data =
        _.uniqBy(
          data
            .filter(d =>
              evm_chains_data
                .findIndex(c =>
                  equals_ignore_case(
                    c?.id,
                    d.event.returnValues?.destinationChain,
                  )
                ) > -1
            )
            .map(d => {
              const {
                vote,
              } = { ...d };

              const transfer_id =
                vote?.transfer_id ||
                d.transfer_id;

              return {
                ...d,
                transfer_id,
              };
            })
            .filter(d => d.transfer_id),
          'transfer_id',
        );

      _data
        .forEach(async d => {
          const {
            event,
            vote,
            transfer_id,
          } = { ...d };
          let {
            sign_batch,
          } = { ...d };
          const {
            id,
            returnValues,
          } = { ...event };
          let {
            destinationChain,
          } = { ...returnValues };

          destinationChain = destinationChain?.toLowerCase();

          const command_id =
            transfer_id
              .toString(16)
              .padStart(
                64,
                '0',
              );

          const _response =
            await read(
              'batches',
              {
                bool: {
                  must: [
                    { match: { chain: destinationChain } },
                    {
                      bool: {
                        should: [
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                    { match: { command_ids: command_id } },
                  ],
                },
              },
              {
                size: 1,
              },
            );

          const batch = _.head(_response?.data);

          if (batch) {
            const {
              batch_id,
              commands,
              created_at,
              status,
            } = { ...batch };

            const command = (commands || [])
              .find(c =>
                c?.id === command_id
              );

            let {
              executed,
              transactionHash,
              transactionIndex,
              logIndex,
              block_timestamp,
            } = { ...command };

            executed =
              executed ||
              !!transactionHash;

            if (!executed) {
              const chain_data = evm_chains_data
                .find(c =>
                  equals_ignore_case(
                    c?.id,
                    destinationChain,
                  )
                );

              const provider = getProvider(chain_data);

              const {
                chain_id,
                gateway_address,
              } = { ...chain_data };

              const gateway_contract =
                gateway_address &&
                new Contract(
                  gateway_address,
                  IAxelarGateway.abi,
                  provider,
                );

              try {
                if (gateway_contract) {
                  executed =
                    await gateway_contract
                      .isCommandExecuted(
                        `0x${command_id}`,
                      );
                }
              } catch (error) {}
            }

            if (!transactionHash) {
              const _response =
                await read(
                  'command_events',
                  {
                    bool: {
                      must: [
                        { match: { chain: destinationChain } },
                        { match: { command_id } },
                      ],
                    },
                  },
                  {
                    size: 1,
                  },
                );

              const command_event = _.head(_response?.data);

              if (command_event) {
                transactionHash = command_event.transactionHash;
                transactionIndex = command_event.transactionIndex;
                logIndex = command_event.logIndex;
                block_timestamp = command_event.block_timestamp;

                if (transactionHash) {
                  executed = true;
                }
              }
            }

            if (
              [
                'BATCHED_COMMANDS_STATUS_SIGNED',
              ].includes(status) ||
              executed
            ) {
              sign_batch = {
                ...sign_batch,
                chain: destinationChain,
                batch_id,
                created_at,
                command_id,
                transfer_id,
                executed,
                transactionHash,
                transactionIndex,
                logIndex,
                block_timestamp,
              };
            }
          }

          if (
            id &&
            sign_batch
          ) {
            const _id = id;

            await write(
              'token_sent_events',
              _id,
              {
                ...d,
                sign_batch,
              },
              true,
            );

            await saveTimeSpent(
              _id,
            );
          }
        });

      await sleep(
        (_data.length > 5 ?
          3 :
          _data.length > 0 ?
            1 :
            0
        ) *
        1000
      );

      response =
        await read(
          'token_sent_events',
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
            vote,
            sign_batch,
            ibc_send,
            axelar_transfer,
          } = { ...d };

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
                      'asset_sent';

          let simplified_status;

          switch (status) {
            case 'ibc_failed':
              simplified_status = 'failed';
              break;
            case 'executed':
              simplified_status = 'received';
              break;
            case 'ibc_sent':
            case 'batch_signed':
            case 'voted':
              simplified_status = 'approved';
              break;
            default:
              simplified_status = 'sent';
              break;
          }

          return {
            ...d,
            status,
            simplified_status,
          };
        });
  }

  return response;
};