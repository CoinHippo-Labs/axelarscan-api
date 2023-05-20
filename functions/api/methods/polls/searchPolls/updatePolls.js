const {
  write,
} = require('../../../services/index');
const {
  getChainData,
} = require('../../../utils/config');
const {
  toArray,
} = require('../../../utils');

const MIN_VOTE_PER_POLL_TO_FAILED = 20;

module.exports = async (
  collection,
  data,
  params,
) => {
  let updated;

  if (collection && toArray(data).length > 0) {
    const {
      status,
    } = { ...params };

    const {
      prefix_address,
    } = { ...getChainData('axelarnet') };

    updated =
      toArray(
        await Promise.all(
          toArray(data).map(d =>
            new Promise(
              async resolve => {
                const {
                  id,
                  success,
                  failed,
                  confirmation,
                  num_recover_time,
                } = { ...d };

                let _updated;

                if (!failed && !(success || confirmation) && Object.entries({ ...d }).filter(([k, v]) => k.startsWith(prefix_address) && !v?.vote).length > MIN_VOTE_PER_POLL_TO_FAILED) {
                  d.failed = true;
                  _updated = true;
                }

                if (status === 'to_recover' && !d.failed) {
                  d.num_recover_time = (num_recover_time || 0) + 1;
                  _updated = true;
                }

                if (_updated) {
                  await write(collection, id, d, true);
                }

                resolve(_updated);
              }
            )
          )
        )
      ).length > 0;
  }

  return updated;
};