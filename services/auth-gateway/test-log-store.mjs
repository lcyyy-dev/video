import {randomUUID} from 'node:crypto';
import {openLogStore} from './log-store.mjs';
export const hasTestDatabase=Boolean(process.env.LOG_TEST_DATABASE_URL??process.env.LOG_DATABASE_URL);
export async function testLogStore(t) {
  const store=await openLogStore(process.env.LOG_TEST_DATABASE_URL??process.env.LOG_DATABASE_URL,{initialize:true,schema:'test_'+randomUUID().replaceAll('-','')});
  t.after(async()=>{await store.flush();await store.pool.query(`DROP SCHEMA ${store.schema} CASCADE`);await store.close();});
  return store;
}
