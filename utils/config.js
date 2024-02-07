const config = require('config-yml');
const { toBeHex } = require('ethers');
const _ = require('lodash');

const { request } = require('./http');
const { toArray } = require('./parser');
const { equalsIgnoreCase, capitalize, removeDoubleQuote } = require('./string');

const { methods, chains, assets, its_assets, endpoints, tokens, supply, tvl } = { ...config };
const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';

const getMethods = () => methods;
const getChains = (chainTypes = [], env = ENVIRONMENT) => {
  chainTypes = toArray(chainTypes);
  return Object.fromEntries(
    Object.entries({ ...chains[env] }).filter(([k, v]) => chainTypes.length === 0 || chainTypes.includes(k)).flatMap(([k, v]) => Object.entries({ ...v }).map(([_k, _v]) => {
      let provider_params;
      let no_inflation;
      let no_tvl;
      switch (k) {
        case 'evm':
          provider_params = [{
            chainId: toBeHex(_v.chain_id).replace('0x0', '0x'),
            chainName: `${_v.name} ${capitalize(env)}`,
            rpcUrls: toArray(_v.endpoints?.rpc),
            nativeCurrency: _v.native_token,
            blockExplorerUrls: toArray([_v.explorer?.url]),
          }];
          no_inflation = !_v.maintainer_id || !!_v.deprecated;
          no_tvl = !!_v.deprecated;
          break;
        default:
          break;
      }
      _v = { ..._v, id: _k, chain_type: k, provider_params, no_inflation, no_tvl };
      return [_k, _v];
    }))
  );
};
const getChainsList = (chainTypes = [], env = ENVIRONMENT) => Object.values(getChains(chainTypes, env));
const getChainData = (chain, chainTypes = [], env = ENVIRONMENT) => chain && (getChains(chainTypes, env)[removeDoubleQuote(chain).toLowerCase()] || Object.values(getChains(chainTypes)).find(d => toArray(_.concat(d.chain_id, d.chain_name, d.maintainer_id, d.aliases)).findIndex(s => equalsIgnoreCase(s, removeDoubleQuote(chain))) > -1 || toArray(d.prefix_chain_ids).findIndex(p => chain.startsWith(p)) > -1));
const getChain = (chain, options) => {
  const { env, fromConfig } = { ...options };
  const chainsLookup = { terra: env !== 'mainnet' ? 'terra-3' : 'terra-2' };
  if (fromConfig && chainsLookup[chain]) return chainsLookup[chain];
  return getChainData(chain)?.id || chain;
}

const getAssets = async (env = ENVIRONMENT) => {
  const assetsData = assets[env];
  env = env !== 'mainnet' ? 'testnet' : env;
  const response = await request(`https://axelar-${env}.s3.us-east-2.amazonaws.com/configs/${env}-config-1.x.json`);

  Object.values({ ...response?.assets }).filter(d => d.type === 'gateway').forEach(d => {
    const denom = Object.entries({ ...assetsData }).find(([k, v]) => toArray(v.denoms).includes(d.id))?.[0] || d.id;
    let { addresses } = { ...assetsData[denom] };

    Object.entries({ ...d.chains }).forEach(([k, v]) => {
      const key = getChain(k, { fromConfig: true });
      let { symbol, address, ibc_denom } = { ...addresses?.[key] };
      symbol = d.id.endsWith('-uusdc') ? assetsData[denom]?.symbol : v.symbol || symbol;
      address = (v.tokenAddress?.startsWith('0x') ? v.tokenAddress : undefined) || address;
      ibc_denom = (v.tokenAddress === d.id || v.tokenAddress?.includes('/') ? v.tokenAddress : undefined) || ibc_denom;
      addresses = { ...addresses, [key]: { symbol, address, ibc_denom } };
    });
    const assetData = { denom, native_chain: getChain(d.originAxelarChainId, { fromConfig: true }), name: d.name || d.prettySymbol, symbol: d.id.endsWith('-uusdc') ? assetsData[denom]?.symbol : d.prettySymbol, decimals: d.decimals, image: d.iconUrl?.replace('/images/tokens/', '/logos/assets/'), coingecko_id: d.coingeckoId, addresses };
    assetsData[denom] = { ...assetsData[denom], ...assetData };
  });
  return Object.entries({ ...assetsData }).filter(([k, v]) => Object.values({ ...assetsData }).findIndex(d => toArray(d.denoms).includes(k)) < 0).map(([k, v]) => { return { ...v, id: k }; });
};
const getAssetsList = async (env = ENVIRONMENT) => Object.values(await getAssets(env));
const getAssetData = async (asset, assetsData, env = ENVIRONMENT) => {
  if (!asset) return;
  assetsData = assetsData || await getAssetsList(env);
  return toArray(assetsData).find(d => toArray(_.concat(d.denom, d.denoms, d.symbol)).findIndex(s => equalsIgnoreCase(s, asset)) > -1 || toArray(Object.values({ ...d.addresses })).findIndex(a => toArray([a.ibc_denom, a.symbol]).findIndex(s => equalsIgnoreCase(s, asset)) > -1) > -1);
};

