const {
  Contract,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const {
  getTimeSpent,
} = require('../../transfers/analyzing');
const {
  read,
  write,
} = require('../../../services/index');
const {
  getProvider,
} = require('../../../utils/chain/evm');
const {
  TRANSFER_COLLECTION,
  BATCH_COLLECTION,
  COMMAND_EVENT_COLLECTION,
  getChains,
  getChainKey,
  getChainData,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

module.exports = async (
  lcd_response = {},
  created_at,
) => {
  const {
    id,
    command_ids,
    status,
    chain,
    commands,
  } = { ...lcd_response };
  let {
    batch_id,
  } = { ...lcd_response };

  batch_id = batch_id || id;

  if (created_at) {
    created_at = moment(Number(created_at) * 1000).utc().valueOf();
  }
  else {
    const response = await read(BATCH_COLLECTION, { match_phrase: { batch_id } }, { size: 1 });
    created_at = moment(_.head(response?.data)?.created_at?.ms).valueOf();
  }

  lcd_response = {
    ...lcd_response,
    created_at: getGranularity(created_at),
  };

  const updated_transfers_data = {};

  if (status === 'BATCHED_COMMANDS_STATUS_SIGNED' && command_ids) {
    const {
      gateway_address,
    } = { ...getChainData(chain, 'evm') };

    const provider = getProvider(chain);
    const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);

    if (gateway) {
      let command = {
        chain,
        batch_id,
        created_at: lcd_response.created_at,
      };

      for (const command_id of command_ids.filter(c => parseInt(c, 16) > 0)) {
        try {
          const transfer_id = parseInt(command_id, 16);

          command = {
            ...command,
            command_id,
            transfer_id,
          };

          const response =
            await read(
              TRANSFER_COLLECTION,
              {
                bool: {
                  must: [
                    { exists: { field: 'send.txhash' } },
                  ],
                  should: [
                    { match: { 'confirm.transfer_id': transfer_id } },
                    { match: { 'vote.transfer_id': transfer_id } },
                    { match: { transfer_id } },
                  ],
                  minimum_should_match: 1,
                },
              },
              { size: 100 },
            );

          const {
            data,
          } = { ...response };

          const transfer_data = _.head(data);

          if (transfer_data) {
            const index = commands.findIndex(c => c.id === command_id);

            let {
              executed,
              transactionHash,
              transactionIndex,
              logIndex,
              block_timestamp,
            } = { ...transfer_data.command };

            executed = !!(executed || transactionHash || commands[index]?.executed);

            if (!executed) {
              try {
                executed = await gateway.isCommandExecuted(`0x${command_id}`);

                if (executed) {
                  if (index > -1) {
                    commands[index].executed = executed;
                  }
                }
              } catch (error) {}
            }

            if (!transactionHash) {
              const response =
                await read(
                  COMMAND_EVENT_COLLECTION,
                  {
                    bool: {
                      must: [
                        { match: { chain } },
                        { match: { command_id } },
                      ],
                    },
                  },
                  { size: 1 },
                );

              const command_event = _.head(response?.data);

              if (command_event) {
                transactionHash = command_event.transactionHash;
                transactionIndex = command_event.transactionIndex;
                logIndex = command_event.logIndex;
                block_timestamp = command_event.block_timestamp;

                if (transactionHash) {
                  executed = true;
                }

                if (index > -1) {
                  commands[index] = {
                    ...commands[index],
                    executed,
                    transactionHash,
                    transactionIndex,
                    logIndex,
                    block_timestamp,
                  };
                }
              }
            }

            command = {
              ...command,
              executed,
              transactionHash,
              transactionIndex,
              logIndex,
              block_timestamp,
            };

            for (const d of data) {
              const {
                send,
              } = { ...d };

              const {
                txhash,
                sender_address,
              } = { ...send };
              let {
                source_chain,
              } = { ...send };

              source_chain = getChainKey(getChains('cosmos').filter(c => c.id !== 'axelarnet').find(c => sender_address?.startsWith(c.prefix_address))?.id || source_chain);

              if (txhash && source_chain) {
                const _id = `${txhash}_${source_chain}`.toLowerCase();

                updated_transfers_data[_id] = {
                  ..d,
                  send: { ...send, source_chain },
                  command,
                  time_spent: getTimeSpent(d),
                };
              }
            }
          }
        } catch (error) {}
      }
    }
  }

  lcd_response = {
    ...lcd_response,
    batch_id,
    chain,
    commands,
  };

  if (status !== 'BATCHED_COMMANDS_STATUS_SIGNED' && commands.filter(c => !c.executed).length < 1) {
    lcd_response.status = 'BATCHED_COMMANDS_STATUS_SIGNED';
  }

  await write(BATCH_COLLECTION, batch_id, lcd_response);

  for (const entry of Object.entries(updated_transfers_data)) {
    const [
      id,
      data,
    ] = entry;

    await write(TRANSFER_COLLECTION, id, data, true);
  }

  return lcd_response;
};