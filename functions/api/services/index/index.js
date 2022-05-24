// import module for http request
const axios = require('axios');
// import utils
const { normalize_obj, transfer_collections } = require('./utils');

// initial indexer info
let indexer_url = process.env.INDEXER_URL;
let indexer_username = process.env.INDEXER_USERNAME;
let indexer_password = process.env.INDEXER_PASSWORD;

module.exports.crud = async (params = {}) => {
  // initial response
  let response;

  if (indexer_url && params?.collection) {
    // set collection name
    const collection = params.collection;
    delete params.collection;
    // set method
    const method = params.method; // get, set, update, query, search, delete, remove
    delete params.method;
    let path = params.path || '';
    delete params.path;
    // set id
    let id = params.id;
    delete params.id;
    // initial use raw data
    const use_raw_data = typeof params.use_raw_data === 'boolean' ? params.use_raw_data : typeof params.use_raw_data === 'string' ? params.use_raw_data?.trim().toLowerCase() === 'true' ? true : false : true;
    delete params.use_raw_data;
    // initial update only
    const update_only = typeof params.update_only === 'boolean' ? params.update_only : typeof params.update_only === 'string' ? params.update_only?.trim().toLowerCase() === 'true' ? true : false : true;
    delete params.update_only;

    // normalize
    if (!isNaN(params.height)) {
      params.height = Number(params.height);
    }
    const objectFields = ['aggs', 'query', 'sort', 'fields'];
    objectFields.forEach(f => {
      if (params[f]) {
        try {
          params[f] = params[f]?.startsWith('[') && params[f].endsWith(']') ? JSON.parse(params[f]) : normalize_obj(JSON.parse(params[f]));
        } catch (error) {}
      }
    });

    // change indexer info
    if (transfer_collections.includes(collection)) {
      indexer_url = process.env.TRANSFERS_INDEXER_URL;
      indexer_username = process.env.TRANSFERS_INDEXER_USERNAME;
      indexer_password = process.env.TRANSFERS_INDEXER_PASSWORD;
      // return if indexer is not exist
      if (!indexer_url) {
        return response;
      }
    }

    // initial indexer
    const indexer = axios.create({ baseURL: indexer_url });
    // initial auth
    const auth = {
      username: indexer_username,
      password: indexer_password,
    };

    // run method
    switch (method) {
      case 'get':
        path = path || `/${collection}/_doc/${id}`;
        // request indexer
        response = await indexer.get(path, { params, auth })
          .catch(error => { return { data: { error } }; });
        // set response data
        response = response?.data?._source ? { data: { ...response.data._source, id: response.data._id } } : response;
        break;
      case 'set':
      case 'update':
        path = path || `/${collection}/_doc/${id}`;
        if (path.includes('/_update_by_query')) {
          try {
            // request indexer
            response = await indexer.post(path, params, { auth })
              .catch(error => { return { data: { error } }; });
          } catch (error) {}
        }
        else {
          // request indexer
          response = await (path.includes('_update') ?
            indexer.post(path, { doc: params }, { auth })
            :
            indexer.put(path, params, { auth })
          ).catch(error => { return { data: { error } }; });
          // retry with update/insert
          if (response?.data?.error) {
            path = path?.replace(path.includes('_doc') ? '_doc' : '_update', path.includes('_doc') ? '_update' : '_doc') || path;
            if (update_only && path?.includes('_doc')) {
              // request indexer
              const _response = await indexer.get(path, { auth })
                .catch(error => { return { data: { error } }; });
              if (_response?.data?._source) {
                path = path?.replace('_doc', '_update') || path;
              }
            }
            // request indexer
            response = await (path.includes('_update') ?
              indexer.post(path, { doc: params }, { auth })
              :
              indexer.put(path, params, { auth })
            ).catch(error => { return { data: { error } }; });
          }
        }
        break;
      case 'query':
      case 'search':
        path = path || `/${collection}/_search`;
        // setup search data
        const search_data = use_raw_data ? params : {
          query: {
            bool: {
              // set query for each field
              must: Object.entries(params || {}).filter(([k, v]) => !['from', 'size', 'query', 'aggs', 'sort', '_source', 'fields'].includes(k)).map(([k, v]) => {
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
                return {
                  match: {
                    [`${k}`]: v,
                  },
                };
              }),
            },
          },
        };
        if (path.endsWith('/_search')) {
          // set results size
          search_data.size = params?.size || 10;
          // set sort fields
          search_data.sort = params?.sort;
        }
        // request indexer
        response = await indexer.post(path, search_data, { auth })
          .catch(error => { return { data: { error } }; });
        // set response data
        response = response?.data?.hits?.hits || response?.data?.aggregations ? { data: { data: response.data.hits?.hits?.map(d => { return { ...d?._source, ...d?.fields, id: d?._id } }), total: response.data.hits?.total?.value, aggs: response.data.aggregations } } : response;
        break;
      case 'delete':
      case 'remove':
        path = path || `/${collection}/_doc/${id}`;
        // request indexer
        response = await indexer.delete(path, { params, auth })
          .catch(error => { return { data: { error } }; });
        break;
      default:
        break;
    }

    // set response
    if (response?.data) {
      delete response.data.error;
      response = response.data;
    }
  }

  // return response
  return response;
};