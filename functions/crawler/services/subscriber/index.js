const {
  providers: { FallbackProvider, JsonRpcProvider },
} = require('ethers');
const config = require('config-yml');
const { subscribeGateway } = require('./gateway');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

const environment = process.env.ENVIRONMENT;

module.exports = () => {
  // initial config parameters of this environment
  const {
    chains,
    gateway_contracts,
  } = { ...config?.[environment] };

  // setup all chains' configuration including provider and contracts
  const chains_config = Object.entries({ ...chains })
    .filter(([k, v]) => v?.endpoints?.rpc?.length > 0)
    .map(([k, v]) => {
      // setup provider
      const rpcs = v.endpoints.rpc;
      const provider = rpcs.length === 1 ?
        new JsonRpcProvider(rpcs[0]) :
        new FallbackProvider(
          rpcs.map((url, i) => {
            return {
              provider: new JsonRpcProvider(url),
              priority: i + 1,
              stallTimeout: 1000,
            };
          }),
          rpcs.length / 3,
        );

      return {
        ...v,
        id: k,
        provider,
        gateway: {
          ...gateway_contracts?.[k],
          abi: IAxelarGateway.abi,
        },
      };
    });

  // subscribe contracts on all chains
  subscribeGateway(chains_config);
};