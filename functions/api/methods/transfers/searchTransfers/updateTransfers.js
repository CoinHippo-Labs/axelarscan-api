const {
  write,
} = require('../../../services/index');
const {
  getChainData,
} = require('../../../utils/config');
const {
  toArray,
} = require('../../../utils');

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

    updated =
      toArray(
        await Promise.all(
          toArray(data)
            .map(d =>
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