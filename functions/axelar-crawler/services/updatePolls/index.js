const _ = require('lodash');

const { getAPI } = require('../../utils/config');
const { log, sleep, toArray, parseRequestError } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'updatePolls';
    const prefix_address = 'axelar';
    const getHeights = data => _.uniq(toArray(toArray(data).map(d => _.min(toArray(_.concat(d.height, Object.entries(d).filter(([k, v]) => k.startsWith(`${prefix_address}1`) && v?.height).map(([k, v]) => v.height)))))));

    while (!context || context.getRemainingTimeInMillis() > 300 * 1000) {
      // log('info', service_name, `start ${method}`);
      // await api.get('/', { params: { method } }).catch(error => parseRequestError(error));
      // log('info', service_name, `end ${method}`);
      let response = await api.get('/', { params: { method: 'searchPolls' } }).catch(error => parseRequestError(error));
      let heights = getHeights(toArray(response?.data?.data).filter(d => d.success));
      response = await api.get('/', { params: { method: 'searchPolls', status: 'to_recover', size: 15, sort: [{ 'created_at.ms': 'asc' }] } }).catch(error => parseRequestError(error));
      heights = _.uniq(_.concat(heights, getHeights(response?.data?.data)));
      heights = _.orderBy(_.uniq(heights.flatMap(h => _.range(-1, 6).map(i => h + i))), [], ['desc']);

      for (const height of heights) {
        // log('info', service_name, `start ${method}`, { height });
        let next_key = true;
        while (next_key) {
          const page_key = typeof next_key === 'string' && next_key ? next_key : undefined;
          const response = await api.post('/', { method: 'lcd', path: '/cosmos/tx/v1beta1/txs', index: true, index_poll: true, events: `tx.height=${height}`, 'pagination.key': page_key }).catch(error => parseRequestError(error));
          next_key = response?.data?.pagination?.next_key;
        }
        // log('info', service_name, `end ${method}`, { height });
      }
      await sleep(3 * 1000);
    }
  }
};