const _ = require('lodash');

const {
  searchPolls,
} = require('../polls');
const lcd = require('../lcd');
const {
  getChainData,
} = require('../../utils/config');
const {
  toArray,
} = require('../../utils');

module.exports = async () => {
  const response = await searchPolls({ status: 'to_recover' });

  const {
    data,
  } = { ...response };

  const {
    prefix_address,
  } = { ...getChainData('axelarnet') };

  heights = _.uniq(toArray(toArray(data).map(d => _.min(toArray(_.concat(d.height, Object.entries(d).filter(([k, v]) => k.startsWith(`${prefix_address}1`) && v?.height).map(([k, v]) => v.height)))))));
  heights = _.orderBy(_.uniq(heights.flatMap(h => _.range(-3, 6).map(i => h + i))), [], ['desc']);

  await Promise.all(
    heights.map(height =>
      new Promise(
        async resolve => {
          let next_key = true;

          while (next_key) {
            const page_key = typeof next_key === 'string' && next_key ? next_key : undefined;
            const response = await lcd('/cosmos/tx/v1beta1/txs', { events: `tx.height=${height}`, 'pagination.key': page_key });
            next_key = response?.pagination?.next_key;
          }

          resolve();
        }
      )
    )
  );

  return;
};