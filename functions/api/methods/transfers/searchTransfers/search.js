const moment = require('moment');

const { get, read, write } = require('../../../services/index');
const { CACHE_COLLECTION } = require('../../../utils/config');
const { sleep, toArray } = require('../../../utils');

module.exports = async (collection, query, params, delay_ms = 0, cache_id) => {
  await sleep(delay_ms);
  const { bool } = { ...query };
  const { must } = { ...bool };
  const { aggs } = { ...params };
  const try_fetch_cache = !!(cache_id && aggs && toArray(must).length === (cache_id?.includes('status_') ? 1 : 0) && Object.keys({ ...bool }).filter(k => k !== 'must').length === 0);

  let output;
  let cache_hit;
  if (try_fetch_cache) {
    const { data, updated_at } = { ...await get(CACHE_COLLECTION, cache_id) };
    if (data && updated_at && moment().diff(moment(updated_at), 'seconds') <= 300) {
      output = JSON.parse(data);
      cache_hit = true;
    }
  }
  if (!output) {
    output = await read(collection, query, params);
  }
  if (output && try_fetch_cache && !cache_hit) {
    await write(CACHE_COLLECTION, cache_id, { data: JSON.stringify(output), updated_at: moment().valueOf() });
  }
  return output;
};