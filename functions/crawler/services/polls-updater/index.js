const _ = require('lodash');
const {
  API,
  getPolls,
} = require('./api');
const {
  sleep,
} = require('../../utils');

module.exports = async () => {
  const api = API();

  while (true) {
    const response =
      await getPolls(
        {
          status: 'to_recover',
        },
      );

    let {
      data,
    } = { ...response };

    if (Array.isArray(data)) {
      data =
        _.uniqBy(
          data
            .filter(d => d)
            .map(d => {
              const {
                height,
              } = { ...d };

              return {
                ...d,
                _height:
                  _.min(
                    _.concat(
                      height,
                      Object.entries(d)
                        .filter(([k, v]) =>
                          k?.startsWith('axelar1') &&
                          v?.height
                        )
                        .map(([k, v]) => v.height),
                    )
                    .filter(h => h)
                  ),
              };
            })
            .filter(d => d._height),
          '_height',
        );
    }

    if (
      Array.isArray(data) &&
      data.length > 0
    ) {
      for (const d of data) {
        const {
          _height,
        } = { ...d };

        for (let i = -3; i < 6; i++) {
          // get transactions of each block
          let next_page_key = true;

          while (next_page_key) {
            const response =
              await api
                .get(
                  '',
                  {
                    params: {
                      module: 'lcd',
                      path: '/cosmos/tx/v1beta1/txs',
                      events: `tx.height=${_height + i}`,
                      'pagination.key':
                        typeof next_page_key === 'string' &&
                        next_page_key ?
                          next_page_key :
                          undefined,
                    },
                  },
                )
                .catch(error => {
                  return {
                    data: {
                      error,
                    },
                  };
                });

            const {
              pagination,
            } = { ...response?.data };
            const {
              next_key,
            } = { ...pagination };

            next_page_key = next_key;
          }
        }
      }
    }
    else {
      await sleep(3 * 1000);
    }
  }
};