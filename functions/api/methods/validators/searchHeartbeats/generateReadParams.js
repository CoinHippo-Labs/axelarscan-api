module.exports = params => {
  const {
    aggs,
    from,
    size,
    sort,
  } = { ...params };

  return {
    aggs: aggs || undefined,
    from: !isNaN(from) ? Number(from) : 0,
    size: !isNaN(size) ? Number(size) : 200,
    sort: sort || [{ period_height: 'desc' }],
    track_total_hits: true,
  };
};