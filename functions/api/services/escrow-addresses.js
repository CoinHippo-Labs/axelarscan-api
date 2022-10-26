const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('./index');
const {
  equals_ignore_case,
} = require('../utils');
const {
  to_hash,
  get_address,
} = require('../utils/address');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const data = require('../data');
const evm_chains_data = data?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = data?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const assets_data = data?.assets?.[environment] ||
  [];

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

  assets =
    assets ||
    asset;
  assets = Array.isArray(assets) ?
    assets :
    (assets || '')
      .split(',')
      .filter(a => a);

  if (assets.length < 1) {
    assets = assets_data
      .map(a => a?.id);
  }
  else {
    assets = assets
      .map(a => {
        const asset_data = assets_data.find(_a =>
          equals_ignore_case(_a?.id, a) ||
          equals_ignore_case(_a?.symbol, a) ||
          _a?.contracts?.findIndex(c =>
            equals_ignore_case(c?.symbol, a)
          ) > -1 ||
          _a?.ibc?.findIndex(i =>
            equals_ignore_case(i?.symbol, a)
          ) > -1
        );

        const {
          id,
        } = { ...asset_data };

        return id ||
          a;
      })
      .filter(a =>
        assets_data.findIndex(_a =>
          _a?.id === a
        ) > -1
      );
  }

  chains =
    chains ||
    chain;
  chains = Array.isArray(chains) ?
    chains :
    (chains || '')
      .split(',')
      .filter(c => c);

  if (chains.length < 1) {
    chains = _.uniq(
      chains_data
        .filter(c =>
          !c?.maintainer_id ||
          c.gateway_address
        )
        .flatMap(c => {
          const {
            id,
            overrides,
          } = { ...c };

          return _.concat(
            Object.entries({ ...overrides })
              .filter(([k, v]) => v?.tvl)
              .map(([k, v]) => k),
            id,
          );
        })
        .filter(c =>
          chains_data.findIndex(_c =>
            _c?.id === c ||
            _c?.overrides?.[c]?.tvl,
          ) > -1
        )
    );
  }
  else {
    chains = _.uniq(
      _.concat(
        axelarnet.id,
        chains
          .flatMap(c => {
            const chain_data = chains_data.find(_c =>
              equals_ignore_case(_c?.id, c) ||
              equals_ignore_case(_c?.name, c) ||
              equals_ignore_case(_c?.short_name, c) ||
              _c?.overrides?.[c]?.tvl
            );

            const {
              id,
              overrides,
            } = { ...chain_data };

            return _.concat(
              Object.entries({ ...overrides })
                .filter(([k, v]) => v?.tvl)
                .map(([k, v]) => k),
              id ||
              c,
            );
          })
          .filter(c =>
            chains_data.findIndex(_c =>
              _c?.id === c ||
              _c?.overrides?.[c]?.tvl,
            ) > -1
          ),
      )
    );
  }

  // filter by chains
  const _cosmos_chains_data = _.uniqBy(
    cosmos_chains_data
      .filter(c => {
        const {
          id,
          overrides,
        } = { ...c };

        return chains.findIndex(_c =>
          _c === id ||
          overrides?.[_c]?.tvl
        ) > -1;
      })
      .flatMap(c => {
        const {
          id,
          overrides,
        } = { ...c };

        return _.concat(
          Object.entries({ ...overrides })
            .filter(([k, v]) => chains.includes(k))
            .map(([k, v]) => {
              const _c = {
                ...c,
                ...v,
              };

              delete _c.overrides;

              return _c;
            }),
          chains.includes(id) &&
            c,
        );
      })
      .filter(c => c),
    'id',
  );

  let data = [];

  for (const asset of assets) {
    const asset_data = assets_data.find(a =>
      a?.id === asset
    );

    const {
      ibc,
    } = { ...asset_data };

    // cosmos escrow addresses
    const cosmos_escrow_data = Object.fromEntries(
      await Promise.all(
        _cosmos_chains_data
          .map(c =>
            new Promise(
              async (resolve, reject) => {
                const {
                  id,
                  overrides,
                } = { ...c };
                let {
                  prefix_chain_ids,
                } = { ...c };

                const ibc_data = ibc?.find(i =>
                  i?.chain_id === id
                );
                const {
                  ibc_denom,
                  original_chain_id,
                } = { ...ibc_data };

                if (overrides?.[original_chain_id]) {
                  const override = overrides[original_chain_id];

                  prefix_chain_ids =
                    override.prefix_chain_ids ||
                    prefix_chain_ids;
                }

                let ibc_channels,
                  escrow_addresses,
                  source_escrow_addresses;

                if (
                  ibc_denom &&
                  prefix_chain_ids?.length > 0
                ) {
                  const _response = await read(
                    'ibc_channels',
                    {
                      bool: {
                        must: [
                          { match: { state: 'STATE_OPEN' } },
                        ],
                        should: prefix_chain_ids
                          .map(p => {
                            return {
                              match_phrase_prefix: {
                                chain_id: p,
                              },
                            };
                          }),
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

                  if (
                    data?.length > 0 &&
                    data
                      .filter(d =>
                        moment()
                          .diff(
                            moment(
                              (
                                d?.updated_at ||
                                0
                              ) * 1000
                            ),
                            'minutes',
                            true,
                          ) > 240
                      )
                      .length < 1
                  ) {
                    ibc_channels = data;

                    escrow_addresses = ibc_channels
                      .map(d => d?.escrow_address)
                      .filter(a => a);

                    source_escrow_addresses = ibc_channels
                      .map(d => d?.counterparty?.escrow_address)
                      .filter(a => a);
                  }
                }

                const result = {
                  ibc_channels,
                  escrow_addresses,
                  source_escrow_addresses,
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

    // evm escrow address
    const evm_escrow_address = ibc?.findIndex(i => i?.is_native) > -1 ?
      get_address(
        ibc.find(i => i?.is_native).chain_id === axelarnet.id ?
          asset :
          `ibc/${to_hash(`transfer/${
            _.last(
              cosmos_escrow_data[
                ibc?.find(i =>
                  i?.is_native
                ).chain_id
              ]?.ibc_channels
            )?.channel_id
          }/${asset}`)}`,
        axelarnet.prefix_address,
        32,
      ) :
      undefined;

    data.push({
      asset,
      cosmos_escrow_data,
      evm_escrow_address,
    });
  }

  data = _.uniqBy(
    data
      .flatMap(d => {
        const {
          asset,
          cosmos_escrow_data,
          evm_escrow_address,
        } = { ...d };

        const asset_data = assets_data.find(a =>
          a?.id === asset
        );

        return _.concat(
          Object.entries(cosmos_escrow_data)
            .flatMap(([k, v]) => {
              const {
                ibc_channels,
                escrow_addresses,
                source_escrow_addresses,
              } = { ...v };

              const chain_data = chains_data.find(c =>
                c?.id === k
              );

              return _.concat(
                (escrow_addresses || [])
                  .map(a => {
                    return {
                      address: a,
                      name: `${
                        chain_data?.name ||
                        k
                      } - Escrow Address`,
                      image: chain_data?.image,
                    };
                  }),
                (source_escrow_addresses || [])
                  .map(a => {
                    const chain_data = chains_data.find(c =>
                      a.startsWith(c?.prefix_address)
                    );

                    return {
                      address: a,
                      name: `${
                        chain_data?.name ||
                        a.substring(
                          0,
                          a.indexOf('1'),
                        )
                      } - Escrow Address`,
                      image: chain_data?.image,
                    };
                  }),
              );
            }),
          evm_escrow_address &&
          {
            address: evm_escrow_address,
            name: `${
              asset_data?.name ||
              asset
            } - EVM Escrow Address`,
            image: asset_data?.image,
          },
        );
      })
      .filter(d => d),
    'address',
  );

  response = {
    data,
  };

  return response;
};