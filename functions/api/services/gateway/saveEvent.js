const {
  BigNumber,
  utils: { formatUnits },
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
  write,
} = require('../index');
const assets_price = require('../assets-price');
const {
  update_link,
  update_send,
} = require('../transfers/utils');
const {
  equals_ignore_case,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
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
const assets_data =
  require('../../data')?.assets?.[environment] ||
  [];

const {
  gateway,
} = { ...config?.[environment] };
const {
  chains,
  contracts,
} = { ...gateway };

module.exports = async (
  params = {},
) => {
  let response;

  const {
    contractAddress,
  } = { ...params };
  let {
    event,
    chain,
  } = { ...params };

  if (chain) {
    chain = chain.toLowerCase();
  }

  const {
    endpoints,
  } = { ...chains?.[chain] };

  if (
    !(
      event &&
      chain &&
      contractAddress
    )
  ) {
    response = {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else if (!chains?.[chain]) {
    response = {
      error: true,
      code: 400,
      message: 'chain not valid',
    };
  }
  else if (
    !(
      endpoints?.rpc &&
      equals_ignore_case(
        contracts?.[chain]?.address,
        contractAddress,
      )
    )
  ) {
    response = {
      error: true,
      code: 500,
      message: 'wrong api configuration',
    };
  }
  else {
    const chain_data = evm_chains_data
      .find(c =>
        equals_ignore_case(
          c?.id,
          chain,
        )
      );

    // setup provider
    const provider =
      getProvider(
        chain_data,
      );

    const {
      _id,
      transactionHash,
      transactionIndex,
      logIndex,
      blockNumber,
    } = { ...event };

    const event_name = event.event;

    // initial variables
    let id =
      _id ||
      `${transactionHash}_${transactionIndex}_${logIndex}`;

    event.id = id;
    event.chain = chain;
    event.contract_address = contractAddress;

    // save each event
    switch (event_name) {
      case 'TokenSent':
        try {
          event = {
            ...(
              await getTransaction(
                provider,
                transactionHash,
                chain,
              )
            ),
            block_timestamp:
              await getBlockTime(
                provider,
                blockNumber,
              ),
            ...event,
          };

          const {
            block_timestamp,
            returnValues,
          } = { ...event };
          const {
            sender,
            destinationChain,
            destinationAddress,
            symbol,
          } = { ...returnValues };
          let {
            amount,
          } = { ...returnValues };

          if (block_timestamp) {
            event = {
              ...event,
              created_at:
                get_granularity(
                  moment(
                    block_timestamp * 1000
                  )
                  .utc()
                ),
            };
          }

          const {
            chain_id,
          } = { ...chain_data };

          const asset_data = assets_data
            .find(a =>
              equals_ignore_case(
                a?.symbol,
                symbol,
              ) ||
              (a?.contracts || [])
                .findIndex(c =>
                  c?.chain_id === chain_id &&
                  equals_ignore_case(
                    c?.symbol,
                    symbol,
                  )
                ) > -1
            );

          if (asset_data) {
            const {
              id,
              contracts,
            } = { ...asset_data };
            let {
              decimals,
            } = { ...asset_data };

            const contract_data = (contracts || [])
              .find(c =>
                c.chain_id === chain_id
              );

            if (contract_data) {
              decimals =
                contract_data.decimals ||
                decimals ||
                (
                  [
                    id,
                  ].findIndex(s =>
                    s?.includes('-wei')
                  ) > -1 ?
                    18 :
                    6
                );

              amount =
                Number(
                  formatUnits(
                    BigNumber.from(
                      amount ||
                      '0'
                    )
                    .toString(),
                    decimals,
                  )
                );

              const _response =
                await assets_price(
                  {
                    denom: id,
                    timestamp:
                      (block_timestamp ?
                        moment(
                          block_timestamp * 1000
                        ) :
                        moment()
                      )
                      .valueOf(),
                  },
                );

              let {
                price,
              } = {
                ...(
                  _.head(
                    _response
                  )
                ),
              };

              price =
                typeof price === 'number' ?
                  price :
                  undefined;

              event = {
                ...event,
                denom: id,
                amount,
                price,
                value:
                  typeof price === 'number' ?
                    amount * price:
                    undefined,
              };
            }
          }

          try {
            // cross-chain transfers
            const _response =
              await read(
                'wraps',
                {
                  bool: {
                    must: [
                      { match: { tx_hash_wrap: transactionHash } },
                      { match: { source_chain: chain } },
                    ],
                  },
                },
                {
                  size: 1,
                },
              );

            let wrap =
              _.head(
                _response?.data
              );

            if (wrap) {
              const {
                tx_hash,
              } = { ...wrap };

              if (tx_hash) {
                const data =
                  await getTransaction(
                    provider,
                    tx_hash,
                    chain,
                  );

                const {
                  blockNumber,
                  from,
                } = { ...data?.transaction };

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

            const type =
              wrap ?
                'wrap' :
                'send_token';

            const data = {
              type,
              wrap:
                wrap ||
                undefined,
            };

            let send = {
              txhash: transactionHash,
              height: blockNumber,
              status: 'success',
              type: 'evm',
              created_at: event.created_at,
              source_chain: chain,
              destination_chain: normalize_chain(destinationChain),
              sender_address: sender,
              recipient_address: contractAddress,
              denom: event.denom,
              amount: event.amount,
            };

            let link = {
              txhash: transactionHash,
              height: blockNumber,
              type: 'gateway',
              created_at: event.created_at,
              original_source_chain: chain,
              original_destination_chain: normalize_original_chain(destinationChain),
              source_chain: chain,
              destination_chain: normalize_chain(destinationChain),
              sender_address: sender,
              recipient_address: destinationAddress,
              denom: event.denom,
              asset: event.denom,
              price: event.price,
            };

            link =
              await update_link(
                link,
                send,
              );

            send =
              await update_send(
                send,
                link,
                data,
              );

            response = {
              send,
              link,
              data,
            };
          } catch (error) {}
        } catch (error) {}
        break;
      case 'Executed':
        try {
          event = {
            ...(
              await getTransaction(
                provider,
                transactionHash,
                chain,
              )
            ),
            block_timestamp:
              await getBlockTime(
                provider,
                blockNumber,
              ),
            ...event,
          };

          const {
            block_timestamp,
            returnValues,
          } = { ...event };
          let {
            commandId,
          } = { ...returnValues };

          if (commandId) {
            if (commandId.startsWith('0x')) {
              commandId =
                commandId
                  .substring(
                    2,
                  );
            }

            const _response =
              await read(
                'batches',
                {
                  match: { 'commands.id': commandId },
                },
                {
                  size: 1,
                },
              );

            const batch =
              _.head(
                _response?.data
              );

            const {
              batch_id,
            } = { ...batch };
            let {
              status,
              commands,
            } = { ...batch };

            const transaction = {
              transactionHash,
              transactionIndex,
              logIndex,
              block_timestamp,
            };

            await write(
              'command_events',
              `${chain}_${commandId}`.toLowerCase(),
              {
                ...transaction,
                chain,
                command_id: commandId,
                batch_id,
                blockNumber,
              },
            );

            if (batch_id) {
              const index = (commands || [])
                .findIndex(c =>
                  equals_ignore_case(
                    c?.id,
                    commandId,
                  )
                );

              if (index > -1) {
                commands[index] = {
                  ...commands[index],
                  ...transaction,
                  executed: true,
                };

                let command_events

                if (
                  commands
                    .findIndex(c =>
                      !c?.transactionHash
                    ) > -1
                ) {
                  const _response =
                    await read(
                      'command_events',
                      {
                        bool: {
                          must: [
                            { match: { chain } },
                          ],
                          should:
                            commands
                              .filter(c => !c?.transactionHash)
                              .map(c => {
                                const {
                                  id,
                                } = { ...c };

                                return {
                                  match: { command_id: id },
                                };
                              }),
                          minimum_should_match: 1,
                        },
                      },
                      {
                        size: 100,
                      },
                    );

                  command_events = _response?.data;
                }

                if (Array.isArray(command_events)) {
                  commands =
                    commands
                      .map(c => {
                        if (
                          c?.id &&
                          !c.transactionHash
                        ) {
                          const command_event = command_events
                            .find(_c =>
                              equals_ignore_case(
                                _c?.command_id,
                                c.id,
                              )
                            );

                          if (command_event) {
                            const {
                              transactionHash,
                              transactionIndex,
                              logIndex,
                              block_timestamp,
                            } = { ...command_event };

                            c.transactionHash = transactionHash;
                            c.transactionIndex = transactionIndex;
                            c.logIndex = logIndex;
                            c.block_timestamp = block_timestamp;

                            if (transactionHash) {
                              c.executed = true;
                            }
                          }
                        }

                        return c;
                      });
                }

                if (
                  ![
                    'BATCHED_COMMANDS_STATUS_SIGNED',
                  ].includes(status) &&
                  commands.length ===
                  commands
                    .filter(c => c?.executed)
                    .length
                ) {
                  status = 'BATCHED_COMMANDS_STATUS_SIGNED';
                }

                await write(
                  'batches',
                  batch_id,
                  {
                    ...batch,
                    status,
                    commands,
                    blockNumber,
                  },
                  true,
                );
              }
            }
          }
        } catch (error) {}
        break;
      default:
        break;
    }
  }

  return response;
};