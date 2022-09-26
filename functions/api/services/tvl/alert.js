const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../index');
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
  alert_asset_value_threshold,
} = { ...config?.[environment] };

module.exports = async (
  params = {},
) => {
  let response;

  let {
    test,
  } = { ...params };

  test = typeof test === 'boolean' ?
    test :
    typeof test === 'string' &&
      equals_ignore_case(test, 'true');

  const _response = await read(
    'tvls',
    {
      range: { updated_at: { gt: moment().subtract(6, 'minutes').unix() } },
    },
    {
      size: 100,
    },
  );

  let {
    data,
  } = { ..._response };

  const {
    updated_at,
  } =  { ..._.head(data) };

  data = _.orderBy(
    (data || [])
      .map(d => _.head(d?.data))
      .filter(d => d)
      .map(d => {
        const {
          price,
          total,
        } = { ...d };

        return {
          ...d,
          value: (total * price) ||
            0,
        };
      }),
    [
      'value',
      'total',
    ],
    [
      'desc',
      'desc',
    ],
  );

  const _data = data.filter(d =>
    (
      d.is_abnormal_supply &&
      d.value > alert_asset_value_threshold
    ) ||
    (
      Object.values({ ...d.tvl })
        .findIndex(_d => _d?.is_abnormal_supply) > -1 &&
      _.sum(
        Object.values({ ...d.tvl })
          .map(_d => {
            const {
              price,
            } = { ...d };
            const {
              supply,
              escrow_balance,
            } = { ..._d };

            return (
              (supply || escrow_balance) *
              (price || 0)
            );
          })
      ) > alert_asset_value_threshold
    )
  );

  if (
    test &&
    _data.length < 1 &&
    data.length > 0
  ) {
    data = _.slice(
      data,
      0,
      1,
    );
  }
  else {
    data = _data;
  }

  const timestamp = (
    updated_at ?
      moment(updated_at * 1000) :
      moment()
  ).format();

  let native_on_evm_total_status = 'ok',
    native_on_evm_escrow_status = 'ok',
    native_on_cosmos_evm_escrow_status = 'ok',
    native_on_cosmos_escrow_status = 'ok',
    summary,
    details,
    links;

  if (data?.length > 0) {
    details = data.map(d => {
      const {
        asset,
        price,
        is_abnormal_supply,
        percent_diff_supply,
        total,
        value,
        total_on_evm,
        total_on_cosmos,
        evm_escrow_address,
        evm_escrow_balance,
        evm_escrow_address_urls,
        tvl,
      } = { ...d };

      const asset_data = assets_data.find(a => a?.id === asset);

      const {
        symbol,
        contracts,
        ibc,
      } = { ...asset_data };

      const native_chain_id = contracts?.find(c => c?.is_native)?.chain_id ||
        ibc?.find(i => i?.is_native)?.chain_id;

      const native_chain = chains_data.find(c =>
        c?.id === native_chain_id ||
        c?.chain_id === native_chain_id
      )?.id;

      const native_on = evm_chains_data.findIndex(c => c?.id === native_chain) > -1 ?
        'evm' :
        cosmos_chains_data.findIndex(c => c?.id === native_chain) > -1 ?
          'cosmos' :
          undefined;

      if (
        is_abnormal_supply &&
        value > alert_asset_value_threshold
      ) {
        return {
          asset,
          symbol,
          price,
          native_chain,
          native_on,
          percent_diff_supply,
          total,
          total_on_evm,
          total_on_cosmos,
          evm_escrow_address,
          evm_escrow_balance,
          links: _.uniq(
            _.concat(
              evm_escrow_address_urls,
              Object.values({ ...tvl })
                .filter(_d => (_d?.contract_data?.is_native || _d?.denom_data?.is_native))
                .flatMap(_d =>
                  _.concat(
                    _d.url,
                    _d.escrow_addresses_urls,
                    _d.supply_urls,
                  )
                ),
              endpoints?.app && `${endpoints.app}/tvl`,
            ).filter(l => l)
          ),
        };
      }
      else {
        return {
          asset,
          symbol,
          price,
          native_chain,
          native_on,
          chains: Object.entries({ ...tvl })
            .filter(([k, v]) => v?.is_abnormal_supply)
            .map(([k, v]) => {
              const {
                percent_diff_supply,
                contract_data,
                denom_data,
                gateway_address,
                gateway_balance,
                ibc_channels,
                escrow_addresses,
                escrow_balance,
                source_escrow_addresses,
                source_escrow_balance,
                url,
              } = { ...v };
              let {
                supply,
              } = { ...v };
              const {
                is_native,
              } = { ...denom_data };

              if (
                is_native &&
                id !== axelarnet.id &&
                typeof tvl?.axelarnet?.total === 'number'
              ) {
                const {
                  total,
                } = { ...tvl.axelarnet };

                supply = total;
              }

              return {
                chain: k,
                percent_diff_supply,
                contract_data,
                denom_data,
                gateway_address,
                gateway_balance,
                ibc_channels,
                escrow_addresses,
                escrow_balance,
                source_escrow_addresses,
                source_escrow_balance,
                supply,
                link: url,
              };
            }),
          links: _.uniq(
            _.concat(
              Object.values({ ...tvl })
                .filter(_d => _d?.is_abnormal_supply)
                .flatMap(_d =>
                  _.concat(
                    _d.url,
                    _d.escrow_addresses_urls,
                    _d.supply_urls,
                  )
                ),
              endpoints?.app && `${endpoints.app}/tvl`,
            ).filter(l => l)
          ),
        };
      }
    });

    native_on_evm_total_status = details.findIndex(d => d.native_on === 'evm' && typeof d.percent_diff_supply === 'number') > -1 ?
      'alert' :
      'ok';
    native_on_evm_escrow_status = details.findIndex(d => d.native_on === 'evm' && d.chains?.findIndex(c => typeof c.percent_diff_supply === 'number') > -1) > -1 ?
      'alert' :
      'ok';
    native_on_cosmos_evm_escrow_status = details.findIndex(d => d.native_on === 'cosmos' && typeof d.percent_diff_supply === 'number') > -1 ?
      'alert' :
      'ok';
    native_on_cosmos_escrow_status = details.findIndex(d => d.native_on === 'cosmos' && d.chains?.findIndex(c => typeof c.percent_diff_supply === 'number') > -1) > -1 ?
      'alert' :
      'ok';

    const evm_details = [
      native_on_evm_total_status,
      native_on_evm_escrow_status,
    ].findIndex(s => s !== 'ok') > -1 ?
      details.filter(d => d.native_on === 'evm') :
      undefined;

    const cosmos_details = [
      native_on_cosmos_evm_escrow_status,
      native_on_cosmos_escrow_status,
    ].findIndex(s => s !== 'ok') > -1 ?
      details.filter(d => d.native_on === 'cosmos') :
      undefined;

    status = 'alert';

    summary = evm_details && cosmos_details ?
      {
        evm: evm_details
          .map(d => d.symbol)
          .join(', '),
        cosmos: cosmos_details
          .map(d => d.symbol)
          .join(', '),
      } :
      evm_details || cosmos_details ?
        (evm_details || cosmos_details)
          .map(d => d.symbol)
          .join(', ') :
        undefined;

    links = _.uniq(
      details.flatMap(d => d.links)
    );
  }

  response = {
    summary,
    timestamp,
    native_on_evm_total_status,
    native_on_evm_escrow_status,
    native_on_cosmos_evm_escrow_status,
    native_on_cosmos_escrow_status,
    details,
    links,
  };

  return response;
};