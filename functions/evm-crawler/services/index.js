const subscribeGateway = require('./gateway');
const { getProvider } = require('../utils/provider');
const { getChains, getContracts, getGateway } = require('../utils/config');
const { toArray } = require('../utils');

const IAxelarGateway = require('../data/contracts/interfaces/IAxelarGateway.json');

module.exports = async context => {
  const chains_data = toArray(await getChains());
  const contracts_data = await getContracts();
  const _chains_data = await Promise.all(
    chains_data.map(c =>
      new Promise(
        async resolve => {
          const { id } = { ...c };
          resolve({
            ...c,
            provider: await getProvider(id, chains_data),
            gateway: {
              ...await getGateway(id, contracts_data),
              abi: IAxelarGateway.abi,
            },
          });
        }
      )
    )
  );
  subscribeGateway(_chains_data, context);
};