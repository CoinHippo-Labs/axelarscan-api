const _ = require('lodash');

const {
  getAPI,
} = require('../../utils/config');
const {
  log,
  sleep,
  toArray,
} = require('../../utils');

module.exports = async context => {
  const api = getAPI();

  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'updatePolls';
    const prefix_address = 'axelar';

    while (!context || context.getRemainingTimeInMillis() > 300 * 1000) {
      // log('info', service_name, `start ${method}`);
      // await api.get('/', { params: { method } }).catch(error => { return { error: error?.response?.data }; });
      // log('info', service_name, `end ${method}`);
      const response = await api.get('/', { params: { method: 'searchPolls', status: 'to_recover', size: 10 } }).catch(error => { return { error: error?.response?.data }; });

      const {
        data,
      } = { ...response?.data };

      let heights = _.uniq(toArray(toArray(data).map(d => _.min(toArray(_.concat(d.height, Object.entries(d).filter(([k, v]) => k.startsWith(`${prefix_address}1`) && v?.height).map(([k, v]) => v.height)))))));
      heights = _.orderBy(_.uniq(heights.flatMap(h => _.range(-1, 5).map(i => h + i))), [], ['desc']);

      for (const height of heights) {
        log('info', service_name, `start ${method}`, { height });
        let next_key = true;

        while (next_key) {
          const page_key = typeof next_key === 'string' && next_key ? next_key : undefined;
          const response = await api.post('/', { method: 'lcd', path: '/cosmos/tx/v1beta1/txs', index: true, index_transfer: true, index_poll: true, events: `tx.height=${height}`, 'pagination.key': page_key }).catch(error => { return { error: error?.response?.data }; });
          next_key = response?.data?.pagination?.next_key;
        }

        log('info', service_name, `end ${method}`, { height });
      }

      await sleep(3 * 1000);
    }
  }
};