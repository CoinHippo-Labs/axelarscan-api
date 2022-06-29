// import ethers.js
const {
  Contract,
  providers: { FallbackProvider, JsonRpcProvider },
} = require('ethers');
// import config
const config = require('config-yml');
// import subscriber
const gateway_subscriber = require('./services/subscriber/gateway/subscribe');
// IAxelarGateway
const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');

// import arguments
const commandLineArgs = require('command-line-args');
const optionDefinitions = [
  { name: 'environment', alias: 'e', type: String, defaultValue: 'testnet' },
  { name: 'chain', alias: 'c', type: String, defaultValue: 'ethereum' },
  { name: 'block', alias: 'b', type: Number, multiple: true },
];
const _options = commandLineArgs(optionDefinitions);
const { environment, chain, block } = { ..._options };
// initial number of block per query
const num_query_block = config?.[environment]?.past_events_block_per_request || 100;

// initial env config
const env_config = { ...config?.[environment] };
// initial chains config
const chains_config = Object.entries({ ...env_config?.chains }).filter(([k, v]) => v?.endpoints?.rpc?.length > 0).map(([k, v]) => {
  // initial rpc provider
  const rpcs = v.endpoints.rpc;
  const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
    return {
      provider: new JsonRpcProvider(url),
      priority: i + 1,
      stallTimeout: 1000,
    };
  }));
  // initial chain config
  const chain_config = {
    ...v,
    id: k,
    gateway: {
      ...env_config.gateway_contracts?.[k],
      abi: IAxelarGateway.abi,
    },
    provider,
  };
  return chain_config;
});

const chain_config = chains_config?.find(c => c?.id === chain);
if (chain_config) {
  const { gateway, provider } = { ...chain_config };
  // initial contract
  const gateway_contract = new Contract(gateway?.address, gateway?.abi, provider);

  // initial filters
  const gateway_filters = [
    gateway_contract.filters.TokenSent(),
  ];

  const run = async () => {
    const fromBlock = block?.[0], toBlock = block?.[1];
    const options = { fromBlock, toBlock, environment };
    let synced = false;
    while (!synced) {
      // check synced and set options
      if (typeof toBlock !== 'number' || typeof options.fromBlock !== 'number') {
        synced = true;
      }
      else if (toBlock - options.fromBlock >= num_query_block) {
        options.fromBlock = options.fromBlock + (options.toBlock === toBlock ? 0 : num_query_block);
        options.toBlock = options.fromBlock + num_query_block - 1;
        if (options.toBlock > toBlock) {
          options.toBlock = toBlock;
        }
      }
      else {
        options.fromBlock = options.toBlock === toBlock ? options.fromBlock : options.toBlock;
        options.toBlock = toBlock;
        synced = true;
      }
      // get past events
      await gateway_subscriber.getPastEvents(chain_config, gateway_filters, options);
    }
  };
  run();
}