const {
  providers: { FallbackProvider, JsonRpcProvider },
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
const {
  get,
  read,
  write,
} = require('../index');
const assets_price = require('../assets-price');
const {
  equals_ignore_case,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const data = require('../../data');
const evm_chains_data = data?.chains?.[environment]?.evm || [];
const cosmos_chains_data = data?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const assets_data = data?.assets?.[environment] || [];

const {
  endpoints,
  percent_diff_ibc_channel_supply_threshold,
  percent_diff_total_supply_threshold,
} = { ...config?.[environment] };

module.exports = async (
  params = {},
) => {
  let response;

  const {
    asset,
    chain,
  } = { ...params };
  let {
    assets,
    chains,
  } = { ...params };

  assets = assets || asset;
  assets = Array.isArray(assets) ?
    assets :
    (assets?.split(',') || []);

  if (assets.length < 1) {
    assets = assets_data.map(a => a?.id);
  }
  else {
    assets = assets
      .map(a => {
        const asset_data = assets_data.find(_a =>
          equals_ignore_case(_a?.id, a) ||
          equals_ignore_case(_a?.symbol, a) ||
          _a?.contracts?.findIndex(c => equals_ignore_case(c?.symbol, a)) > -1 ||
          _a?.ibc?.findIndex(i => equals_ignore_case(i?.symbol, a)) > -1
        );

        const {
          id,
        } = { ...asset_data };

        return id || a;
      })
      .filter(a => assets_data.findIndex(_a => _a?.id === a) > -1);
  }

  chains = chains || chain;
  chains = Array.isArray(chains) ?
    chains :
    (chains?.split(',') || []);

  if (chains.length < 1) {
    chains = chains_data.map(c => c?.id);
  }
  else {
    chains = _.uniq(
      _.concat(
        [axelarnet.id],
        chains
          .map(c => {
            const chain_data = chains_data.find(_c =>
              equals_ignore_case(_c?.id, c) ||
              equals_ignore_case(_c?.name, c) ||
              equals_ignore_case(_c?.short_name, c)
            );

            const {
              id,
            } = { ...chain_data };

            return id || c;
          })
          .filter(c => chains_data.findIndex(_c => _c?.id === c) > -1),
      )
    );
  }

  // filter by chains
  const _evm_chains_data = evm_chains_data.filter(c => chains.includes(c?.id));
  const _cosmos_chains_data = cosmos_chains_data.filter(c => chains.includes(c?.id));

  // set cache id on querying 1 asset on every chains
  const cache_id = assets.length === 1 &&
    _evm_chains_data.length === evm_chains_data.length &&
    _cosmos_chains_data.length === cosmos_chains_data.length &&
    _.head(assets);

  let cache_data;

  // get cache
  if (cache_id) {
    cache_data = await get(
      'tvls',
      cache_id,
    );

    const {
      updated_at,
    } = { ...cache_data };

    if (moment().diff(moment((updated_at || 0) * 1000), 'minutes', true) < 5) {
      return cache_data;
    }
  }

  // evm providers
  const providers = Object.fromEntries(
    _evm_chains_data.map(c => {
      const {
        id,
        provider_params,
      } = { ...c };
      const {
        rpcUrls,
      } = { ..._.head(provider_params) };

      const rpcs = rpcUrls?.filter(url => url) || [];
      const provider = rpcs.length === 1 ?
        new JsonRpcProvider(rpcs[0]) :
        new FallbackProvider(rpcs.map((url, i) => {
          return {
            provider: new JsonRpcProvider(url),
            priority: i + 1,
            stallTimeout: 1000,
          };
        }));

      return [
        id,
        provider,
      ];
    })
  );

  // cosmos lcds
  const lcds = Object.fromEntries(
    _cosmos_chains_data.map(c => {
      const {
        id,
        endpoints,
      } = { ...c };
      const {
        lcd,
        lcds,
      } = { ...endpoints };

      return [
        id,
        axios.create({ baseURL: lcd || _.head(lcds) }),
      ];
    })
  );

  // axelarnet lcd
  const axelarnet_lcd = axios.create({ baseURL: endpoints?.lcd });
  const cli = axios.create({ baseURL: endpoints?.cli });

  const data = [];

  for (const asset of assets) {
    const asset_data = assets_data.find(a => a?.id === asset);
    const {
      contracts,
      ibc,
    } = { ...asset_data };

    // get tvl from rpc
    const evm_tvl = await _evm_chains_data.reduce(async (acc, c) => {
      const {
        id,
        chain_id,
        explorer,
        gateway_address,
      } = { ...c };

      const provider = providers[id];

      const contract_data = contracts?.find(_c => _c?.chain_id === chain_id);
      const {
        contract_address,
        is_native,
      } = { ...contract_data };

      let result;

      if (contract_data && provider) {
        const gateway_balance = await getEVMBalance(
          gateway_address,
          contract_data,
          provider,
        );

        const supply = !is_native ?
          await getContractSupply(
            contract_data,
            provider,
          ) :
          0;

        result = {
          contract_data,
          gateway_address,
          gateway_balance,
          supply,
          total: ibc?.findIndex(i => i?.is_native) > -1 ?
            0 :
            gateway_balance + supply,
          url: explorer?.url &&
            `${explorer.url}${explorer.contract_path?.replace('{address}', contract_address)}${is_native && gateway_address ? `?a=${gateway_address}` : ''}`,
        };
      }

      return {
        ...await acc,
        [`${id}`]: result,
      };
    }, {});

    // get tvl from lcd
    let cosmos_tvl = await _cosmos_chains_data.reduce(async (acc, c) => {
      const {
        id,
        overrides,
      } = { ...c };
      let {
        explorer,
        prefix_chain_ids,
      } = { ...c };

      let lcd = lcds[id];

      const ibc_data = ibc?.find(i => i?.chain_id === id);
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
        const _override = overrides[original_chain_id];

        explorer = _override.explorer ||
          explorer;

        prefix_chain_ids = _override.prefix_chain_ids ||
          prefix_chain_ids;

        lcd = axios.create({ baseURL: _override.endpoints?.lcd || _.head(_override.endpoints?.lcds) });
      }

      let result;

      const denom_data = {
        base_denom: asset_data?.id,
        denom: ibc_denom,
        decimals,
        is_native,
      };

      let ibc_channels,
        escrow_balance = 0,
        source_escrow_balance = 0,
        escrow_addresses,
        source_escrow_addresses;

      if (prefix_chain_ids?.length > 0) {
        for (let i = 0; i < 2; i++) {
          const _response = await read(
            'ibc_channels',
            {
              bool: {
                must: [
                  { match: { state: 'STATE_OPEN' } },
                ],
                should: prefix_chain_ids.map(p => {
                  return {
                    match_phrase_prefix: { chain_id: p },
                  };
                }) || [],
                minimum_should_match: 1,
              },
            },
            {
              size: 100,
            },
          );

          const {
            data,
          } = { ..._response };

          if (data?.length > 0 &&
            data.filter(d => moment().diff(moment((d?.updated_at || 0) * 1000), 'minutes', true) > 240).length < 1
          ) {
            ibc_channels = data;
            escrow_addresses = ibc_channels
              .map(d => d?.escrow_address)
              .filter(a => a);
            source_escrow_addresses = ibc_channels
              .map(d => d?.counterparty?.escrow_address)
              .filter(a => a);
            break;
          }
          else if (endpoints?.api) {
            const api = axios.create({ baseURL: endpoints.api });
            await api.post('', {
              module: 'lcd',
              path: '/ibc/core/channel/v1/channels',
            }).catch(error => { return { data: { error } }; });
          }
        }
      }

      if (escrow_addresses) {
        for (const escrow_address of escrow_addresses) {
          escrow_balance += await getCosmosBalance(
            escrow_address,
            denom_data,
            axelarnet_lcd,
          );
        }
      }

      if (source_escrow_addresses) {
        for (const escrow_address of source_escrow_addresses) {
          source_escrow_balance += await getCosmosBalance(
            escrow_address,
            {
              ...denom_data,
              denom: ibc?.find(i => i?.chain_id === axelarnet.id)?.ibc_denom,
            },
            lcd,
          );
        }
      }

      const supply = lcd ?
        is_native && id !== axelarnet.id ?
          source_escrow_balance :
          escrow_addresses?.length > 0 ?
            await getCosmosSupply(
              denom_data,
              lcd,
            ) :
            0 :
        0;

      const total_supply = is_native && id !== axelarnet.id ?
        await getAxelarnetSupply(
          {
            ...denom_data,
            denom: ibc?.find(i => i?.chain_id === axelarnet.id)?.ibc_denom,
          },
          cli,
        ) :
        0;

      const percent_diff_supply = is_native && id !== axelarnet.id ?
        total_supply && source_escrow_balance ?
          Math.abs(
            source_escrow_balance - total_supply
          ) * 100 / source_escrow_balance :
          0 :
        supply && escrow_balance ?
          Math.abs(
            escrow_balance - supply
          ) * 100 / escrow_balance :
          0;

      const total = id === axelarnet.id ?
        await getAxelarnetSupply(
          denom_data,
          cli,
        ) :
        0;

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
        is_abnormal_supply: typeof percent_diff_ibc_channel_supply_threshold === 'number' &&
          percent_diff_supply > percent_diff_ibc_channel_supply_threshold,
        url: explorer?.url && explorer.address_path && source_escrow_addresses?.length > 0 && is_native && id !== axelarnet.id ?
          `${explorer.url}${explorer.address_path.replace('{address}', _.last(source_escrow_addresses))}` :
          explorer?.url && explorer.asset_path && ibc_denom?.includes('/') ?
            `${explorer.url}${explorer.asset_path.replace('{ibc_denom}', _.last(ibc_denom.split('/')))}` :
            axelarnet.explorer?.url && axelarnet.explorer.address_path && escrow_addresses?.length > 0 ?
              `${axelarnet.explorer.url}${axelarnet.explorer.address_path.replace('{address}', _.last(escrow_addresses))}` :
              null,
      };

      return {
        ...await acc,
        [`${id}`]: result,
      };
    }, {});

    cosmos_tvl = Object.fromEntries(
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
              supply: k === axelarnet.id && (
                contracts?.findIndex(c => c?.is_native) > -1 ||
                ['uaxl'].includes(asset)
              ) ?
                total - _.sum(
                  Object.values(cosmos_tvl)
                    .map(_v => _v?.supply || 0)
                ) :
                supply,
            },
          ];
        })
    );

    const tvl = Object.fromEntries(
      _.concat(
        Object.entries(evm_tvl),
        Object.entries(cosmos_tvl),
      )
    );

    // query price
    const _response = await assets_price({
      denom: asset,
    });

    const {
      price,
    } = { ..._.head(_response) };

    const total_on_evm = _.sumBy(
      Object.values(evm_tvl),
      'supply',
    );

    const total_on_cosmos = _.sumBy(
      Object.values(cosmos_tvl),
      _cosmos_chains_data.length === cosmos_chains_data.length ?
        'total' :
        'escrow_balance',
    );

    const total = _.sum(
      Object.values(tvl)
        .map(t => {
          const {
            gateway_balance,
            total,
          } = { ...t };

          return (contracts?.findIndex(c => c?.is_native) > -1 ?
            gateway_balance :
            total
          ) || 0;
        })
    );

    const percent_diff_supply = Math.abs(
      total -
      (
        total_on_evm +
        (
          ibc?.findIndex(i => i?.is_native && i.chain_id !== axelarnet.id) > -1 ?
            0 :
            total_on_cosmos
        )
      )
    ) * 100 / (total || 1);

    data.push({
      asset,
      price,
      tvl,
      total_on_evm,
      total_on_cosmos,
      total,
      percent_diff_supply,
      is_abnormal_supply: typeof percent_diff_total_supply_threshold === 'number' &&
        percent_diff_supply > percent_diff_total_supply_threshold,
      percent_diff_ibc_channel_supply_threshold,
      percent_diff_total_supply_threshold,
    });
  }

  response = {
    data,
    updated_at: moment().unix(),
  };

  if (data.length < 1 && cache_data) {
    response = cache_data;
  }
  // save cache
  else if (cache_id) {
    await write(
      'tvls',
      cache_id,
      response,
    );
  }

  return response;
};