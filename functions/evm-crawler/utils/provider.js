const { providers: { FallbackProvider, StaticJsonRpcProvider } } = require('ethers');
const _ = require('lodash');

const { getChainData } = require('./config');
const { toArray } = require('./');

const createRpcProvider = (url, chain_id) => new StaticJsonRpcProvider(url, chain_id ? Number(chain_id) : undefined);

const getProvider = async (chain, chains_data, env) => {
  const { chain_id, deprecated, endpoints } = { ...await getChainData(chain, chains_data, env) };
  const { rpc } = { ...endpoints };
  const rpcs = toArray(rpc);

  if (rpcs.length > 0 && !deprecated) {
    try {
      return (
        rpcs.length > 1 ?
          new FallbackProvider(
            rpcs.map((url, i) => {
              return {
                priority: i + 1,
                provider: createRpcProvider(url, chain_id),
                stallTimeout: 1000,
                weight: 1,
              };
            }),
            rpcs.length / 3,
          ) :
          createRpcProvider(_.head(rpcs), chain_id)
      );
    } catch (error) {}
  }
  return null;
};

module.exports = {
  getProvider,
};