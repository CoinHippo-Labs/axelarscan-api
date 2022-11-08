const {
  Contract,
} = require('ethers');
const config = require('config-yml');
const gateway_subscriber = require('./services/subscriber/gateway/subscribe');
const {
  getProvider,
} = require('./services/utils');
const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');

// setup arguments
const args = require('command-line-args')(
  [
    {
      name: 'environment',
      alias: 'e',
      type: String,
      defaultValue: 'testnet',
    },
    {
      name: 'chain',
      alias: 'c',
      type: String,
      defaultValue: 'avalanche',
    },
    {
      name: 'block',
      alias: 'b',
      type: Number,
      multiple: true,
    },
  ]
);
const {
  environment,
  chain,
  block,
} = { ...args };

// initial config parameters of this environment
const {
  past_events_block_per_request,
  chains,
  gateway_contracts,
} = { ...config?.[environment] };

// setup all chains' configuration including provider and contracts
const chains_config =
  Object.entries({ ...chains })
    .map(([k, v]) => {
      return {
        ...v,
        id: k,
        provider:
          getProvider(
            k,
            environment,
          ),
        gateway: {
          ...gateway_contracts?.[k],
          abi: IAxelarGateway.abi,
        },
      };
    });

// get the specific chain's configuration
const chain_config = chains_config
  .find(c =>
    c?.id === chain
  );

if (chain_config) {
  // chain configuration
  const {
    gateway,
    provider,
  } = { ...chain_config };

  // contract parameters
  const {
    address,
    abi,
  } = { ...gateway };

  if (address) {
    // initial contract
    const gateway_contract =
      new Contract(
        address,
        abi,
        provider,
      );

    // initial filters
    const gateway_filters =
      [
        gateway_contract.filters.TokenSent(),
        gateway_contract.filters.Executed(),
      ];

    /********************************************************
     * function to fetch past events emitted from contracts *
     ********************************************************/
    const run = async () => {
      // setup specific block range from args
      const fromBlock = block?.[0],
        toBlock = block?.[1];

      // number of block per past events querying
      const num_query_block =
        past_events_block_per_request ||
        100;

      // initial blockchain query filters options data
      const options = {
        fromBlock,
        toBlock,
        environment,
      };

      // flag to check whether is it query all data from specific block range
      let synced = false;

      // iterate until cover all
      while (!synced) {
        /* start if statement for checking & set the query filters options of each round */
        if (
          typeof toBlock !== 'number' ||
          typeof options.fromBlock !== 'number'
        ) {
          synced = true;
        }
        else if (toBlock - options.fromBlock >= num_query_block) {
          options.fromBlock =
            options.fromBlock +
            (options.toBlock === toBlock ?
              0 :
              num_query_block
            );

          options.toBlock = options.fromBlock + num_query_block - 1;

          if (options.toBlock > toBlock) {
            options.toBlock = toBlock;
          }
        }
        else {
          options.fromBlock =
            options.toBlock === toBlock ?
              options.fromBlock :
              options.toBlock;

          options.toBlock = toBlock;

          synced = true;
        }
        /* end if statement */

        // get past events from contracts
        await gateway_subscriber
          .getPastEvents(
            chain_config,
            gateway_filters,
            options,
          );
      }
    };

    // run function
    run();
  }
}