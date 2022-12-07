const {
  Contract,
} = require('ethers');
const {
  getLatestEventBlock,
  saveEvent,
} = require('./');
const {
  log,
  sleep,
} = require('../../utils');

const environment = process.env.ENVIRONMENT;

const service_name = 'gateway-subscriber';

const past_events_block_per_request = 100;

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
          {
            ...data,
            chain,
            contractAddress: address,
          },
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

module.exports = {
  onEmit,
  getPastEvents,
};