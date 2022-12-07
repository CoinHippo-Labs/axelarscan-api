const {
  providers: { FallbackProvider, StaticJsonRpcProvider },
} = require('ethers');
const _ = require('lodash');
const config = require('config-yml');

const environment = process.env.ENVIRONMENT;

const {
  chains,
} = { ...config?.[environment] };

const chains_config = chains;

const getTransaction = async (
  provider,
  tx_hash,
  chain,
) => {
  let output;

  if (
    provider &&
    tx_hash
  ) {
    output = {
      id: tx_hash,
      chain,
    };

    try {
      // get transaction
      output.transaction =
        await provider
          .getTransaction(
            tx_hash,
          );

      // get receipt
      output.receipt =
        await provider
          .getTransactionReceipt(
            tx_hash,
          );
    } catch (error) {}
  }

  return output;
};

const getBlockTime = async (
  provider,
  block_number,
) => {
  let output;

  if (
    provider &&
    block_number
  ) {
    try {
      // get block
      const block =
        await provider
          .getBlock(
            block_number,
          );

      const {
        timestamp,
      } = { ...block };

      if (timestamp) {
        output = timestamp;
      }
    } catch (error) {}
  }

  return output;
};

const createRpcProvider = (
  url,
  chain_id,
) => 
  new StaticJsonRpcProvider(
    url,
    chain_id ?
      Number(chain_id) :
      undefined,
  );

const getProvider = (
  chain,
  env = environment,
) => {
  const {
    chains,
  } = { ...config?.[env] };

  const chains_config = chains;

  const {
    chain_id,
    endpoints,
  } = {
    ...chains_config?.[chain],
  };

  /* start normalize rpcs */
  let rpcs =
    endpoints?.rpc ||
    [];

  if (!Array.isArray(rpcs)) {
    rpcs = [rpcs];
  }

  rpcs =
    rpcs
      .filter(url => url);
  /* end normalize rpcs */

  const provider =
    rpcs.length > 0 ?
      rpcs.length === 1 ?
        createRpcProvider(
          _.head(rpcs),
          chain_id,
        ) :
        new FallbackProvider(
          rpcs
            .map((url, i) => {
              return {
                provider:
                  createRpcProvider(
                    url,
                    chain_id,
                  ),
                priority: i + 1,
                stallTimeout: 1000,
              };
            }),
          rpcs.length / 3,
        ) :
      null;

  return provider;
};

module.exports = {
  getTransaction,
  getBlockTime,
  getProvider,
};