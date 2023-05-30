const axios = require('axios');
const _ = require('lodash');

const { normalizeObject, transferCollections } = require('./utils');
const { log, equalsIgnoreCase, toArray } = require('../../utils');

const service_name = 'index';

const crud = async (params = {}) => {
  let response;

  // request parameters
  const {
    collection,
    method, // get, set, update, query, search, delete, remove
    from,
    size,
    sort,
  } = { ...params };
  let {
    path,
    id,
    use_raw_data,
    update_only,
    track_total_hits,
    height,
  } = { ...params };

  // indexer credential
  const indexer_url = transferCollections.includes(collection) ? process.env.TRANSFERS_INDEXER_URL : process.env.GENERAL_INDEXER_URL;
  const indexer_username = transferCollections.includes(collection) ? process.env.TRANSFERS_INDEXER_USERNAME : process.env.GENERAL_INDEXER_USERNAME;
  const indexer_password = transferCollections.includes(collection) ? process.env.TRANSFERS_INDEXER_PASSWORD : process.env.GENERAL_INDEXER_PASSWORD;

  // normalize
  path = path || '';
  use_raw_data = typeof use_raw_data === 'boolean' ? use_raw_data : typeof use_raw_data !== 'string' || equalsIgnoreCase(use_raw_data, 'true');
  update_only = typeof update_only === 'boolean' ? update_only : typeof update_only !== 'string' || equalsIgnoreCase(update_only, 'true');
  track_total_hits = typeof track_total_hits === 'boolean' ? track_total_hits : typeof track_total_hits !== 'string' || equalsIgnoreCase(track_total_hits, 'true');

  if (!isNaN(height)) {
    height = Number(height);
  }

  if (indexer_url && collection) {
    const _params = _.cloneDeep(params);
    delete params.collection;
    delete params.method;
    delete params.path;
    delete params.id;
    delete params.use_raw_data;
    delete params.update_only;

    const object_fields = ['query', 'aggs', 'sort', 'fields'];
    object_fields.forEach(f => {
      if (params[f]) {
        try {
          params[f] = params[f].startsWith('[') && params[f].endsWith(']') ? JSON.parse(params[f]) : normalizeObject(JSON.parse(params[f]));
        } catch (error) {}
      }
    });

    const indexer = axios.create({ baseURL: indexer_url, headers: { 'Accept-Encoding': 'gzip' } });
    const auth = {
      username: indexer_username,
      password: indexer_password,
    };

    // request to indexer
    switch (method) {
      case 'get':
        path = path || `/${collection}/_doc/${id}`;

        response = await indexer.get(path, { params, auth }).catch(error => { return { error: error?.response?.data }; });
        const { _id, _source } = { ...response?.data };
        response = _source ? { data: { ..._source, id: _id } } : response;
        break;
      case 'set':
      case 'update':
        path = path || `/${collection}/_doc/${id}`;

        if (path.includes('/_update_by_query')) {
          try {
            response = await indexer.post(path, params, { auth }).catch(error => { return { error: error?.response?.data }; });
          } catch (error) {}
        }
        else {
          response = await (path.includes('_update') ? indexer.post(path, { doc: params }, { auth }) : indexer.put(path, params, { auth })).catch(error => { return { error: error?.response?.data }; });
          const { error } = { ...response?.data };

          // retry with update / insert
          if (error) {
            path = path.replace(path.includes('_doc') ? '_doc' : '_update', path.includes('_doc') ? '_update' : '_doc');

            if (update_only && path.includes('_doc')) {
              const _response = await indexer.get(path, { auth }).catch(error => { return { error: error?.response?.data }; });
              const { _id, _source } = { ..._response?.data };
              if (_source) {
                path = path.replace('_doc', '_update');
              }
            }
            response = await (path.includes('_update') ? indexer.post(path, { doc: params }, { auth }) : indexer.put(path, params, { auth })).catch(error => { return { error: error?.response?.data }; });
          }
        }
        break;
      case 'query':
      case 'search':
        path = path || `/${collection}/_search`;

        const search_data =
          use_raw_data ?
            params :
            {
              query: {
                bool: {
                  // set query for each field
                  must:
                    Object.entries({ ...params })
                      .filter(([k, v]) =>
                        ![
                          'query',
                          'aggs',
                          'from',
                          'size',
                          'sort',
                          'fields',
                          '_source',
                        ]
                        .includes(k)
                      )
                      .map(([k, v]) => {
                        // overide field from params
                        switch (k) {
                          case 'id':
                            if (!v && id) {
                              v = id;
                            }
                            break;
                          default:
                            break;
                        }
                        // set match query
                        return { match: { [k]: v } };
                      }),
                },
              },
            };

        if (path.endsWith('/_search')) {
          search_data.from = !isNaN(from) ? Number(from) : 0;
          search_data.size = !isNaN(size) ? Number(size) : 10;
          search_data.sort = sort;
          search_data.track_total_hits = track_total_hits;
        }

        response = await indexer.post(path, search_data, { auth }).catch(error => { return { error: error?.response?.data }; });
        const { hits, aggregations } = { ...response?.data };

        response =
          hits?.hits || aggregations ?
            {
              data: {
                data: toArray(hits?.hits).map(d => {
                  const {
                    _id,
                    _source,
                    fields,
                  } = { ...d };

                  return {
                    ..._source,
                    ...fields,
                    id: _id,
                  };
                }),
                total: hits?.total?.value,
                aggs: aggregations,
              },
            } :
            response;
        break;
      case 'delete':
      case 'remove':
        path = path || `/${collection}/_doc/${id}`;
        response = await indexer.delete(path, { params, auth }).catch(error => { return { error: error?.response?.data }; });
        break;
      default:
        break;
    }

    if (response?.data) {
      response = response.data;
    }
    else if (response?.error) {
      const { error } = { ...response };
      log('debug', 'indexer', 'request to opensearch', { params: _params, error });
      delete response.error;
    }
  }

  return response;
};

const get = async (collection, id) => await crud({ method: 'get', collection, id });

const read = async (
  collection,
  query,
  params = {},
) =>
  await crud(
    {
      method: 'query',
      collection,
      query,
      use_raw_data: true,
      ...params,
    },
  );

const write = async (
  collection,
  id,
  data = {},
  update_only = false,
  is_update = true,
) =>
  await crud(
    {
      method: 'set',
      collection,
      id,
      path: is_update ? `/${collection}/_update/${id}` : undefined,
      update_only,
      ...data,
    },
  );

const remove = async (collection, id) => await crud({ method: 'delete', collection, id });

const deleteByQuery = async (
  collection,
  query,
  params = {},
) =>
  await crud(
    {
      method: 'query',
      collection,
      path: `/${collection}/_delete_by_query`,
      query,
      use_raw_data: true,
      ...params,
    },
  );

module.exports = {
  crud,
  get,
  read,
  write,
  remove,
  deleteByQuery,
};