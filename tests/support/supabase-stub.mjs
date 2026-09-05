/**
 * A tiny stand-in for @supabase/supabase-js, enough for the Edge Functions.
 *
 * The provisioning function's behaviour is almost entirely about WHICH rows it
 * reads and writes and in what order, so the stub keeps real in-memory tables
 * and applies real filters rather than replaying canned responses. A test can
 * then assert on the resulting rows the way the database would see them.
 *
 * `globalThis.__supabaseFixture` is the shared world: tables, the signed-in
 * user, and the RPC answers. Each test sets it before invoking the handler.
 */

function rowsMatch(row, filters) {
  return filters.every(([column, value]) => row[column] === value);
}

class Query {
  constructor(fixture, table) {
    this.fixture = fixture;
    this.table = table;
    this.filters = [];
    this.rows = () => (fixture.tables[table] ??= []);
  }

  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }

  get matched() { return this.rows().filter((row) => rowsMatch(row, this.filters)); }

  async maybeSingle() {
    const failure = this.fixture.failures?.[`${this.table}.select`];
    if (failure) return { data: null, error: failure };
    return { data: this.matched[0] ?? null, error: null };
  }

  async single() {
    const { data, error } = await this.maybeSingle();
    return { data, error: error ?? (data ? null : { message: 'no rows' }) };
  }

  // Awaiting the builder itself is the "many rows" form.
  then(resolve, reject) {
    const failure = this.fixture.failures?.[`${this.table}.select`];
    return Promise.resolve(failure
      ? { data: null, error: failure }
      : { data: this.matched, error: null }).then(resolve, reject);
  }

  update(patch) {
    const query = this;
    return {
      eq(column, value) {
        const failure = query.fixture.failures?.[`${query.table}.update`];
        if (failure) return Promise.resolve({ data: null, error: failure });
        for (const row of query.rows()) {
          if (row[column] === value) Object.assign(row, patch);
        }
        query.fixture.writes.push({ table: query.table, op: 'update', patch });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  insert(values) {
    const failure = this.fixture.failures?.[`${this.table}.insert`];
    if (failure) return Promise.resolve({ data: null, error: failure });
    this.rows().push({ ...values });
    this.fixture.writes.push({ table: this.table, op: 'insert', values });
    return Promise.resolve({ data: null, error: null });
  }

  upsert(values, options = {}) {
    const failure = this.fixture.failures?.[`${this.table}.upsert`];
    if (failure) return Promise.resolve({ data: null, error: failure });
    const key = options.onConflict ?? 'id';
    const existing = this.rows().find((row) => row[key] === values[key]);
    if (existing) Object.assign(existing, values);
    else this.rows().push({ ...values });
    this.fixture.writes.push({ table: this.table, op: 'upsert', values });
    return Promise.resolve({ data: null, error: null });
  }
}

export function createClient(_url, key) {
  const fixture = globalThis.__supabaseFixture;
  const isService = key === 'service-role-key';
  return {
    __isService: isService,
    auth: {
      getUser: async () => ({ data: { user: fixture.user ?? null } }),
    },
    from: (table) => new Query(fixture, table),
    rpc: async (name, args) => {
      fixture.rpcCalls.push({ name, args, asService: isService });
      const answer = fixture.rpc?.[name];
      if (typeof answer === 'function') return answer(args);
      return { data: answer ?? null, error: null };
    },
  };
}

export default { createClient };
