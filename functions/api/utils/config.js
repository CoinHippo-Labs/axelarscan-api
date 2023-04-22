const {
  toBeHex,
} = require('ethers');
const _ = require('lodash');
const config = require('config-yml');

const {
  equalsIgnoreCase,
  toArray,
  capitalize,
  normalizeQuote,
} = require('./');

const {
  chains,
  contracts,
  endpoints,
  assets,
  tokens,
  tvl,
  supply,
} = { ...config };

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';

const getContracts = (
  environment = ENVIRONMENT,
) =>
  contracts?.[environment];

const getChains = (
  chain_types = [],
  environment = ENVIRONMENT,
) => {
  chain_types = toArray(chain_types);

  const _chains = chains?.[environment];

  return (
    Object.fromEntries(
      Object.entries({ ..._chains })
        .filter(([k, v]) => chain_types.length < 1 || chain_types.includes(k))
        .flatMap(([k, v]) =>
          Object.entries({ ...v })
            .map(([_k, _v]) => {
              const {
                chain_id,
                maintainer_id,
                deprecated,
                endpoints,
                native_token,
                name,
                explorer,
              } = { ..._v };

              const {
                rpc,
              } = { ...endpoints };

              const {
                url,
              } = { ...explorer };

              let provider_params;
              let gateway_address;
              let no_inflation;

              switch (k) {
                case 'evm':
                  provider_params = [
                    {
                      chainId: toBeHex(chain_id),
                      chainName: `${name} ${capitalize(environment)}`,
                      rpcUrls: toArray(rpc),
                      nativeCurrency: native_token,
                      blockExplorerUrls: [url],
                    },
                  ];
                  gateway_address = getContracts(environment)?.gateway_contracts?.[_k]?.address;
                  no_inflation = !!(!maintainer_id || deprecated || !gateway_address);
                  no_tvl = deprecated;
                  break;
                default:
                  break;
              }

              _v = {
                ..._v,
                id: _k,
                chain_type: k,
                provider_params,
                gateway_address,
                no_inflation,
                no_tvl,
              };

              return [_k, _v];
            })
        )
    )
  )
};

const getChainsList = (
  chain_types = [],
  environment = ENVIRONMENT,
) =>
  Object.values({ ...getChains(chain_types, environment) });

const getChainKey = (
  chain,
  chain_types = [],
  environment = ENVIRONMENT,
) => {
  let key;

  if (chain) {
    chain = normalizeQuote(chain, 'lower');

    key =
      _.head(
        Object.entries({ ...getChains(chain_types, environment) })
          .filter(([k, v]) => {
            const {
              id,
              chain_name,
              maintainer_id,
              prefix_address,
              prefix_chain_ids,
              chain_type,
            } = { ...v };

            return (
              toArray([id, chain_name, maintainer_id, prefix_address]).findIndex(s => equalsIgnoreCase(chain, s) || (chain_type !== 'evm' && chain.startsWith(s))) > -1 ||
              toArray(prefix_chain_ids).findIndex(p => chain.startsWith(p)) > -1
            );
          })
          .map(([k, v]) => k)
      );

    key = key || chain;
  }

  return key;
};

const getChainData = (
  chain,
  chain_types = [],
) =>
  chain && getChains(chain_types)[getChainKey(chain, chain_types)];

const getEndpoints = (
  environment = ENVIRONMENT,
) =>
  endpoints?.[environment];

const getRPC = () => getEndpoints()?.rpc;

const getLCD = () => getEndpoints()?.lcd;

const getAssets = (
  environment = ENVIRONMENT,
) =>
  assets?.[environment];

const getAssetsList = (
  environment = ENVIRONMENT,
) =>
  Object.values({ ...getAssets(environment) }).map(a => { return { ...a, id: a.denom }; });

const getAssetData = (
  asset,
  environment = ENVIRONMENT,
) =>
  asset && Object.values({ ...getAssets(environment) }).find(a => equalsIgnoreCase(a.denom, asset) || toArray(a.denoms).findIndex(d => equalsIgnoreCase(d, asset)) > -1 || equalsIgnoreCase(a.symbol, asset));

const getTokens = () => tokens;

const getTVL = (
  environment = ENVIRONMENT,
) =>
  tvl?.[environment];

const getSupply = (
  environment = ENVIRONMENT,
) =>
  supply?.[environment];

module.exports = {
  TX_COLLECTION: 'txs',
  BLOCK_COLLECTION: 'blocks',
  UPTIME_COLLECTION: 'uptimes',
  HEARTBEAT_COLLECTION: 'heartbeats',
  LCD_CACHE_COLLECTION: 'cosmos',
  POLL_COLLECTION: 'evm_polls',
  TRANSFER_COLLECTION: 'cross_chain_transfers',
  DEPOSIT_ADDRESS_COLLECTION: 'deposit_addresses',
  WRAP_COLLECTION: 'wraps',
  UNWRAP_COLLECTION: 'unwraps',
  ERC20_TRANSFER_COLLECTION: 'erc20_transfers',
  BATCH_COLLECTION: 'batches',
  COMMAND_EVENT_COLLECTION: 'command_events',
  IBC_CHANNEL_COLLECTION: 'ibc_channels',
  TVL_COLLECTION: 'tvls',
  ASSET_COLLECTION: 'assets',
  TOKEN_COLLECTION: 'tokens',
  CURRENCY: 'usd',
  TRANSFER_ACTIONS: ['ConfirmDeposit', 'ConfirmERC20Deposit'],
  VOTE_TYPES: ['VoteConfirmDeposit', 'Vote'],
  getContracts,
  getChains,
  getChainsList,
  getChainKey,
  getChainData,
  getEndpoints,
  getRPC,
  getLCD,
  getAssets,
  getAssetsList,
  getAssetData,
  getTokens,
  getTVL,
  getSupply,
};