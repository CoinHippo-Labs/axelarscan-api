const {
  providers: { FallbackProvider, JsonRpcProvider },
} = require('ethers');
const config = require('config-yml');

const environment = process.env.ENVIRONMENT;

const {
  chains,
} = { ...config?.[environment] };

const chains_config = chains;

// get chain provider
const getProvider = (
  chain,
  env = environment,
) => {
  const {
    chains,
  } = { ...config?.[env] };
  const chains_config = chains;
  const {
    rpc,
  } = { ...chains_config?.[chain]?.endpoints };

  /* start normalize rpcs */
  let rpcs = rpc;
  if (!Array.isArray(rpcs)) {
    rpcs = [rpcs];
  }
  rpcs = rpcs
    .filter(url => url);
  /* end normalize rpcs */

  const provider = rpcs.length > 0 ?
    rpcs.length === 1 ?
      new JsonRpcProvider(rpcs[0]) :
      new FallbackProvider(
        rpcs
          .map((url, i) => {
            return {
              provider: new JsonRpcProvider(url),
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
  getProvider,
};