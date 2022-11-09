const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
  write,
} = require('./index');
const {
  equals_ignore_case,
} = require('../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const assets_data =
  require('../data')?.assets?.[environment] ||
  [];

const currency = 'usd';
const stablecoin_threshold = 0.01;
const collection = 'assets';

const {
  endpoints,
} = { ...config?.external_api };

module.exports = async (
  params = {},
) => {
  let response;
  const current_time = moment();

  const {
    chain,
    denom,
    timestamp,
  } = { ...params };
  let {
    denoms,
  } = { ...params };

  denoms =
    _.uniq(
      (Array.isArray(denoms) ?
        denoms :
        (
          denoms ||
          denom ||
          ''
        )
        .split(',')
      )
      .filter(d => d)
      .map(d => {
        if (typeof d === 'object') {
          return d;
        }
        else {
          return (
            (d || '')
              .trim()
              .toLowerCase()
          );
        }
      })
    );

  const query_timestamp =
    Number(timestamp) ||
    current_time.valueOf();

  if (denoms.length > 0) {
    const price_timestamp =
      moment(query_timestamp)
        .startOf('day')
        .valueOf();

    const response_cache =
      await read(
        collection,
        {
          bool: {
            must: [
              { match: { price_timestamp } },
            ],
            should: denoms
              .map(d => {
                return {
                  match: {
                    denom: typeof d === 'object' ?
                      d?.denom :
                      d,
                  },
                };
              }),
            minimum_should_match: 1,
          },
        },
        {
          size: denoms.length,
        },
      );

    const data = denoms
      .map(d => {
        const denom_data =
          typeof d === 'object' ?
            d :
            {
              denom: d,
            };

        const _denom =
          denom_data?.denom ||
          d;

        const _chain =
          _denom === 'uluna' &&
          !['terra-2'].includes(chain) ?
            'terra' :
            denom_data?.chain ||
              chain;

        const asset_data = assets_data
          .find(a =>
            equals_ignore_case(
              a?.id,
              _denom,
            )
          );

        const {
          coingecko_id,
          coingecko_ids,
          is_stablecoin,
        } = { ...asset_data };

        return {
          denom: _denom,
          coingecko_id:
            coingecko_ids?.[_chain] ||
            coingecko_id,
          price:
            is_stablecoin ?
              1 :
              undefined,
        };
      });

    if (Array.isArray(response_cache?.data)) {
      response_cache.data
        .filter(a => a)
        .forEach(a => {
          const data_index = data
            .findIndex(d =>
              equals_ignore_case(
                d.denom,
                a?.denom,
              )
            );

          if (data_index > -1) {
            data[data_index] = {
              ...data[data_index],
              ...a,
            };
          }
        });
    }

    const updated_at_threshold =
      current_time
        .subtract(
          5,
          'minutes',
        )
        .valueOf();

    const to_update_data = data
      .filter(d =>
        !d?.updated_at ||
        (
          current_time
            .diff(
              moment(query_timestamp),
              'hours',
            ) < 4 &&
          d.updated_at < updated_at_threshold
        )
      );

    const coingecko_ids = to_update_data
      .map(d => d?.coingecko_id)
      .filter(id => id);

    if (
      coingecko_ids.length > 0 &&
      endpoints?.coingecko
    ) {
      const coingecko =
        axios.create(
          {
            baseURL: endpoints.coingecko,
            timeout: 10000,
          },
        );

      let _data;

      if (timestamp) {
        for (const coingecko_id of coingecko_ids) {
          const _response = await coingecko.get(
            `/coins/${coingecko_id}/history`,
            {
              params: {
                id: coingecko_id,
                date:
                  moment(
                    Number(timestamp)
                  )
                  .format('DD-MM-YYYY'),
                localization: 'false',
              },
            },
          ).catch(error => { return { data: { error } }; });

          const {
            error,
          } = { ..._response?.data };

          _data =
            _.concat(
              _data ||
              [],
              !error &&
              _response?.data ?
                _response.data :
                [],
            );
        }
      }
      else {
        const _response = await coingecko.get(
          '/coins/markets',
          {
            params: {
              vs_currency: currency,
              ids:
                coingecko_ids
                  .join(','),
              per_page: 250,
            },
          },
        ).catch(error => { return { data: { error } }; });

        _data =
          Array.isArray(_response?.data) ?
            _response.data :
            [];
      }

      // update data from coingecko
      _data
        .filter(a => a)
        .map(a => {
          const {
            id,
            market_data,
            current_price,
          } = { ...a };

          const asset_data = assets_data
            .find(_a =>
              _a?.coingecko_id === id
            );

          const {
            is_stablecoin,
          } = { ...asset_data };

          let price =
            market_data?.current_price?.[currency] ||
            current_price;

          price =
            is_stablecoin &&
            Math.abs(price - 1) > stablecoin_threshold ?
              1 :
              price;

          return {
            denom:
            to_update_data
              .find(d =>
                equals_ignore_case(
                  d?.coingecko_id,
                  id,
                )
              )?.denom,
            coingecko_id: id,
            price,
          };
        })
        .forEach(a => {
          const data_index = data
            .findIndex(d =>
              equals_ignore_case(
                d.denom,
                a?.denom,
              )
            );

          if (data_index > -1) {
            data[data_index] = {
              ...data[data_index],
              ...a,
            };
          }
        });
    }

    const to_update_cache = data
      .filter(d =>
        (
          !d?.updated_at ||
          (
            current_time
              .diff(
                moment(query_timestamp),
                'hours',
              ) < 4 &&
            d.updated_at < updated_at_threshold
          )
        ) &&
        ('denom' in d) &&
        ('price' in d)
      );

    for (const d of to_update_cache) {
      const {
        denom,
      } = { ...d };

      d.updated_at =
        moment()
          .valueOf();

      const price_timestamp =
        moment(
          Number(timestamp) ||
          d.updated_at
        )
        .startOf('day')
        .valueOf();

      d.price_timestamp = price_timestamp;

      const id = `${denom}_${price_timestamp}`;

      await write(
        collection,
        id,
        {
          ...d,
        },
      );
    }

    response = data
      .map(d => {
        const {
          id,
          denom,
        } = { ...d };

        return {
          ...d,
          id:
            denom ||
            id,
        };
      });
  }

  return response;
};