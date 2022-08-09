const {
  providers: { FallbackProvider, JsonRpcProvider },
} = require('ethers');
const config = require('config-yml');
const { subscribeGateway } = require('./gateway');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

// initial environment
const environment = process.env.ENVIRONMENT;

module.exports = () => {
  // initial env config
  const env_config = {
    ...config?.[environment],
  };
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
  // subscribe
  subscribeGateway(chains_config);
};