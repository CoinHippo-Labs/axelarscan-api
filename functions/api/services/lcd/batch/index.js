const {
  Contract,
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');

const {
  read,
  write,
} = require('../../index');
const {
  save_time_spent,
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  to_json,
  get_granularity,
  normalize_chain,
  getProvider,
} = require('../../../utils');
const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');
const IBurnableMintableCappedERC20 = require('../../../data/contracts/interfaces/IBurnableMintableCappedERC20.json');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(evm_chains_data, cosmos_chains_data);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);
const assets_data = require('../../../data')?.assets?.[environment] || [];

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  path = '',
  lcd_response = {},
  created_at,
) => {
  let response;

  const {
    id,
    command_ids,
  } = { ...lcd_response };
  let {
    batch_id,
    status,
  } = { ...lcd_response };

  batch_id = id;

  let chain = _.head(_.slice(path.split('/'), -2));

  const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, chain));

  const {
    chain_id,
    gateway_address,
  } = { ...chain_data };

  const provider = getProvider(chain_data);

  const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);

  chain = chain_data?.id || chain;

  const _response =
    await read(
      'batches',
      {
        match_phrase: { batch_id },
      },
      {
        size: 1,
      },
    );

  let {
    commands,
  } = { ..._.head(_response?.data) };

  commands = commands || [];

  if (command_ids) {
    const _commands = _.cloneDeep(commands);

    for (const command_id of command_ids) {
      if (command_id) {
        const index = commands.findIndex(c => equals_ignore_case(c?.id, command_id));
        let command = commands[index];

        if (!command) {
          const cli = axios.create({ baseURL: endpoints?.cli, timeout: 20000 });
          const _response = await cli.get('/', { params: { cmd: `axelard q evm command ${chain} ${command_id} -oj` } }).catch(error => { return { data: { error } }; });

          command = to_json(_response?.data?.stdout);
        }

        if (command) {
          let {
            executed,
            deposit_address,
            params,
          } = { ...command };

          const {
            salt,
          } = { ...params };

          if (!executed) {
            try {
              if (gateway) {
                executed = await gateway.isCommandExecuted(`0x${command_id}`);
              }
            } catch (error) {}
          }

          if (
            !deposit_address && salt &&
            (
              command_ids.length < 15 ||
              _commands.filter(c => c?.salt && !c.deposit_address).length < 15 ||
              Math.random(0, 1) < 0.3
            )
          ) {
            try {
              const asset_data = assets_data.find(a => (a?.contracts || []).findIndex(c => c?.chain_id === chain_id && !c.is_native) > -1);

              const {
                contracts,
              } = { ...asset_data };

              const contract_data = (contracts || []).find(c => c?.chain_id === chain_id);

              const {
                contract_address,
              } = { ...contract_data };

              const erc20 = contract_address && new Contract(contract_address, IBurnableMintableCappedERC20.abi, provider);

              if (erc20) {
                deposit_address = await erc20.depositAddress(salt);
              }
            } catch (error) {}
          }

          command = {
            ...command,
            executed,
            deposit_address,
          };
        }

        if (index > -1) {
          commands[index] = command;
        }
        else {
          commands.push(command);
        }
      }
    }
  }

  commands = commands.filter(c => c);

  if (commands.findIndex(c => !c.transactionHash) > -1) {
    const _response =
      await read(
        'command_events',
        {
          bool: {
            must: [
              { match: { chain } },
            ],
            should:
              _.concat(
                { match_phrase: { batch_id } },
                commands
                  .filter(c => !c.transactionHash)
                  .map(c => {
                    const {
                      id,
                    } = { ...c };

                    return {
                      match: { command_id: id },
                    };
                  }),
              ),
            minimum_should_match: 1,
          },
        },
        {
          size: 100,
        },
      );

    const command_events = _response?.data;

    if (Array.isArray(command_events)) {
      commands =
        commands.map(c => {
          if (c.id && !c.transactionHash) {
            const command_event = command_events.find(_c => equals_ignore_case(_c?.command_id, c.id));

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
  }

  lcd_response = {
    ...lcd_response,
    batch_id,
    chain,
    commands,
  };

  if (created_at) {
    created_at = moment(Number(created_at) * 1000).utc().valueOf();
  }
  else {
    const _response =
      await read(
        'batches',
        {
          match_phrase: { batch_id },
        },
        {
          size: 1,
        },
      );

    const {
      ms,
    } = { ..._.head(_response?.data)?.created_at };

    created_at = moment(ms).valueOf();
  }

  lcd_response = {
    ...lcd_response,
    created_at: get_granularity(created_at),
  };

  if (!['BATCHED_COMMANDS_STATUS_SIGNED'].includes(status) && commands.length === commands.filter(c => c.executed).length) {
    status = 'BATCHED_COMMANDS_STATUS_SIGNED';
    lcd_response.status = status;
  }

  if (['BATCHED_COMMANDS_STATUS_SIGNED'].includes(status) && command_ids && gateway) {
    const _command_ids = command_ids.filter(c => parseInt(c, 16) >= 1);

    // cross-chain transfers
    try {
      let command = {
        chain,
        batch_id,
        created_at: lcd_response.created_at,
      };

      for (const command_id of _command_ids) {
        const transfer_id = parseInt(command_id, 16);

        command = {
          ...command,
          command_id,
          transfer_id,
        };

        const _response =
          await read(
            'cross_chain_transfers',
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
            {
              size: 100,
            },
          );

        const {
          data,
        } = { ..._response };

        const _data = _.head(data);

        if (_data) {
          let {
            executed,
            transactionHash,
            transactionIndex,
            logIndex,
            block_timestamp,
          } = { ..._data.command };

          executed = !!(executed || transactionHash || commands.find(c => c.id === command_id)?.executed);

          if (!executed) {
            try {
              executed = await gateway.isCommandExecuted(`0x${command_id}`);

              if (executed) {
                const index = commands.findIndex(c => c.id === command_id);

                if (index > -1) {
                  commands[index].executed = executed;
                }
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
                      { match: { chain } },
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

            source_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => sender_address?.startsWith(c?.prefix_address))?.id || source_chain);

            if (txhash && source_chain) {
              const _id = `${txhash}_${source_chain}`.toLowerCase();

              await write(
                'cross_chain_transfers',
                _id,
                {
                  ...d,
                  send: {
                    ...send,
                    source_chain,
                  },
                  command,
                },
                true,
              );

              await save_time_spent(_id);
            }
          }
        }
      }
    } catch (error) {}
  }

  if (!['BATCHED_COMMANDS_STATUS_SIGNED'].includes(status) && commands.length === commands.filter(c => c.executed).length) {
    status = 'BATCHED_COMMANDS_STATUS_SIGNED';
    lcd_response.status = status;
  }

  // await write('batches', id, lcd_response);

  response = lcd_response;

  return response;
};