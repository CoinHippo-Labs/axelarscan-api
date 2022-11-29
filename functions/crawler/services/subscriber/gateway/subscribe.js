const {
  Contract,
} = require('ethers');
const config = require('config-yml');
const {
  getLatestEventBlock,
  saveEvent,
} = require('../api');
const {
  log,
  sleep,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT;

const service_name = 'gateway-subscriber';

const {
  past_events_block_per_request,
} = { ...config?.[environment] };

const events_name =
  [
    'TokenSent',
    'Executed',
  ];

const onEmit = async (
  chain_config,
  data,
  env = environment,
) => {
  if (
    chain_config &&
    data
  ) {
    try {
      // chain configuration
      const {
        id,
        gateway,
      } = { ...chain_config };

      const chain = id;

      // contract parameters
      const {
        address,
        abi,
      } = { ...gateway };

      // event attributes
      const {
        transactionHash,
        transactionIndex,
        logIndex,
        event,
        args,
      } = { ...data };

      // set event id from transaction hash with index
      data.id = `${transactionHash}_${transactionIndex}_${logIndex}`;

      // construct returnValues from arguments
      if (
        args &&
        abi
      ) {
        const {
          inputs,
        } = {
          ...(
            abi
              .find(a =>
                a?.name === event
              )
          ),
        };

        const returnValues = {};

        if (inputs) {
          inputs
            .forEach((input, i) => {
              const {
                name,
              } = { ...input };

              if (name) {
                returnValues[name] = args[i];
              }
            });
        }

        data.returnValues = returnValues;
        delete data.args;
      }

      // normalize
      try {
        data =
          JSON.parse(
            JSON.stringify(data)
          );
      } catch (error) {}

      if (events_name.includes(event)) {
        log(
          'info',
          service_name,
          `event emitted: ${event}`,
          {
            chain,
            ...data,
          }
        );

        await saveEvent(
          data,
          chain,
          address,
          env,
        );
      }
    } catch (error) {
      log(
        'error',
        service_name,
        'general',
        {
          error: error?.message,
        },
      );
    }
  }
};

const getPastEvents = async (
  chain_config,
  filters,
  options,
) => {
  if (
    chain_config &&
    filters &&
    options
  ) {
    // chain configuration
    const {
      id,
      provider,
      gateway,
    } = { ...chain_config };

    const chain = id;

    // contract parameters
    const {
      address,
      abi,
    } = { ...gateway };

    if (address) {
      // initial contract
      const contract =
        new Contract(
          address,
          abi,
          provider,
        );

      // query options
      const {
        fromBlock,
        toBlock,
        environment,
      } = { ...options };

      log(
        'info',
        service_name,
        'get past gateway events',
        {
          chain,
          contract_address: address,
          options,
        },
      );

      // query events from contract
      const events =
        await contract
          .queryFilter(
            filters,
            fromBlock,
            toBlock,
          )
          .catch(error => {
            return {
              error,
            };
          });

      if (!events?.error) {
        if (events) {
          for (const event of events) {
            await onEmit(
              chain_config,
              event,
              environment,
            );
          }
        }

        return;
      }
      else {
        const {
          message,
        } = { ...events.error };

        log(
          'warn',
          service_name,
          'get past gateway events',
          {
            chain,
            contract_address: address,
            options,
            error: message,
          },
        );

        await sleep(1.5 * 1000);

        return (
          await getPastEvents(
            chain_config,
            filters,
            options,
          )
        );
      }
    }
  }

  return;
};

const sync = async (
  chain_config,
  filters,
) => {
  if (chain_config) {
    // chain configuration
    const {
      id,
      provider,
    } = { ...chain_config };

    const chain = id;

    // number of block per past events querying
    const num_query_block =
      past_events_block_per_request ||
      100;

    // get latest block
    let latest_events_block,
      latest_block;

    try {
      const latest_event_block = await getLatestEventBlock(chain);

      // block for each events group
      const {
        gateway_block,
      } = { ...latest_event_block?.latest };

      // set latest block from api & rpc response
      latest_events_block = gateway_block - num_query_block;
      latest_block = await provider.getBlockNumber();
    } catch (error) {}

    // initial blockchain query filters options data
    const options = {
      fromBlock:
        latest_events_block ?
          latest_events_block :
          latest_block ?
            latest_block - num_query_block :
            undefined,
      toBlock:
        latest_events_block ||
        latest_block ?
          latest_block :
          undefined,
    };

    // flag to check whether is it query all data from specific block range
    let synced = false;

    // iterate until cover all
    while (!synced) {
      /* start if statement for checking & set the query filters options of each round */
      if (
        typeof latest_block !== 'number' ||
        typeof options.fromBlock !== 'number'
      ) {
        synced = true;
      }
      else if (latest_block - options.fromBlock >= num_query_block) {
        options.fromBlock =
          options.fromBlock +
          (options.toBlock === latest_block ?
            0 :
            num_query_block
          );

        options.toBlock = options.fromBlock + num_query_block - 1;

        if (options.toBlock > latest_block) {
          options.toBlock = latest_block;
        }
      }
      else {
        options.fromBlock =
          options.toBlock === latest_block ?
            options.fromBlock :
            options.toBlock;

        options.toBlock = latest_block;

        synced = true;
      }
      /* end if statement */

      // get past events from contract
      await getPastEvents(
        chain_config,
        filters,
        options,
      );

      // update latest block
      if (!synced) {
        try {
          latest_block =
            await provider
              .getBlockNumber();
        } catch (error) {}
      }
    }
  }
};

module.exports = {
  onEmit,
  getPastEvents,
  sync,
};