import { errorCode } from './log-fields.mjs';

const identifier = value => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid database schema');
  return `"${value}"`;
};
const badRequest = message => Object.assign(new Error(message), {status:400});

/** PostgreSQL is the authoritative store for events and external file cursors. */
export class PostgresLogStore {
  constructor({pool, schema='gateway_logs', retentionDays=30, maxQueue=5000}) {
    this.pool=pool;
    this.schema=identifier(schema);
    this.schemaName=schema;
    this.retentionDays=retentionDays;
    this.maxQueue=maxQueue;
    this.queue=[];
    this.pending=null;
    this.retryTimer=null;
    this.closed=false;
    this.lastCleanup=0;
    this.lastError=null;
    this.dropped=0;
  }
  async initialize() {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`openfilm-log-schema:${this.schemaName}`]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.events (
        id uuid PRIMARY KEY,
        time timestamptz NOT NULL,
        source text NOT NULL CHECK(source IN ('gateway','monitor','tunnel','admin')),
        event text NOT NULL,
        level text NOT NULL CHECK(level IN ('info','warn','error')),
        license_id text,
        request_id text,
        data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
      )`);
      for(const statement of [
        'events_time_idx ON events (time DESC,id DESC)',
        'events_source_time_idx ON events (source,time DESC,id DESC)',
        'events_license_time_idx ON events (license_id,time DESC,id DESC)',
        'events_request_idx ON events (request_id)',
        "events_key_ref_idx ON events ((data->>'keyRef'))",
        "events_errors_idx ON events (time DESC,id DESC) WHERE level IN ('warn','error')",
      ]) {
        const [name,definition]=statement.split(' ON events ');
        await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${this.schema}.events ${definition}`);
      }
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.collector_state (
        name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  enqueue(row) {
    if(this.closed || this.queue.length>=this.maxQueue) {
      this.dropped++;
      if(this.dropped===1)process.stderr.write(JSON.stringify({event:'log.database_queue_full',dropped:this.dropped})+'\n');
      return;
    }
    this.queue.push(row);
    if(!this.pending&&!this.retryTimer) {
      this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.drain();},25);
      this.retryTimer.unref();
    }
  }
  async insertBatch(rows) {
    if(!rows.length)return 0;
    const result=await this.pool.query(`INSERT INTO ${this.schema}.events (id,time,source,event,level,license_id,request_id,data)
      SELECT (item->>'id')::uuid,(item->>'time')::timestamptz,item->>'source',item->>'event',item->>'level',item->>'licenseId',item->>'requestId',item
      FROM jsonb_array_elements($1::jsonb) AS item ON CONFLICT (id) DO NOTHING`,[JSON.stringify(rows)]);
    return result.rowCount;
  }
  async drain() {
    if(this.pending)return this.pending;
    const work=(async()=>{
      try {
        let wrote=false;
        while(this.queue.length){const batch=this.queue.slice(0,100);await this.insertBatch(batch);this.queue.splice(0,batch.length);wrote=true;}
        this.lastError=null;
        if(wrote&&Date.now()-this.lastCleanup>3600000) {
          await this.pool.query(`DELETE FROM ${this.schema}.events WHERE time < now() - make_interval(days => $1::int)`,[this.retentionDays]);
          this.lastCleanup=Date.now();
        }
      }catch(error){
        const code=errorCode(error);
        if(this.lastError!==code)process.stderr.write(JSON.stringify({event:'log.database_write_failed',errorCode:code,queued:this.queue.length})+'\n');
        this.lastError=code;
        if(!this.closed&&!this.retryTimer){this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.drain();},2000);this.retryTimer.unref();}
      }
    })();
    this.pending=work;
    try{await work;}finally{this.pending=null;if(this.queue.length&&!this.retryTimer&&!this.closed){this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.drain();},25);this.retryTimer.unref();}}
  }
  async flush() {
    clearTimeout(this.retryTimer);this.retryTimer=null;
    do{await this.drain();}while(this.queue.length&&!this.lastError);
    if(this.queue.length)throw Object.assign(new Error('日志尚未写入数据库'),{code:this.lastError??'LOG_QUEUE_PENDING'});
  }
  async close() {
    this.closed=true;clearTimeout(this.retryTimer);this.retryTimer=null;
    try{await this.flush();}finally{await this.pool.end();}
  }
  async state(name) {
    const result=await this.pool.query(`SELECT value FROM ${this.schema}.collector_state WHERE name=$1`,[name]);
    return result.rows[0]?.value??null;
  }
  async setState(name,value) {
    await this.pool.query(`INSERT INTO ${this.schema}.collector_state(name,value) VALUES($1,$2::jsonb)
      ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=now()`,[name,JSON.stringify(value)]);
  }
  async status() {
    const result=await this.pool.query(`SELECT count(*)::text AS total,max(time) AS latest FROM ${this.schema}.events`);
    return {engine:'PostgreSQL',schema:this.schemaName,eventCount:result.rows[0].total,latestEvent:result.rows[0].latest,queued:this.queue.length,dropped:this.dropped};
  }
  async queryEvents(params=new URLSearchParams()) {
    const take=Math.floor(Math.max(1,Math.min(200,Number(params.get('limit'))||100)));
    const time=(value,fallback)=>{const parsed=value?new Date(value):fallback;if(!Number.isFinite(parsed.getTime()))throw badRequest('日志时间格式无效');return parsed.toISOString();};
    const from=time(params.get('from'),new Date(Date.now()-86400000)),to=time(params.get('to'),new Date());
    if(from>to)throw badRequest('开始时间不能晚于结束时间');
    const values=[from,to],where=['time >= $1::timestamptz','time <= $2::timestamptz'];
    const add=(clause,value)=>{values.push(value);where.push(clause.replace('?',`$${values.length}`));};
    if(params.get('source'))add('source=?',params.get('source'));
    if(params.get('license'))add('license_id=?',params.get('license'));
    if(params.get('request'))add('request_id=?',params.get('request'));
    if(params.get('scope')==='calls')where.push("source='gateway' AND coalesce(data->>'path','') <> '/healthz'");
    if(params.get('scope')==='diagnostics')where.push("source IN ('monitor','tunnel')");
    if(params.get('errors')==='true')where.push("level IN ('error','warn')");
    if(params.get('q'))add('position(lower(?) in lower(data::text)) > 0',params.get('q').slice(0,200));
    if(params.get('cursor')) {
      const [stamp,id,...extra]=params.get('cursor').split('|');
      if(extra.length||!id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw badRequest('日志分页游标无效');
      const cursorTime=time(stamp,new Date());values.push(cursorTime,id);
      where.push(`(time,id) < ($${values.length-1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(take+1);
    const result=await this.pool.query(`SELECT data FROM ${this.schema}.events WHERE ${where.join(' AND ')} ORDER BY time DESC,id DESC LIMIT $${values.length}`,values);
    const rows=result.rows.map(row=>row.data),events=rows.slice(0,take);
    return {events,nextCursor:rows.length>take?`${events.at(-1).time}|${events.at(-1).id}`:null,storage:'postgresql'};
  }
}

export async function openLogStore(connectionString,{initialize=false,schema='gateway_logs'}={}) {
  if(!connectionString)throw new Error('必须配置 LOG_DATABASE_URL，日志需要 PostgreSQL');
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString,max:4,connectionTimeoutMillis:3000,statement_timeout:8000,query_timeout:10000,allowExitOnIdle:true});
  pool.on('error',error=>process.stderr.write(JSON.stringify({event:'log.database_connection_error',errorCode:errorCode(error)})+'\n'));
  const store=new PostgresLogStore({pool,schema});
  try{if(initialize)await store.initialize();else await pool.query(`SELECT 1 FROM ${store.schema}.events LIMIT 1`);return store;}
  catch(error){await pool.end();throw error;}
}
