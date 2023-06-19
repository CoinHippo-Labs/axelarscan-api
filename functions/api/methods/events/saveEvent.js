const { formatUnits } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const { getTransaction, getBlockTime, updateLink, updateSend } = require('../transfers/utils');
const { getTokensPrice } = require('../tokens');
const { read, write } = require('../../services/index');
const { getProvider } = require('../../utils/chain/evm');
const { WRAP_COLLECTION, ERC20_TRANSFER_COLLECTION, BATCH_COLLECTION, COMMAND_EVENT_COLLECTION, getContracts, getChainKey, getAssetData } = require('../../utils/config');
const { getGranularity } = require('../../utils/time');
const { toBigNumber } = require('../../utils/number');
const { equalsIgnoreCase, toArray } = require('../../utils');

module.exports = async (params = {}) => {
  let output;

  const { contractAddress } = { ...params };
  let { event, chain } = { ...params };
  chain = chain?.toLowerCase();
  const provider = getProvider(chain);

  if (!(event && chain && contractAddress)) {
    output = {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else if (!provider) {
    output = {
      error: true,
      code: 400,
      message: 'chain not valid',
    };
  }
  else if (!equalsIgnoreCase(getContracts().gateway_contracts[chain]?.address, contractAddress)) {
    output = {
      error: true,
      code: 400,
      message: 'contractAddress not valid',
    };
  }
  else {
    const { _id, transactionHash, transactionIndex, logIndex, blockNumber } = { ...event };
    const eventName = event.event;
    const id = _id || [transactionHash, transactionIndex, logIndex].join('_');
    event.id = id;
    event.chain = chain;
    event.contract_address = contractAddress;

    switch (eventName) {
      case 'TokenSent':
        try {
          event = {
            ...await getTransaction(provider, transactionHash, chain),
            block_timestamp: await getBlockTime(provider, blockNumber, chain),
            ...event,
          };

          const { block_timestamp, returnValues } = { ...event };
          const { sender, destinationChain, destinationAddress, symbol } = { ...returnValues };
          let { amount } = { ...returnValues };

          if (block_timestamp) {
            event = {
              ...event,
              created_at: getGranularity(moment(block_timestamp * 1000).utc()),
            };
          }

          const { denom, decimals, addresses } = { ...getAssetData(symbol) };
          if (denom && decimals) {
            amount = Number(formatUnits(toBigNumber(amount || '0'), decimals));
            const price = await getTokensPrice(denom, moment(block_timestamp * 1000).utc());
            event = {
              ...event,
              denom,
              amount,
              price,
              value: typeof price === 'number' ? amount * price : undefined,
            };
          }

          const [wrap, erc20_transfer] = await Promise.all(
            [WRAP_COLLECTION, ERC20_TRANSFER_COLLECTION].map(c =>
              new Promise(
                async resolve => {
                  let transfer_data;

                  switch (c) {
                    case WRAP_COLLECTION:
                      try {
                        const response = await read(
                          c,
                          {
                            bool: {
                              must: [
                                { match: { tx_hash_wrap: transactionHash } },
                                { match: { source_chain: chain } },
                              ],
                            },
                          },
                          { size: 1 },
                        );
                        transfer_data = _.head(response?.data);
                      } catch (error) {}
                      break;
                    case ERC20_TRANSFER_COLLECTION:
                      try {
                        const response = await read(
                          c,
                          {
                            bool: {
                              must: [
                                { match: { tx_hash_transfer: transactionHash } },
                                { match: { source_chain: chain } },
                              ],
                            },
                          },
                          { size: 1 },
                        );
                        transfer_data = _.head(response?.data);
                      } catch (error) {}
                      break;
                    default:
                      break;
                  }

                  const { tx_hash } = { ...transfer_data };
                  if (tx_hash) {
                    const data = await getTransaction(provider, tx_hash, chain);
                    const { blockNumber, from } = { ...data?.transaction };
                    if (blockNumber) {
                      const block_timestamp = await getBlockTime(provider, blockNumber, chain);
                      transfer_data = {
                        ...transfer_data,
                        txhash: tx_hash,
                        height: blockNumber,
                        type: 'evm',
                        created_at: getGranularity(moment(block_timestamp * 1000).utc()),
                        sender_address: from,
                      };
                    }
                  }
                  resolve(transfer_data);
                }
              )
            )
          );

          let send = {
            txhash: transactionHash,
            height: blockNumber,
            status: 'success',
            type: 'evm',
            created_at: event.created_at,
            source_chain: chain,
            destination_chain: getChainKey(destinationChain),
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
            original_destination_chain: getChainKey(destinationChain),
            source_chain: chain,
            destination_chain: getChainKey(destinationChain),
            sender_address: sender,
            recipient_address: destinationAddress,
            denom: event.denom,
            asset: event.denom,
            price: event.price,
          };

          const data = {
            type: wrap ? 'wrap' : erc20_transfer ? 'erc20_transfer' : 'send_token',
            wrap: wrap || undefined,
            erc20_transfer: erc20_transfer || undefined,
          };
          link = await updateLink(link, send);
          send = await updateSend(send, link, data);
          output = { send, link, data };
        } catch (error) {}
        break;
      case 'Executed':
        try {
          event = {
            ...await getTransaction(provider, transactionHash, chain),
            block_timestamp: await getBlockTime(provider, blockNumber, chain),
            ...event,
          };

          const { block_timestamp, returnValues } = { ...event };
          let { commandId } = { ...returnValues };

          if (commandId) {
            if (commandId.startsWith('0x')) {
              commandId = commandId.substring(2);
            }

            const response = await read(BATCH_COLLECTION, { match: { 'commands.id': commandId } }, { size: 1 });
            const batch = _.head(response?.data);
            const { batch_id } = { ...batch };
            let { status, commands } = { ...batch };

            const transaction_data = {
              transactionHash,
              transactionIndex,
              logIndex,
              block_timestamp,
            };

            await write(
              COMMAND_EVENT_COLLECTION,
              toArray([chain, commandId], 'lower').join('_'),
              {
                ...transaction_data,
                chain,
                command_id: commandId,
                batch_id,
                blockNumber,
              },
            );

            if (batch_id) {
              const index = toArray(commands).findIndex(c => equalsIgnoreCase(c.id, commandId));
              if (index > -1) {
                commands[index] = {
                  ...commands[index],
                  ...transaction_data,
                  executed: true,
                };

                let command_events;
                if (toArray(commands).findIndex(c => !c.transactionHash) > -1) {
                  const _response = await read(
                    COMMAND_EVENT_COLLECTION,
                    {
                      bool: {
                        must: [
                          { match: { chain } },
                        ],
                        should: toArray(commands).filter(c => !c.transactionHash).map(c => {return { match: { command_id: c.id } }; }),
                        minimum_should_match: 1,
                      },
                    },
                    { size: 100 },
                  );
                  command_events = _response?.data;
                }

                if (Array.isArray(command_events)) {
                  commands = commands.map(c => {
                    if (c.id && !c.transactionHash) {
                      const command_event = toArray(command_events).find(_c => equalsIgnoreCase(_c.command_id, c.id));
                      if (command_event) {
                        const { transactionHash, transactionIndex, logIndex, block_timestamp } = { ...command_event };
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

                if (status !== 'BATCHED_COMMANDS_STATUS_SIGNED' && commands.filter(c => !c.executed).length < 1) {
                  lcd_response.status = 'BATCHED_COMMANDS_STATUS_SIGNED';
                }
                output = await write(BATCH_COLLECTION, batch_id, { ...batch, status, commands, blockNumber }, true);
              }
            }
          }
        } catch (error) {}
        break;
      default:
        break;
    }
  }

  return output;
};