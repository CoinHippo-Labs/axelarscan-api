const _ = require('lodash');
const moment = require('moment');

const {
  read,
} = require('../../services/index');
const {
  IBC_CHANNEL_COLLECTION,
  getChainsList,
  getChainData,
  getAssets,
  getAssetData,
} = require('../../utils/config');
const {
  toHash,
  getAddress,
} = require('../../utils/address');
const {
  toArray,
} = require('../../utils');

module.exports = async (
  params = {},
) => {
  const {
    asset,
    chain,
  } = { ...params };
  let {
    assets,
    chains,
  } = { ...params };

  assets = toArray(assets || asset);

  if (assets.length < 1) {
    assets = Object.keys({ ...getAssets() });
  }
  else {
    assets = toArray(assets.map(a => getAssetData(a)?.denom));
  }

  chains = toArray(chains || chain);

  if (chains.length < 1) {
    chains = getChainsList().filter(c => c.gateway_address || c.chain_type === 'cosmos').map(c => c.id);
  }
  else {
    chains = _.uniq(_.concat('axelarnet', toArray(chains.map(c => getChainData(c)?.id))));
  }

  const cosmos_chains_data = getChainsList('cosmos').filter(c => chains.includes(c.id));

  let data = [];

  for (const asset of assets) {
    const {
      native_chain,
      addresses,
    } = { ...getAssetData(asset) };

    // cosmos escrow addresses
    const cosmos_escrow_data =
      Object.fromEntries(
        await Promise.all(
          cosmos_chains_data.map(c =>
            new Promise(
              async resolve => {
                const {
                  id,
                  prefix_chain_ids,
                } = { ...c };

                const {
                  ibc_denom,
                } = { ...addresses?.[id] };

                let ibc_channels;
                let escrow_addresses;
                let source_escrow_addresses;

                if (ibc_denom && toArray(prefix_chain_ids).length > 0) {
                  const response =
                    await read(
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

                  const {
                    data,
                  } = { ...response };

                  if (toArray(data).length > 0 && toArray(data).filter(d => moment().diff(moment((d.updated_at || 0) * 1000), 'minutes', true) > 240).length < 1) {
                    ibc_channels = toArray(data);
                    escrow_addresses = toArray(ibc_channels.map(d => d.escrow_address));
                    source_escrow_addresses = toArray(ibc_channels.map(d => d.counterparty?.escrow_address));
                  }
                }

                resolve([id, { ibc_channels, escrow_addresses, source_escrow_addresses }]);
              }
            ),
          )
        )
      );

    // evm escrow address
    const evm_escrow_address =
      addresses?.[native_chain] ?
        getAddress(
          native_chain === 'axelarnet' ?
            addresses[native_chain].ibc_denom :
            `ibc/${toHash(`transfer/${_.last(cosmos_escrow_data[native_chain]?.ibc_channels)?.channel_id}/${getChainData(native_chain)?.chain_type !== 'cosmos' && addresses.axelarnet?.ibc_denom ? addresses.axelarnet.ibc_denom : asset}`)}`,
          getChainData('axelarnet')?.prefix_address,
          32,
        ) :
        undefined;

    data.push({ asset, cosmos_escrow_data, evm_escrow_address });
  }

  data = _.uniqBy(
    data.flatMap(d => {
      const {
        asset,
        cosmos_escrow_data,
        evm_escrow_address,
      } = { ...d };

      const {
        symbol,
        image,
      } = { ...getAssetData(asset) };

      return (
        toArray(
          _.concat(
            Object.entries(cosmos_escrow_data).flatMap(([k, v]) => {
              const {
                ibc_channels,
                escrow_addresses,
                source_escrow_addresses,
              } = { ...v };

              const {
                name,
                image,
              } = { ...getChainData(k) };

              return (
                _.concat(
                  toArray(escrow_addresses).map(a => {
                    return {
                      address: a,
                      name: `${name || k} - IBC escrow`,
                      image,
                    };
                  }),
                  toArray(source_escrow_addresses).map(a => {
                    const {
                      name,
                      image,
                    } = { ...getChainsList().find(c => a.startsWith(c.prefix_address)) }

                    return {
                      address: a,
                      name: `${name || a.substring(0, a.indexOf('1'))} - IBC escrow`,
                      image,
                    };
                  }),
                )
              );
            }),
            evm_escrow_address && {
              address: evm_escrow_address,
              name: `${symbol || asset} - EVM IBC escrow`,
              image,
            },
          )
        )
      );
    }),
    'address',
  );

  return { data };
};