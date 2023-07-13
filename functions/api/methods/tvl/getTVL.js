const { ZeroAddress } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const { getTokenSupply, getEVMBalance, getIBCSupply, getCosmosBalance } = require('./utils');
const _lcd = require('../lcd');
const { get, read, write } = require('../../services/index');
const { getTokensPrice } = require('../tokens');
const { getLCDs } = require('../../utils/chain/cosmos');
const { IBC_CHANNEL_COLLECTION, TVL_COLLECTION, getChainsList, getChainData, getAssets, getAssetData, getTVL } = require('../../utils/config');
const { toHash, getAddress } = require('../../utils/address');
const { toArray } = require('../../utils');

const { percent_diff_escrow_supply_threshold, percent_diff_total_supply_threshold } = { ...getTVL() };
const CACHE_AGE_SECONDS = 60 * 60;
const IBC_CHANNELS_UPDATE_INTERVAL_SECONDS = 240 * 60;

module.exports = async (params = {}) => {
  let output;

  const { asset, chain, force_update } = { ...params };
  let { assets, chains } = { ...params };
  assets = toArray(assets || asset);
  if (assets.length < 1) {
    assets = Object.keys({ ...getAssets() });
  }
  else {
    assets = toArray(assets.map(a => getAssetData(a)?.denom));
  }
  chains = toArray(chains || chain);
  if (chains.length < 1) {
    chains = getChainsList().filter(c => (c.gateway_address || c.chain_type === 'cosmos') && !c.no_tvl).map(c => c.id);
  }
  else {
    chains = _.uniq(_.concat('axelarnet', toArray(chains.map(c => getChainData(c)?.id))));
  }

  const evm_chains_data = getChainsList('evm').filter(c => chains.includes(c.id) && !c.no_tvl);
  const cosmos_chains_data = getChainsList('cosmos').filter(c => chains.includes(c.id) && !c.no_tvl);
  const has_all_evm_chains = evm_chains_data.length >= getChainsList('evm').filter(c => c.gateway_address && !c.no_tvl).length;
  const has_all_cosmos_chains = cosmos_chains_data.length >= getChainsList('cosmos').filter(c => !c.no_tvl).length;
  const has_all_chains = has_all_evm_chains && has_all_cosmos_chains;

  // set cache_id on querying single asset on every chains
  const cache_id = assets.length === 1 && has_all_chains && _.head(assets);
  let cache;
  if (!force_update) {
    // query cache
    if (cache_id) {
      cache = await get(TVL_COLLECTION, cache_id);
      const { updated_at } = { ...cache };
      if (moment().diff(moment((updated_at || 0) * 1000), 'seconds', true) < CACHE_AGE_SECONDS) {
        return cache;
      }
    }
    else if (assets.length > 1 && has_all_chains) {
      const response = await read(
        TVL_COLLECTION,
        {
          bool: {
            should: assets.map(a => { return { match: { _id: a } }; }),
            minimum_should_match: 1,
          },
        },
        { size: assets.length },
      );
      const { data } = { ...response };
      if (toArray(data).length > 0) {
        return {
          ...response,
          data: _.orderBy(
            toArray(data).flatMap(d => {
              const { data, updated_at } = { ...d };
              const tvl_data = _.head(data);
              const { total, price } = { ...tvl_data };
              return {
                ...tvl_data,
                value: (total || 0) * (price || 0),
                updated_at,
              };
            }),
            ['value'], ['desc'],
          ),
          updated_at: _.minBy(toArray(data), 'updated_at')?.updated_at,
        };
      }
    }
  }

  const lcds = Object.fromEntries(cosmos_chains_data.map(c => [c.id, getLCDs(c.id)]).filter(([k, v]) => v));
  const axelarnet = getChainData('axelarnet');
  const axelarnet_lcd_url = _.head(axelarnet.endpoints?.lcd);

  const data = [];
  for (const asset of assets) {
    const asset_data = getAssetData(asset);
    const { native_chain, addresses } = { ...asset_data };
    const is_native_on_evm = getChainsList('evm').findIndex(c => c.id === native_chain) > -1;
    const is_native_on_cosmos = getChainsList('cosmos').findIndex(c => c.id === native_chain) > -1;
    const is_native_on_axelarnet = native_chain === 'axelarnet';

    let tvl = Object.fromEntries(
      (await Promise.all(
        _.concat(evm_chains_data, cosmos_chains_data).map(c =>
          new Promise(
            async resolve => {
              const { id, endpoints, explorer, gateway_address, prefix_chain_ids, chain_type } = { ...c };
              const { url, address_path, contract_path, asset_path } = { ...explorer };
              let result;
              const lcd = lcds[id];
              const is_native = id === native_chain;
              switch (chain_type) {
                case 'evm':
                  try {
                    const contract_data = { ...asset_data, ...addresses?.[id] };
                    delete contract_data.addresses;
                    const { address } = { ...contract_data };
                    if (address) {
                      const gateway_balance = await getEVMBalance(gateway_address, contract_data, id);
                      const supply = !is_native ? await getTokenSupply(contract_data, id) : 0;
                      result = {
                        contract_data,
                        gateway_address,
                        gateway_balance,
                        supply,
                        total: is_native_on_cosmos ? 0 : gateway_balance + supply,
                        url: url && `${url}${(address === ZeroAddress ? address_path : contract_path).replace('{address}', address === ZeroAddress ? gateway_address : address)}${is_native && address !== ZeroAddress && gateway_address ? `?a=${gateway_address}` : ''}`,
                        success: typeof (is_native ? gateway_balance : supply) === 'number',
                      };
                    }
                  } catch (error) {}
                  break;
                case 'cosmos':
                  try {
                    const denom_data = { ...asset_data, ...addresses?.[id], denom: addresses?.axelarnet?.ibc_denom };
                    delete denom_data.addresses;
                    const { denom, ibc_denom } = { ...denom_data };
                    if (ibc_denom && lcd) {
                      let ibc_channels;
                      let escrow_addresses;
                      let source_escrow_addresses;
                      if (ibc_denom && toArray(prefix_chain_ids).length > 0 && id !== 'axelarnet') {
                        for (let i = 0; i < 2; i++) {
                          const response = await read(
                            IBC_CHANNEL_COLLECTION,
                            {
                              bool: {
                                must: [
                                  { match: { state: 'STATE_OPEN' } },
                                ],
                                should: toArray(prefix_chain_ids).map(p => { return { match_phrase_prefix: { chain_id: p } }; }),
                                minimum_should_match: 1,
                              },
                            },
                            { size: 500 },
                          );
                          const { data } = { ...response };
                          if (toArray(data).length > 0 && toArray(data).filter(d => moment().diff(moment((d.updated_at || 0) * 1000), 'seconds', true) > IBC_CHANNELS_UPDATE_INTERVAL_SECONDS).length < 1) {
                            ibc_channels = data;
                            escrow_addresses = toArray(toArray(ibc_channels).map(d => d.escrow_address));
                            source_escrow_addresses = toArray(toArray(ibc_channels).map(d => d.counterparty?.escrow_address));
                            break;
                          }
                          else {
                            await _lcd('/ibc/core/channel/v1/channels');
                          }
                        }
                      }

                      const escrow_balance = _.sum(
                        await Promise.all(
                          toArray(escrow_addresses).map(escrow_address =>
                            new Promise(
                              async resolve => {
                                resolve(await getCosmosBalance(escrow_address, denom_data, 'axelarnet'));
                              }
                            )
                          )
                        )
                      );
                      const source_escrow_balance = _.sum(
                        await Promise.all(
                          toArray(source_escrow_addresses).map(escrow_address =>
                            new Promise(
                              async resolve => {
                                resolve(await getCosmosBalance(escrow_address, denom_data, id));
                              }
                            )
                          )
                        )
                      );

                      const is_native_on_cosmos = is_native && id !== 'axelarnet';
                      const is_not_native_on_axelarnet = !is_native && id === 'axelarnet';
                      const lcd_url = _.head(endpoints?.lcd);
                      const supply = is_native ? id !== 'axelarnet' ? source_escrow_balance : 0 : toArray(escrow_addresses).length > 0 ? await getIBCSupply(denom_data, id) : 0;
                      const total_supply = is_native_on_cosmos ? await getIBCSupply(denom_data, 'axelarnet') : 0;
                      const percent_diff_supply = is_native_on_cosmos ? total_supply > 0 && source_escrow_balance > 0 ? Math.abs(source_escrow_balance - total_supply) * 100 / source_escrow_balance : null : supply > 0 && escrow_balance > 0 ? Math.abs(escrow_balance - supply) * 100 / escrow_balance : null;
                      const total = is_not_native_on_axelarnet ? await getIBCSupply(denom_data, id) : 0;

                      result = {
                        denom_data,
                        ibc_channels,
                        escrow_addresses,
                        escrow_balance,
                        source_escrow_addresses,
                        source_escrow_balance,
                        supply,
                        total,
                        percent_diff_supply,
                        is_abnormal_supply: percent_diff_supply > percent_diff_escrow_supply_threshold,
                        url: url && address_path && toArray(source_escrow_addresses).length > 0 && is_native_on_cosmos ?
                          `${url}${address_path.replace('{address}', _.last(source_escrow_addresses))}` :
                          url && asset_path && ibc_denom?.includes('/') ?
                            `${url}${asset_path.replace('{ibc_denom}', Buffer.from(_.last(toArray(ibc_denom, 'normal', '/'))).toString('base64'))}` :
                            axelarnet.explorer?.url && axelarnet.explorer.address_path && toArray(escrow_addresses).length > 0 ?
                              `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', _.last(escrow_addresses))}` :
                              null,
                        escrow_addresses_urls: toArray(
                          is_native_on_cosmos ?
                            _.reverse(_.cloneDeep(toArray(source_escrow_addresses))).flatMap(a => [
                              url && address_path && `${url}${address_path.replace('{address}', a)}`,
                              ibc_denom && `${lcd_url}/cosmos/bank/v1beta1/balances/${a}/by_denom?denom=${encodeURIComponent(ibc_denom)}`,
                              `${lcd_url}/cosmos/bank/v1beta1/balances/${a}`,
                            ]) :
                            _.reverse(_.cloneDeep(toArray(escrow_addresses))).flatMap(a => [
                              axelarnet.explorer?.url && axelarnet.explorer.address_path && `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', a)}`,
                              denom && `${axelarnet_lcd_url}/cosmos/bank/v1beta1/balances/${a}/by_denom?denom=${encodeURIComponent(denom)}`,
                              `${axelarnet_lcd_url}/cosmos/bank/v1beta1/balances/${a}`,
                            ])
                        ),
                        supply_urls: toArray(!is_native_on_cosmos && toArray(escrow_addresses).length > 0 && [ibc_denom && `${lcd_url}/cosmos/bank/v1beta1/supply/${encodeURIComponent(ibc_denom)}`, `${lcd_url}/cosmos/bank/v1beta1/supply`]),
                        success: typeof (is_not_native_on_axelarnet ? total : supply) === 'number' || !ibc_denom,
                      };
                    }
                  } catch (error) {}
                  break;
                default:
                  break;
              }
              resolve([id, result]);
            }
          )
        )
      )).filter(([k, v]) => v)
    );
    tvl = Object.fromEntries(
      Object.entries(tvl).map(([k, v]) => {
        const { total } = { ...v };
        let { supply } = { ...v };
        if (getChainData(k)?.chain_type === 'cosmos') {
          supply = k === 'axelarnet' ? is_native_on_evm ? total - _.sum(toArray(Object.entries(tvl).filter(([k, v]) => getChainData(k)?.chain_type === 'cosmos').map(([k, v]) => v.supply))) : is_native_on_cosmos ? total ? total - _.sum(toArray(Object.entries(tvl).filter(([k, v]) => getChainData(k)?.chain_type === 'evm').map(([k, v]) => v.supply))) : 0 : supply : supply;
        }
        return [k, { ...v, supply }];
      })
    );

    const total_on_evm = _.sum(toArray(Object.entries(tvl).filter(([k, v]) => getChainData(k)?.chain_type === 'evm').map(([k, v]) => v.supply)));
    const total_on_cosmos = _.sum(toArray(Object.entries(tvl).filter(([k, v]) => getChainData(k)?.chain_type === 'cosmos' && k !== native_chain).map(([k, v]) => v[has_all_cosmos_chains ? is_native_on_cosmos ? 'supply' : 'total' : 'escrow_balance'])));
    const total = is_native_on_axelarnet || is_native_on_cosmos ? total_on_evm + total_on_cosmos : _.sum(toArray(Object.values(tvl).map(d => is_native_on_evm ? d.gateway_balance : d.total)));
    const evm_escrow_address = is_native_on_cosmos ? getAddress(is_native_on_axelarnet ? asset : `ibc/${toHash(`transfer/${_.last(tvl[native_chain]?.ibc_channels)?.channel_id}/${asset}`)}`, axelarnet.prefix_address, 32) : undefined;
    const evm_escrow_balance = evm_escrow_address && await getCosmosBalance(evm_escrow_address, { ...asset_data, ...addresses?.axelarnet }, 'axelarnet');
    const evm_escrow_address_urls = evm_escrow_address && toArray([axelarnet.explorer?.url && axelarnet.explorer.address_path && `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', evm_escrow_address)}`, `${axelarnet_lcd_url}/cosmos/bank/v1beta1/balances/${evm_escrow_address}`]);
    const percent_diff_supply = evm_escrow_address ? evm_escrow_balance > 0 && total_on_evm > 0 ? Math.abs(evm_escrow_balance - total_on_evm) * 100 / evm_escrow_balance : null : total > 0 && total_on_evm >= 0 && total_on_cosmos >= 0 && total_on_evm + total_on_cosmos > 0 ? Math.abs(total - (total_on_evm + total_on_cosmos)) * 100 / total : null;

    data.push({
      asset,
      price: await getTokensPrice(asset),
      tvl,
      total_on_evm,
      total_on_cosmos,
      total,
      evm_escrow_address,
      evm_escrow_balance,
      evm_escrow_address_urls,
      percent_diff_supply,
      is_abnormal_supply: percent_diff_supply > (evm_escrow_address ? percent_diff_escrow_supply_threshold : percent_diff_total_supply_threshold),
      percent_diff_escrow_supply_threshold,
      percent_diff_total_supply_threshold,
      success: Object.values(tvl).filter(d => !d.success).length < 1,
    });
  }

  output = {
    data,
    updated_at: moment().unix(),
  };

  let not_updated_on_chains;
  if (data.length < 1 && cache) {
    output = cache;
  }
  else if (cache_id) {
    const has_not_success = data.filter(d => !d.success).length > 0;
    // cache
    if (!has_not_success) {
      await write(TVL_COLLECTION, cache_id, output);
    }
    else {
      not_updated_on_chains = data.filter(d => !d.success).flatMap(d => Object.entries(d.tvl).filter(([k, v]) => v && !v.success).map(([k, v]) => k));
    }
  }

  return {
    ...output,
    not_updated_on_chains,
  };
};