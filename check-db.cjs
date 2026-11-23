const { Client } = require('pg');
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const t = await c.query("select tablename from pg_tables where schemaname='public' order by 1");
    console.log(t.rows.map(r => r.tablename).join('\n'));
    const m = await c.query('select count(*)::int as n from drizzle.__drizzle_migrations');
    console.log('migrations applied:', m.rows[0].n);
    await c.end();
})().catch(e => { console.error('check failed:', e.code || e.name); process.exit(1); });