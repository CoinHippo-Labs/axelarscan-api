const config = require('config-yml');
const {
  subscribeGateway,
} = require('./gateway');
const {
  getProvider,
} = require('../utils');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

const environment = process.env.ENVIRONMENT;

module.exports = () => {
  // initial config parameters of this environment
  const {
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
          provider: getProvider(k),
          gateway: {
            ...gateway_contracts?.[k],
            abi: IAxelarGateway.abi,
          },
        };
      });

  // subscribe contracts on all chains
  subscribeGateway(chains_config);
};