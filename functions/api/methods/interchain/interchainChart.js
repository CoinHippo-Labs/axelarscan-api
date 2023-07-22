const _ = require('lodash');

const { transfersChart } = require('../transfers');
const { GMPChart } = require('../gmp');
const { toArray } = require('../../utils');

module.exports = async params => _.orderBy(
  Object.entries(
    _.groupBy(
      await Promise.all(
        ['transfers', 'gmp'].map(d =>
          new Promise(
            async resolve => {
              let response;
              switch (d) {
                case 'transfers':
                  response = await transfersChart(params);
                  break;
                case 'gmp':
                  response = await GMPChart(params);
                  break;
                default:
                  break;
              }
              const { data } = { ...response };
              resolve(
                toArray(data).map(_d => {
                  const { num_txs, volume, fee } = { ..._d };
                  return {
                    ..._d,
                    [`${d}_num_txs`]: num_txs,
                    [`${d}_volume`]: volume,
                    [`${d}_fee`]: fee,
                  };
                })
              );
            }
          )
        )
      ),
      'timestamp',
    )
  )
  .map(([k, v]) => {
    return {
      timestamp: Number(k),
      num_txs: _.sumBy(v, 'num_txs'),
      volume: _.sumBy(v, 'volume'),
      fee: _.sumBy(v, 'fee'),
      gmp_num_txs: _.sumBy(v.filter(_v => _v.gmp_num_txs > 0), 'gmp_num_txs'),
      gmp_volume: _.sumBy(v.filter(_v => _v.gmp_volume > 0), 'gmp_volume'),
      gmp_fee: _.sumBy(v.filter(_v => _v.gmp_fee > 0), 'gmp_fee'),
      transfers_num_txs: _.sumBy(v.filter(_v => _v.transfers_num_txs > 0), 'transfers_num_txs'),
      transfers_volume: _.sumBy(v.filter(_v => _v.transfers_volume > 0), 'transfers_volume'),
      transfers_fee: _.sumBy(v.filter(_v => _v.transfers_fee > 0), 'transfers_fee'),
    };
  }),
  ['timestamp'], ['asc'],
);