const getITSAssets = async (env = ENVIRONMENT) => {
  const assetsData = its_assets[env];
  env = env !== 'mainnet' ? 'testnet' : env;
  const response = await request(`https://axelar-${env}.s3.us-east-2.amazonaws.com/configs/${env}-config-1.x.json`);

  Object.values({ ...response?.assets }).filter(d => d.type === 'customInterchain').forEach(d => {
    const i = assetsData.findIndex(_d => equalsIgnoreCase(_d.symbol, d.prettySymbol));
    if (i > -1) {
      const assetData = assetsData[i];
      assetData.id = d.id;
      assetData.decimals = assetData.decimals || d.decimals;
      assetData.image = assetData.image || d.iconUrl?.replace('/images/tokens/', '/logos/its/');
      assetData.coingecko_id = assetData.coingecko_id || d.coingeckoId;
      assetData.addresses = _.uniq(toArray(_.concat(assetData.addresses, Object.values({ ...d.chains }).map(_d => _d.tokenAddress))));
      assetsData[i] = assetData;
    }
    else {
      assetsData.push({
        id: d.id,
        symbol: d.prettySymbol,
        decimals: d.decimals,
        image: d.iconUrl?.replace('/images/tokens/', '/logos/its/'),
        coingecko_id: d.coingeckoId,
        addresses: _.uniq(toArray(Object.values({ ...d.chains }).map(_d => _d.tokenAddress))),
      });
    }
  });
  return assetsData;
};
const getITSAssetData = async (asset, env = ENVIRONMENT) => {
  if (!asset) return;
  return toArray(await getITSAssets()).find(d => toArray(_.concat(d.symbol, d.addresses)).findIndex(s => equalsIgnoreCase(s, asset)) > -1);
}

const getContracts = async (env = ENVIRONMENT) => await request(`${getGMPAPI(env)}/getContracts`);
const getEndpoints = (env = ENVIRONMENT) => endpoints[env];
const getRPC = (env = ENVIRONMENT) => getEndpoints(env)?.rpc;
const getLCD = (env = ENVIRONMENT) => getEndpoints(env)?.lcd;
const getAPI = (env = ENVIRONMENT) => getEndpoints(env)?.api;
const getGMPAPI = (env = ENVIRONMENT) => getEndpoints(env)?.gmp_api;
const getTokenTransferAPI = (env = ENVIRONMENT) => getEndpoints(env)?.token_transfer_api;
const getValidatorAPI = (env = ENVIRONMENT) => getEndpoints(env)?.validator_api;
const getAppURL = (env = ENVIRONMENT) => getEndpoints(env)?.app;
const getTokens = () => tokens;
const getSupplyConfig = (env = ENVIRONMENT) => supply[env];
const getTVLConfig = (env = ENVIRONMENT) => tvl[env];

module.exports = {
  ENVIRONMENT,
  IBC_CHANNEL_COLLECTION: 'ibc_channels',
  TVL_COLLECTION: 'tvls',
  TOKEN_PRICE_COLLECTION: 'token_prices',
  EXCHANGE_RATE_COLLECTION: 'exchange_rates',
  PRICE_ORACLE_API: 'https://api.coingecko.com/api/v3/',
  CURRENCY: 'usd',
  getMethods,
  getChains,
  getChainsList,
  getChainData,
  getChain,
  getAssets,
  getAssetsList,
  getAssetData,
  getITSAssets,
  getITSAssetData,
  getContracts,
  getEndpoints,
  getRPC,
  getLCD,
  getAPI,
  getGMPAPI,
  getTokenTransferAPI,
  getValidatorAPI,
  getAppURL,
  getTokens,
  getSupplyConfig,
  getTVLConfig,
};