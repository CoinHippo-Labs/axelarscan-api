const { toBeHex } = require('ethers');
const _ = require('lodash');
const config = require('config-yml');

const { equalsIgnoreCase, toArray, capitalize, normalizeQuote } = require('./');

const {
  chains,
  contracts,
  deposits,
  endpoints,
  assets,
  tokens,
  tvl,
  supply,
  routes,
} = { ...config };

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';

const getContracts = (environment = ENVIRONMENT) => contracts?.[environment];
const getDeposits = (environment = ENVIRONMENT) => deposits?.[environment];
const getChains = (chain_types = [], environment = ENVIRONMENT, for_crawler = false) => {
  chain_types = toArray(chain_types);
  const _chains = chains?.[environment];
  return (
    Object.fromEntries(
      Object.entries({ ..._chains })
        .filter(([k, v]) => chain_types.length < 1 || chain_types.includes(k))
        .flatMap(([k, v]) =>
          Object.entries({ ...v }).map(([_k, _v]) => {
            const { chain_id, maintainer_id, deprecated, endpoints, native_token, name, explorer } = { ..._v };
            const { private_rpc } = { ...endpoints };
            let { rpc } = { ...endpoints };
            const { url } = { ...explorer };
            if (private_rpc) {
              if (for_crawler) {
                rpc = _.uniq(toArray(_.concat(toArray(private_rpc), toArray(private_rpc).length < 1 && toArray(rpc))));
                _v.endpoints.rpc = rpc;
              }
              delete _v.endpoints.private_rpc;
            }

            let provider_params;
            let gateway_address;
            let no_inflation;
            switch (k) {
              case 'evm':
                provider_params = [{
                  chainId: toBeHex(chain_id).replace('0x0', '0x'),
                  chainName: `${name} ${capitalize(environment)}`,
                  rpcUrls: toArray(rpc),
                  nativeCurrency: native_token,
                  blockExplorerUrls: [url],
                }];
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
const getChainsList = (chain_types = [], environment = ENVIRONMENT) => Object.values({ ...getChains(chain_types, environment) });
const getChainKey = (chain, chain_types = [], environment = ENVIRONMENT) => {
  let key;
  if (chain) {
    chain = normalizeQuote(chain, 'lower');
    key = _.head(
      Object.entries({ ...getChains(chain_types, environment) })
        .filter(([k, v]) => {
          const { id, chain_name, maintainer_id, prefix_address, prefix_chain_ids, chain_type } = { ...v };
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
const getChainData = (chain, chain_types = []) => chain && getChains(chain_types)[getChainKey(chain, chain_types)];
const getEndpoints = (environment = ENVIRONMENT) => endpoints?.[environment];
const getRPC = () => getEndpoints()?.rpc;
const getLCD = () => getEndpoints()?.lcd;
const getGMP = () => getEndpoints()?.gmp_api;
const getAssets = (environment = ENVIRONMENT) => assets?.[environment];
const getAssetsList = (environment = ENVIRONMENT) => Object.values({ ...getAssets(environment) }).map(a => { return { ...a, id: a.denom }; });
const getAssetData = (asset, environment = ENVIRONMENT) => asset && Object.values({ ...getAssets(environment) }).find(a => equalsIgnoreCase(a.denom, asset) || toArray(a.denoms).findIndex(d => equalsIgnoreCase(d, asset)) > -1 || equalsIgnoreCase(a.symbol, asset) || toArray(Object.values({ ...a.addresses })).findIndex(_a => equalsIgnoreCase(_a.ibc_denom, asset) || equalsIgnoreCase(_a.symbol, asset)) > -1);
const getTokens = () => tokens;
const getTVL = (environment = ENVIRONMENT) => tvl?.[environment];
const getSupply = (environment = ENVIRONMENT) => supply?.[environment];
const getRoutes = () => Object.entries({ ...routes }).map(([k, v]) => {
  const { methods, parameters } = { ...v };
  return {
    ...v,
    id: k,
    methods: _.uniq(toArray(methods || 'post')),
    parameters: _.uniqBy(toArray(_.concat({ id: 'method', require: true, type: 'string', value: k }, parameters)), 'id'),
  };
});

module.exports = {
  ENVIRONMENT,
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
  RATES_COLLECTION: 'exchange_rates',
  CACHE_COLLECTION: 'cache',
  CURRENCY: 'usd',
  CONFIRM_TYPES: ['ConfirmDeposit', 'ConfirmERC20Deposit'],
  VOTE_TYPES: ['VoteConfirmDeposit', 'Vote'],
  GATEWAY_EVENTS: ['TokenSent', 'Executed'],
  TERRA_COLLAPSED_DATE: '20220512',
  getContracts,
  getDeposits,
  getChains,
  getChainsList,
  getChainKey,
  getChainData,
  getEndpoints,
  getRPC,
  getLCD,
  getGMP,
  getAssets,
  getAssetsList,
  getAssetData,
  getTokens,
  getTVL,
  getSupply,
  getRoutes,
};