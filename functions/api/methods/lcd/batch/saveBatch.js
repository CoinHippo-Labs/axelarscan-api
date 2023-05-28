const {
  Contract,
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');

const {
  read,
  write,
} = require('../../../services/index');
const {
  getProvider,
} = require('../../../utils/chain/evm');
const {
  BATCH_COLLECTION,
  COMMAND_EVENT_COLLECTION,
  getChainData,
  getAssets,
  getLCD,
} = require('../../../utils/config');
const {
  equalsIgnoreCase,
  toArray,
} = require('../../../utils');

const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');
const IBurnableMintableCappedERC20 = require('../../../data/contracts/interfaces/IBurnableMintableCappedERC20.json');

const MAX_COMMANDS_PER_BATCH_TO_PROCESS_SALT = 15;

module.exports = async (
  path = '',
  lcd_response = {},
) => {
  const {
    id,
    command_ids,
    status,
  } = { ...lcd_response };
  let {
    batch_id,
  } = { ...lcd_response };

  batch_id = batch_id || id;

  let chain = _.head(_.slice(toArray(path, 'normal', '/'), -2));
  const chain_data = getChainData(chain, 'evm');
  chain = chain_data?.id || chain;

  const {
    gateway_address,
  } = { ...chain_data };

  const provider = getProvider(chain);
  const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);

  const response = await read(BATCH_COLLECTION, { match_phrase: { batch_id } }, { size: 1 });

  let {
    commands,
  } = { ..._.head(response?.data) };

  commands = toArray(commands);
  const _commands = _.cloneDeep(commands);

  for (const command_id of toArray(command_ids)) {
    const index = commands.findIndex(c => equalsIgnoreCase(c.id, command_id));
    let command = commands[index];

    if (!command) {
      const lcd = getLCD() && axios.create({ baseURL: getLCD(), timeout: 15000, headers: { 'Accept-Encoding': 'gzip' } });
      const response = await lcd.get('/axelar/evm/v1beta1/command_request', { params: { chain, id: command_id } }).catch(error => { return { error: error?.response?.data }; });

      const {
        error,
        data,
      } = { ...response };

      if (!error && data) {
        command = data;
      }
    }

    if (command) {
      const {
        params,
      } = { ...command };
      let {
        executed,
        deposit_address,
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

      if (!deposit_address && salt && (command_ids.length < MAX_COMMANDS_PER_BATCH_TO_PROCESS_SALT || _commands.filter(c => c.salt && !c.deposit_address).length < MAX_COMMANDS_PER_BATCH_TO_PROCESS_SALT || Math.random(0, 1) < 0.33)) {
        try {
          const asset_data = getAssets().find(a => !equalsIgnoreCase(a.native_chain, chain) && a.addresses?.[chain]?.address);

          const {
            addresses,
          } = { ...asset_data };

          const {
            address,
          } = { ...addresses?.[chain] };

          const erc20 = address && new Contract(address, IBurnableMintableCappedERC20.abi, provider);

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
    else if (command) {
      commands.push(command);
    }
  }

  commands = toArray(commands);

  if (commands.findIndex(c => !c.transactionHash) > -1) {
    const response =
      await read(
        COMMAND_EVENT_COLLECTION,
        {
          bool: {
            must: [
              { match: { chain } },
            ],
            should: _.concat({ match_phrase: { batch_id } }, commands.filter(c => !c.transactionHash).map(c => { return { match: { command_id: c.id } }; })),
            minimum_should_match: 1,
          },
        },
        { size: 100 },
      );

    const command_events = response?.data;

    if (Array.isArray(command_events)) {
      commands =
        commands.map(c => {
          if (c.id && !c.transactionHash) {
            const command_event = toArray(command_events).find(_c => equalsIgnoreCase(_c.command_id, c.id));

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
    commands: commands.filter(c => c.id),
  };

  if (status !== 'BATCHED_COMMANDS_STATUS_SIGNED' && commands.filter(c => !c.executed).length < 1) {
    lcd_response.status = 'BATCHED_COMMANDS_STATUS_SIGNED';
  }

  await write(BATCH_COLLECTION, batch_id, lcd_response);

  return lcd_response;
};