const {
  constants: { AddressZero },
  providers: { FallbackProvider },
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');

const {
  getContractSupply,
  getEVMBalance,
  getCosmosBalance,
  getCosmosSupply,
  getAxelarnetSupply,
} = require('./utils');
const lcd_index = require('../lcd');
const {
  get,
  read,
  write,
} = require('../index');
const assets_price = require('../assets-price');
const {
  equals_ignore_case,
  createRpcProvider,
} = require('../../utils');
const {
  to_hash,
  get_address,
} = require('../../utils/address');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(evm_chains_data, cosmos_chains_data);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const assets_data = require('../../data')?.assets?.[environment] || [];

const {
  percent_diff_escrow_supply_threshold,
  percent_diff_total_supply_threshold,
} = { ...config?.[environment]?.tvl };

module.exports = async (
  params = {},
  force_update,
) => {
  let response;

  force_update = force_update || params.force_update;

  const {
    asset,
    chain,
  } = { ...params };
  let {
    assets,
    chains,
  } = { ...params };

  assets = assets || asset;
  assets = Array.isArray(assets) ? assets : (assets || '').split(',').filter(a => a);

  if (assets.length < 1) {
    assets = assets_data.map(a => a?.id);
  }
  else {
    assets =
      assets
        .map(a => {
          const asset_data = assets_data
            .find(_a =>
              equals_ignore_case(_a?.id, a) ||
              equals_ignore_case(_a?.symbol, a) ||
              (_a?.contracts || []).findIndex(c => equals_ignore_case(c?.symbol, a)) > -1 ||
              (_a?.ibc || []).findIndex(i => equals_ignore_case(i?.symbol, a)) > -1
            );

          const {
            id,
          } = { ...asset_data };

          return id || a;
        })
        .filter(a => assets_data.findIndex(_a => _a?.id === a) > -1);
  }

  chains = chains || chain;
  chains = Array.isArray(chains) ? chains : (chains || '').split(',').filter(c => c);

  if (chains.length < 1) {
    chains =
      _.uniq(
        chains_data
          .filter(c => !c?.maintainer_id || c.gateway_address)
          .flatMap(c => {
            const {
              id,
              overrides,
            } = { ...c };

            return (
              _.concat(
                Object.entries({ ...overrides })
                  .filter(([k, v]) => v?.tvl)
                  .map(([k, v]) => k),
                id,
              )
            );
          })
          .filter(c => chains_data.findIndex(_c => _c?.id === c || _c?.overrides?.[c]?.tvl) > -1)
      );
  }
  else {
    chains =
      _.uniq(
        _.concat(
          axelarnet.id,
          chains
            .flatMap(c => {
              const chain_data = chains_data
                .find(_c =>
                  equals_ignore_case(_c?.id, c) ||
                  equals_ignore_case(_c?.name, c) ||
                  equals_ignore_case(_c?.short_name, c) ||
                  _c?.overrides?.[c]?.tvl
                );

              const {
                id,
                overrides,
              } = { ...chain_data };

              return (
                _.concat(
                  Object.entries({ ...overrides })
                    .filter(([k, v]) => v?.tvl)
                    .map(([k, v]) => k),
                  id || c,
                )
              );
            })
            .filter(c => chains_data.findIndex(_c => _c?.id === c ||  _c?.overrides?.[c]?.tvl) > -1),
        )
      );
  }

  // filter by chains
  const _evm_chains_data = evm_chains_data.filter(c => chains.includes(c?.id));

  const _cosmos_chains_data =
    _.uniqBy(
      cosmos_chains_data
        .filter(c => {
          const {
            id,
            overrides,
          } = { ...c };

          return chains.findIndex(_c => _c === id || overrides?.[_c]?.tvl) > -1;
        })
        .flatMap(c => {
          const {
            id,
            overrides,
          } = { ...c };

          return (
            _.concat(
              Object.entries({ ...overrides })
                .filter(([k, v]) =>
                  chains.includes(k)
                )
                .map(([k, v]) => {
                  const _c = {
                    ...c,
                    ...v,
                  };

                  delete _c.overrides;
                  return _c;
                }),
              chains.includes(id) && c,
            )
          );
        })
        .filter(c => c),
      'id',
    );

  // set cache id on querying 1 asset on every chains
  const cache_id = assets.length === 1 && _evm_chains_data.length >= evm_chains_data.filter(c => c?.gateway_address).length && _cosmos_chains_data.length >= cosmos_chains_data.length && _.head(assets);

  let cache_data;

  // get cache
  if (cache_id && !force_update) {
    cache_data = await get('tvls', cache_id);

    const {
      updated_at,
    } = { ...cache_data };

    if (moment().diff(moment((updated_at || 0) * 1000), 'minutes', true) < 60) {
      return cache_data;
    }
  }
  else if (assets.length > 1 && _evm_chains_data.length >= evm_chains_data.filter(c => c?.gateway_address).length && _cosmos_chains_data.length >= cosmos_chains_data.length && !force_update) {
    const _response =
      await read(
        'tvls',
        {
          bool: {
            should: assets.map(a => { return { match: { _id: a } }; }),
            minimum_should_match: 1,
          },
        },
        {
          size: assets.length,
        },
      );

    const {
      data,
    } = { ..._response };

    if (Array.isArray(data)) {
      return {
        ..._response,
        data:
          _.orderBy(
            data.flatMap(d => {
              const {
                data,
                updated_at,
              } = { ...d };

              const _data = _.head(data);

              const {
                total,
                price,
              } = { ..._data };

              return {
                ..._data,
                value: (total || 0) * (price || 0),
                updated_at,
              };
            }),
            ['value'],
            ['desc'],
          ),
        updated_at: _.minBy(data, 'updated_at')?.updated_at,
      };
    }
  }

  // evm providers
  const providers =
    Object.fromEntries(
      _evm_chains_data.map(c => {
        const {
          id,
          chain_id,
          provider_params,
        } = { ...c };

        const {
          rpcUrls,
        } = { ..._.head(provider_params) };

        const rpcs = rpcUrls || [];
        rpcs = _.uniq(rpcs).filter(url => url);

        const provider =
          rpcs.length === 1 ?
            createRpcProvider(_.head(rpcs), chain_id) :
            new FallbackProvider(
              rpcs.map((url, i) => {
                return {
                  provider: createRpcProvider(url, chain_id),
                  priority: i + 1,
                  stallTimeout: 1000,
                };
              }),
              rpcs.length / 3,
            );

        return [
          id,
          provider,
        ];
      })
    );

  // cosmos lcds
  const lcds =
    Object.fromEntries(
      _cosmos_chains_data.map(c => {
        const {
          id,
          endpoints,
        } = { ...c };

        const {
          lcds,
        } = { ...endpoints };

        const _lcds = _.concat(lcds).filter(l => l);

        return [
          id,
          _lcds.map(url => axios.create({ baseURL: url, timeout: 5000, headers: { agent: 'axelarscan', 'Accept-Encoding': 'gzip' } })),
        ];
      })
    );

  const data = [];

  for (const asset of assets) {
    const asset_data = assets_data.find(a => a?.id === asset);

    const {
      contracts,
      ibc,
    } = { ...asset_data };

    // get tvl from rpc
    const evm_tvl =
      Object.fromEntries(
        await Promise.all(
          _evm_chains_data.map(c =>
            new Promise(
              async resolve => {
                const {
                  id,
                  chain_id,
                  explorer,
                  gateway_address,
                } = { ...c };

                const provider = providers[id];

                const contract_data = (contracts || []).find(_c => _c?.chain_id === chain_id);

                const {
                  contract_address,
                  is_native,
                } = { ...contract_data };

                let result;

                if (contract_data && provider) {
                  const gateway_balance = await getEVMBalance(gateway_address, contract_data, provider);

                  const supply = !is_native ? await getContractSupply(contract_data, provider) : 0;

                  result = {
                    contract_data,
                    gateway_address,
                    gateway_balance,
                    supply,
                    total: (ibc || []).findIndex(i => i?.is_native) > -1 ? 0 : gateway_balance + supply,
                    url: explorer?.url && `${explorer.url}${((contract_address === AddressZero ? explorer.address_path : explorer.contract_path) || '').replace('{address}', contract_address === AddressZero ? gateway_address : contract_address)}${is_native && contract_address !== AddressZero && gateway_address ? `?a=${gateway_address}` : ''}`,
                    success: typeof (is_native ? gateway_balance : supply) === 'number',
                  };
                }

                resolve(
                  [
                    id,
                    result,
                  ]
                );
              }
            )
          )
        )
      );

    // get tvl from lcd
    let cosmos_tvl =
      Object.fromEntries(
        await Promise.all(
          _cosmos_chains_data.map(c =>
            new Promise(
              async resolve => {
                const {
                  id,
                  endpoints,
                  overrides,
                } = { ...c };
                let {
                  explorer,
                  prefix_chain_ids,
                } = { ...c };

                let lcd_urls = _.concat(endpoints?.lcds).filter(l => l);
                let lcd_url = lcd_urls[_.random(lcd_urls.length - 1)];
                let _lcds = lcds[id];

                const ibc_data = (ibc || []).find(i => i?.chain_id === id);

                const {
                  ibc_denom,
                  original_chain_id,
                  is_native,
                } = { ...ibc_data };
                let {
                  decimals,
                } = { ...ibc_data };

                decimals = decimals || asset_data?.decimals;

                if (overrides?.[original_chain_id]) {
                  const override = overrides[original_chain_id];

                  explorer = override.explorer || explorer;
                  prefix_chain_ids = override.prefix_chain_ids || prefix_chain_ids;
                  lcd_urls = _.concat(override?.endpoints?.lcds).filter(l => l);
                  lcd_url = lcd_urls[_.random(lcd_urls.length - 1)] || lcd_url;
                }

                if (equals_ignore_case(id, original_chain_id)) {
                  _lcds = lcd_urls.map(url => axios.create({ baseURL: url, timeout: 5000, headers: { agent: 'axelarscan', 'Accept-Encoding': 'gzip' } } ));
                }

                let result;

                const denom_data = {
                  base_denom: asset_data?.id,
                  denom: ibc_denom,
                  decimals,
                  is_native,
                };

                let ibc_channels;
                let escrow_balance;
                let source_escrow_balance;
                let escrow_addresses;
                let source_escrow_addresses;

                if (ibc_denom && prefix_chain_ids?.length > 0) {
                  for (let i = 0; i < 2; i++) {
                    const _response =
                      await read(
                        'ibc_channels',
                        {
                          bool: {
                            must: [
                              { match: { state: 'STATE_OPEN' } },
                            ],
                            should: prefix_chain_ids.map(p => { return { match_phrase_prefix: { chain_id: p } }; }),
                            minimum_should_match: 1,
                          },
                        },
                        {
                          size: 500,
                        },
                      );

                    const {
                      data,
                    } = { ..._response };

                    if (data?.length > 0 && data.filter(d => moment().diff(moment((d?.updated_at || 0) * 1000), 'minutes', true) > 240).length < 1) {
                      ibc_channels = data;
                      escrow_addresses = ibc_channels.map(d => d?.escrow_address).filter(a => a);
                      source_escrow_addresses = ibc_channels.map(d => d?.counterparty?.escrow_address).filter(a => a);
                      break;
                    }
                    else {
                      await lcd_index('/ibc/core/channel/v1/channels');
                    }
                  }
                }

                if (escrow_addresses) {
                  for (const escrow_address of escrow_addresses) {
                    const balance = await getCosmosBalance(escrow_address, denom_data, lcds[axelarnet.id]);

                    if (typeof balance === 'number') {
                      escrow_balance = (escrow_balance || 0) + balance;
                    }
                  }
                }

                if (source_escrow_addresses) {
                  for (const escrow_address of source_escrow_addresses) {
                    const balance =
                      await getCosmosBalance(
                        escrow_address,
                        {
                          ...denom_data,
                          denom: (ibc || []).find(i => i?.chain_id === axelarnet.id)?.ibc_denom,
                        },
                        _lcds,
                      );

                    if (typeof balance === 'number') {
                      source_escrow_balance = (source_escrow_balance || 0) + balance;
                    }
                  }
                }

                const supply =
                  _lcds ?
                    is_native ?
                      id !== axelarnet.id ?
                        source_escrow_balance :
                        0 :
                      escrow_addresses?.length > 0 ?
                        await getCosmosSupply(denom_data, _lcds) :
                        0 :
                    0;

                const total_supply =
                  is_native && id !== axelarnet.id ?
                    await getAxelarnetSupply(
                      {
                        ...denom_data,
                        denom: (ibc || []).find(i => i?.chain_id === axelarnet.id)?.ibc_denom,
                      },
                      lcds[axelarnet.id],
                    ) :
                    0;

                const percent_diff_supply =
                  is_native && id !== axelarnet.id ?
                    total_supply > 0 && source_escrow_balance > 0 ?
                      Math.abs(source_escrow_balance - total_supply) * 100 / source_escrow_balance :
                      null :
                    supply > 0 && escrow_balance > 0 ?
                      Math.abs(escrow_balance - supply) * 100 / escrow_balance :
                      null;

                const total = id === axelarnet.id && !is_native ? await getAxelarnetSupply(denom_data, lcds[axelarnet.id]) : 0;

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
                  is_abnormal_supply: typeof percent_diff_escrow_supply_threshold === 'number' && percent_diff_supply > percent_diff_escrow_supply_threshold,
                  url:
                    explorer?.url && explorer.address_path && source_escrow_addresses?.length > 0 && is_native && id !== axelarnet.id ?
                      `${explorer.url}${explorer.address_path.replace('{address}', _.last(source_escrow_addresses))}` :
                      explorer?.url && explorer.asset_path && ibc_denom?.includes('/') ?
                        `${explorer.url}${explorer.asset_path.replace('{ibc_denom}', _.last(ibc_denom.split('/')))}` :
                        axelarnet.explorer?.url && axelarnet.explorer.address_path && escrow_addresses?.length > 0 ?
                          `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', _.last(escrow_addresses))}` :
                          null,
                  escrow_addresses_urls:
                    is_native && id !== axelarnet.id ?
                      _.reverse(_.cloneDeep(source_escrow_addresses || []))
                        .flatMap(a =>
                          [
                            explorer?.url && explorer.address_path && `${explorer.url}${explorer.address_path.replace('{address}', a)}`,
                            ibc_denom && `${lcd_url}/cosmos/bank/v1beta1/balances/${a}/by_denom?denom=${encodeURIComponent(ibc_denom)}`,
                            `${lcd_url}/cosmos/bank/v1beta1/balances/${a}`,
                          ]
                          .filter(l => l),
                        ) :
                      _.reverse(_.cloneDeep(escrow_addresses || []))
                        .flatMap(a =>
                          [
                            axelarnet.explorer?.url && axelarnet.explorer.address_path && `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', a)}`,
                            denom_data.base_denom && `${_.head(axelarnet.endpoints?.lcds)}/cosmos/bank/v1beta1/balances/${a}/by_denom?denom=${encodeURIComponent(denom_data.base_denom)}`,
                            `${_.head(axelarnet.endpoints?.lcds)}/cosmos/bank/v1beta1/balances/${a}`,
                          ]
                          .filter(l => l)
                        ),
                  supply_urls:
                    !(is_native && id !== axelarnet.id) && escrow_addresses?.length > 0 ?
                      [
                        ibc_denom && `${lcd_url}/cosmos/bank/v1beta1/supply/${encodeURIComponent(ibc_denom)}`,
                        `${lcd_url}/cosmos/bank/v1beta1/supply`,
                      ]
                      .filter(l => l) :
                      [],
                  success: typeof (id === axelarnet.id && !is_native ? total : supply) === 'number' || !ibc_denom,
                };

                resolve(
                  [
                    id,
                    result,
                  ]
                );
              }
            ),
          )
        )
      );

    cosmos_tvl =
      Object.fromEntries(
        Object.entries(cosmos_tvl)
          .map(([k, v]) => {
            const {
              supply,
              total,
            } = { ...v };

            return [
              k,
              {
                ...v,
                supply:
                  k === axelarnet.id ?
                    (contracts || []).findIndex(c => c?.is_native) > -1 ?
                      total - _.sum(Object.values(cosmos_tvl).map(_v => _v?.supply || 0)) :
                      (ibc || []).findIndex(i => i?.is_native) > -1 ?
                        total ?
                          total - _.sum(Object.values(evm_tvl).map(_v => _v?.supply ||  0)) :
                          0 :
                        supply :
                    supply,
              },
            ];
          })
      );

    const tvl = Object.fromEntries(_.concat(Object.entries(evm_tvl), Object.entries(cosmos_tvl)));

    // query price
    const _response = await assets_price({ denom: asset });

    const {
      price,
    } = { ..._.head(_response) };

    const total_on_evm = _.sumBy(Object.values(evm_tvl), 'supply');

    const total_on_cosmos =
      _.sumBy(
        Object.entries(cosmos_tvl)
          .filter(([k, v]) => (ibc || []).find(i => i?.is_native)?.chain_id !== k)
          .map(([k, v]) => v),
        _cosmos_chains_data.length >= cosmos_chains_data.length ?
          (ibc || []).findIndex(i => i?.is_native) > -1 ?
            'supply' :
            'total' :
          'escrow_balance',
      );

    const total =
      (ibc || []).findIndex(i => i?.is_native && i.chain_id === axelarnet.id) > -1 ?
        total_on_evm + total_on_cosmos :
        _.sum(
          Object.values(tvl)
            .map(t => {
              const {
                gateway_balance,
                total,
              } = { ...t };

              return ((contracts || []).findIndex(c => c?.is_native) > -1 ? gateway_balance : total) || 0;
            })
        );

    const evm_escrow_address =
      (ibc || []).findIndex(i => i?.is_native) > -1 ?
        get_address(
          ibc.find(i => i?.is_native).chain_id === axelarnet.id ?
            asset :
            `ibc/${to_hash(`transfer/${_.last(cosmos_tvl[(ibc || []).find(i => i?.is_native).chain_id]?.ibc_channels)?.channel_id}/${asset}`)}`,
          axelarnet.prefix_address,
          32,
        ) :
        undefined;

    const evm_escrow_balance =
      evm_escrow_address &&
      await getCosmosBalance(
        evm_escrow_address,
        {
          ...(ibc || []).find(i => i?.chain_id === axelarnet.id),
          base_denom: asset,
          denom: (ibc || []).find(i => i?.chain_id === axelarnet.id)?.ibc_denom,
        },
        lcds[axelarnet.id],
      );

    const evm_escrow_address_urls =
      evm_escrow_address &&
      [
        axelarnet.explorer?.url && axelarnet.explorer.address_path && `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', evm_escrow_address)}`,
        `${_.head(axelarnet.endpoints?.lcds)}/cosmos/bank/v1beta1/balances/${evm_escrow_address}`,
      ]
      .filter(l => l);

    const percent_diff_supply =
      evm_escrow_address ?
        evm_escrow_balance > 0 && total_on_evm > 0 ?
          Math.abs(evm_escrow_balance - total_on_evm) * 100 / evm_escrow_balance :
          null :
        total > 0 && total_on_evm >= 0 && total_on_cosmos >= 0 && total_on_evm + total_on_cosmos > 0 ?
          Math.abs(total - (total_on_evm + total_on_cosmos)) * 100 / total :
          null;

    data.push(
      {
        asset,
        price,
        tvl,
        total_on_evm,
        total_on_cosmos,
        total,
        evm_escrow_address,
        evm_escrow_balance,
        evm_escrow_address_urls,
        percent_diff_supply,
        is_abnormal_supply: evm_escrow_address ? typeof percent_diff_escrow_supply_threshold === 'number' && percent_diff_supply > percent_diff_escrow_supply_threshold : typeof percent_diff_total_supply_threshold === 'number' && percent_diff_supply > percent_diff_total_supply_threshold,
        percent_diff_escrow_supply_threshold,
        percent_diff_total_supply_threshold,
        success: Object.values({ ...evm_tvl }).filter(d => d && !d.success).length < 1 && Object.entries({ ...cosmos_tvl }).filter(([k, v]) => v && !v.success && ['terra'].findIndex(s => k?.includes(s)) < 0).length < 1,
      }
    );
  }

  response = {
    data,
    updated_at: moment().unix(),
  };

  let not_updated_on_chains;

  if (data.length < 1 && cache_data) {
    response = cache_data;
  }
  // save cache
  else if (cache_id && data.filter(d => !d?.success).length < 1) {
    await write('tvls', cache_id, response);
  }
  else if (cache_id && data.filter(d => !d?.success).length > 0) {
    not_updated_on_chains =
      data
        .filter(d => !d?.success)
        .flatMap(d =>
          Object.entries({ ...d?.tvl })
            .filter(([k, v]) => v && !v.success)
            .map(([k, v]) => k)
        );
  }

  return {
    ...response,
    not_updated_on_chains,
  };
};