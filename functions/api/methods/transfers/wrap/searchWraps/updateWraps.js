const {
  write,
} = require('../../../../services/index');
const {
  toArray,
} = require('../../../../utils');

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
                    num_update_time,
                  } = { ...d };

                  let _updated;

                  if (status === 'to_update') {
                    d.num_update_time = (num_update_time || 0) + 1;
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