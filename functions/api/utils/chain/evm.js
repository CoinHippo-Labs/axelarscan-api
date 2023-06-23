const { FallbackProvider, JsonRpcProvider } = require('ethers');
const _ = require('lodash');

const { getChainData } = require('../config');
const { toArray } = require('../');

const createRpcProvider = (url, chain_id) => new JsonRpcProvider(url, chain_id ? Number(chain_id) : undefined);

const getProvider = (chain, _rpcs) => {
  const { chain_id, deprecated, endpoints } = { ...getChainData(chain, 'evm') };
  const { rpc } = { ...endpoints };
  const rpcs = toArray(_rpcs || rpc);
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
            chain_id,
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