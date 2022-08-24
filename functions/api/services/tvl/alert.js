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
    typeof test === 'string' && equals_ignore_case(test, 'true');

  const _response = await read(
    'tvls',
    {
      range: { updated_at: { gt: moment().subtract(5, 'minutes').unix() } },
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
    data?.map(d => _.head(d?.data))
      .filter(d => d)
      .map(d => {
        const {
          price,
          total,
        } = { ...d };

        const value = (total * price) || 0;

        return {
          ...d,
          value,
        };
      }) || [],
    ['value', 'total'],
    ['desc', 'desc'],
  );

  const _data = data.filter(d =>
    d.is_abnormal_supply ||
    Object.values({ ...d.tvl }).findIndex(_d => _d?.is_abnormal_supply) > -1
  );

  if (test && _data.length < 1 && data.length > 0) {
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

  let status,
    summary,
    event_action,
    severity,
    custom_details,
    links;

  if (data?.length > 0) {
    status = 'alert';
    event_action = 'trigger';
    severity = 'critical';

    custom_details = data.map(d => {
      const {
        asset,
        price,
        is_abnormal_supply,
        percent_diff_supply,
        total,
        total_on_evm,
        total_on_cosmos,
        tvl,
      } = { ...d };
      const {
        symbol,
      } = { ...assets_data.find(a => a?.id === asset) };

      if (is_abnormal_supply) {
        return {
          asset,
          symbol,
          price,
          percent_diff_supply,
          total,
          total_on_evm,
          total_on_cosmos,
          links: _.uniq(
            _.concat(
              Object.values({ ...tvl })
                .filter(_d => (_d?.contract_data?.is_native || _d?.denom_data?.is_native) && _d.url)
                .map(_d => _d.url),
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
                .filter(_d => _d?.is_abnormal_supply && _d.url)
                .map(_d => _d.url),
              endpoints?.app && `${endpoints.app}/tvl`,
            ).filter(l => l)
          ),
        };
      }
    });

    summary = `${custom_details.map(d => d.symbol).join(', ')} amount locked on the source chains does not match the amount minted on the evm/cosmos chains.`;

    links = _.uniq(
      custom_details.flatMap(d => d.links)
    );
  }
  else {
    status = 'ok';
  }

  response = {
    status,
    summary,
    timestamp,
    event_action,
    severity,
    custom_details,
    links,
  };

  return response;
};